import OpenAI from 'openai';
import type { AgentConfig, AgentResult } from '../types';
import { McpManager, McpTool } from '../mcpClient';

const DEFAULT_MAX_TOOL_TURNS = 12;

function getMaxToolTurns(): number {
  const raw = Number.parseInt(process.env.AGENT_MAX_TOOL_TURNS ?? `${DEFAULT_MAX_TOOL_TURNS}`, 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_MAX_TOOL_TURNS;
  }

  return raw;
}

export async function runOpenAIAgent(
  task: string,
  config: AgentConfig
): Promise<AgentResult> {
  const isCompatible = config.provider === 'openai_compatible';
  const apiKey = isCompatible
    ? process.env.OPENAI_COMPATIBLE_API_KEY?.trim()
    : process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    const envName = isCompatible ? 'OPENAI_COMPATIBLE_API_KEY' : 'OPENAI_API_KEY';
    throw new Error(`${envName} is required when using provider=${config.provider}`);
  }

  const baseURL = isCompatible ? process.env.OPENAI_COMPATIBLE_URL?.trim() : undefined;
  if (isCompatible && !baseURL) {
    throw new Error('OPENAI_COMPATIBLE_URL is required when using provider=openai_compatible');
  }

  const client = new OpenAI({ apiKey, baseURL });
  const start = Date.now();

  let mcpManager: McpManager | undefined;
  let tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  const toolMap = new Map<string, McpTool>();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: config.systemPrompt ?? 'You are a helpful assistant. Complete the task concisely.',
    },
    { role: 'user', content: task },
  ];

  let finalOutput = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const maxToolTurns = getMaxToolTurns();
  let turn = 0;

  try {
    if (config.mcpServers && config.mcpServers.length > 0) {
      mcpManager = new McpManager();
      await mcpManager.connectAll(config.mcpServers);
      const mcpTools = await mcpManager.listTools();
      
      if (mcpTools.length > 0) {
        tools = mcpTools.map(t => {
          const uniqueName = `${t._serverName}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
          toolMap.set(uniqueName, t);
          return {
            type: 'function',
            function: {
              name: uniqueName,
              description: t.description || '',
              parameters: t.inputSchema as any
            }
          };
        });
      }
    }
    while (turn < maxToolTurns) {
      turn++;
      const stream = await client.chat.completions.create({
        model: config.model,
        max_tokens: config.maxTokens ?? 1024,
        messages,
        tools,
        stream: true,
        stream_options: { include_usage: true },
        user: 'neuralswarm-agent',
      });

      let currentText = '';
      const toolCalls: Record<number, { id: string, name: string, arguments: string }> = {};

      for await (const chunk of stream) {
        if (chunk.usage) {
          totalInputTokens += chunk.usage.prompt_tokens;
          totalOutputTokens += chunk.usage.completion_tokens;
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          currentText += delta.content;
          if (config.onStreamChunk) {
            config.onStreamChunk(delta.content, 'text');
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (!toolCalls[index]) toolCalls[index] = { id: '', name: '', arguments: '' };
            if (tc.id) toolCalls[index].id = tc.id;
            if (tc.function?.name) toolCalls[index].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[index].arguments += tc.function.arguments;
          }
        }
      }

      finalOutput += currentText;
      const tcArray = Object.values(toolCalls);
      
      messages.push({ 
        role: 'assistant', 
        content: currentText || null, 
        tool_calls: tcArray.length > 0 ? tcArray.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) : undefined 
      } as any);

      if (tcArray.length === 0) {
        break; // No more tool calls, done
      }

      // Execute tool calls
      for (const tc of tcArray) {
        if (config.onStreamChunk) {
          config.onStreamChunk(`\n[Calling tool: ${tc.name} with ${tc.arguments}]\n`, 'tool_call');
        }

        const mcpTool = toolMap.get(tc.name);
        let resultStr = '';
        if (!mcpTool || !mcpManager) {
          resultStr = `Error: Tool ${tc.name} not found.`;
        } else {
          try {
            const parsedArgs = JSON.parse(tc.arguments);
            const mcpResult = await mcpManager.callTool(mcpTool._serverName, mcpTool.name, parsedArgs);
            resultStr = (mcpResult.content as any[]).map((c: any) => c.text).join('\n');
          } catch (e: any) {
            resultStr = `Error executing tool: ${e.message}`;
          }
        }

        if (config.onStreamChunk) {
          config.onStreamChunk(`[Tool result]: ${resultStr}\n`, 'tool_result');
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr
        });
      }
    }

    if (turn >= maxToolTurns) {
      throw new Error(`tool_loop_limit_exceeded: exceeded ${maxToolTurns} turns`);
    }
  } catch (error) {
    if (mcpManager) await mcpManager.disconnectAll();
    throw new Error(`OpenAI API Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (mcpManager) {
    await mcpManager.disconnectAll();
  }

  return {
    provider: config.provider,
    model: config.model,
    output: finalOutput,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    durationMs: Date.now() - start,
  };
}
