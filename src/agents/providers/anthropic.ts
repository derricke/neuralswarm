import Anthropic from '@anthropic-ai/sdk';
import type { AgentConfig, AgentResult } from '../types';
import { connectMcpServers, getMcpTools, executeMcpTool, disconnectMcpServers, McpClientMap } from '../mcp';
import { logger } from '../../lib/logger';

const DEFAULT_MAX_TOOL_TURNS = 12;

function getMaxToolTurns(): number {
  const raw = Number.parseInt(process.env.AGENT_MAX_TOOL_TURNS ?? `${DEFAULT_MAX_TOOL_TURNS}`, 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_MAX_TOOL_TURNS;
  }

  return raw;
}

export async function runAnthropicAgent(
  task: string,
  config: AgentConfig
): Promise<AgentResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const start = Date.now();

  let mcpClients: McpClientMap = {};
  let tools: any[] = [];

  if (config.mcpServers && config.mcpServers.length > 0) {
    mcpClients = await connectMcpServers(config.mcpServers);
    tools = await getMcpTools(mcpClients);
  }

  let messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let output = '';
  const maxToolTurns = getMaxToolTurns();
  let turn = 0;

  try {
    while (turn < maxToolTurns) {
      turn++;
      const createOptions: Anthropic.MessageCreateParamsNonStreaming = {
        model: config.model,
        max_tokens: config.maxTokens ?? 8192,
        system: config.systemPrompt ?? 'You are a helpful assistant. Complete the task concisely.',
        messages,
        metadata: { user_id: 'neuralswarm-agent' },
      };

      if (tools.length > 0) {
        createOptions.tools = tools;
      }

      let response;
      try {
        response = await client.messages.create(createOptions);
      } catch (error) {
        throw new Error(`Anthropic API Error: ${error instanceof Error ? error.message : String(error)}`);
      }

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      messages.push({
        role: 'assistant',
        content: response.content,
      });

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            try {
              const result = await executeMcpTool(mcpClients, block.name, block.input);
              
              let toolOutput = '';
              let isError = false;
              if (result && result.content && Array.isArray(result.content)) {
                toolOutput = result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
                isError = result.isError || false;
              } else {
                toolOutput = typeof result === 'string' ? result : JSON.stringify(result);
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: toolOutput,
                is_error: isError,
              });
            } catch (err) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              });
            }
          }
        }

        if (toolResults.length > 0) {
          messages.push({
            role: 'user',
            content: toolResults,
          });
          continue; // Loop again
        }
      }

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
        const textBlock = response.content.find((b) => b.type === 'text');
        output = textBlock && textBlock.type === 'text' ? textBlock.text : '';
        break;
      }

      if (response.stop_reason === 'max_tokens') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        
        if (toolUseBlocks.length > 0) {
          const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map(block => ({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: Tool arguments truncated due to MAX_TOKENS limit. Your output was too large. Do NOT try to execute this exact same massive operation again. Instead, break your file modifications into smaller chunks, or use the shell server (e.g., sed, echo >>) to apply targeted edits to avoid hitting the token limit.`,
            is_error: true,
          }));
          messages.push({
            role: 'user',
            content: toolResults,
          });
          continue;
        } else {
          messages.push({
            role: 'user',
            content: `System: Your previous response was truncated because you exceeded the max token limit. Please continue your response exactly from where you left off, or summarize your progress.`,
          });
          continue;
        }
      }

      throw new Error(`Anthropic API unexpectedly stopped: ${response.stop_reason}`);
    }

    if (turn >= maxToolTurns) {
      throw new Error(`tool_loop_limit_exceeded: exceeded ${maxToolTurns} turns`);
    }
  } finally {
    if (Object.keys(mcpClients).length > 0) {
      await disconnectMcpServers(mcpClients);
    }
  }

  return {
    provider: 'anthropic',
    model: config.model,
    output,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    durationMs: Date.now() - start,
  };
}
