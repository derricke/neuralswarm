import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Content, Part, Tool } from '@google/genai';
import type { AgentConfig, AgentResult } from '../types';
import { connectMcpServers, getMcpTools, executeMcpTool, disconnectMcpServers, McpClientMap } from '../mcp';
import { logger } from '../../lib/logger';
import { ContextManager } from '../../memory/ContextManager';

const DEFAULT_MAX_TOOL_TURNS = 12;

function getMaxToolTurns(): number {
  const raw = Number.parseInt(process.env.AGENT_MAX_TOOL_TURNS ?? `${DEFAULT_MAX_TOOL_TURNS}`, 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_MAX_TOOL_TURNS;
  }
  return raw;
}

function fixSchemaForGemini(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(fixSchemaForGemini);
  
  const result: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') {
      result[key] = value.toUpperCase();
    } else {
      result[key] = fixSchemaForGemini(value);
    }
  }

  if (result.type === 'OBJECT' && !result.properties) {
    result.properties = {};
  }

  return result;
}

export async function runGoogleAgent(
  task: string,
  config: AgentConfig
): Promise<AgentResult> {
  const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
  const start = Date.now();

  let mcpClients: McpClientMap = {};
  let tools: Tool[] = [];
  const mcpToolMap = new Map<string, any>();

  if (config.mcpServers && config.mcpServers.length > 0) {
    mcpClients = await connectMcpServers(config.mcpServers);
    const mcpTools = await getMcpTools(mcpClients);
    
    if (mcpTools.length > 0) {
      const functionDeclarations = mcpTools.map(t => {
        mcpToolMap.set(t.name, t);
        return {
          name: t.name,
          description: t.description || '',
          parameters: fixSchemaForGemini(t.input_schema) || { type: 'OBJECT', properties: {} }
        };
      });
      tools = [{ functionDeclarations }];
    }
  }

  const systemInstruction = config.systemPrompt ?? 'You are a helpful assistant. Complete the task concisely.';
  let contents: Content[] = [{ role: 'user', parts: [{ text: task }] }];
  const contextManager = new ContextManager();

  let finalOutput = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const maxToolTurns = getMaxToolTurns();
  let turn = 0;

  try {
    while (turn < maxToolTurns) {
      turn++;
      
      const response = await client.models.generateContent({
        model: config.model,
        contents,
        config: {
          systemInstruction,
          tools: tools.length > 0 ? tools : undefined,
          maxOutputTokens: config.maxTokens,
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
          ],
        },
      });

      const usage = response.usageMetadata;
      if (usage) {
        totalInputTokens += usage.promptTokenCount ?? 0;
        totalOutputTokens += usage.candidatesTokenCount ?? 0;
      }

      if (!response.candidates || response.candidates.length === 0) {
        throw new Error('No candidates returned from Gemini');
      }

      const candidate = response.candidates[0];
      const parts = candidate.content?.parts ?? [];
      const finishReason = candidate.finishReason;
      
      // Append model response to history
      contents.push({ role: 'model', parts });

      const currentTokenCount = contextManager.extractTokenCount(usage);
      
      const messages = contents.map(c => ({
        role: c.role || 'user',
        content: c.parts?.map(p => p.text || '').join('') || ''
      }));

      const compressed = await contextManager.checkAndCompressContext(messages, currentTokenCount);
      if (compressed) {
        contents = compressed.map(m => ({
          role: m.role,
          parts: [{ text: m.content }]
        }));
      }

      const textParts = parts.filter(p => p.text);
      const textChunk = textParts.map(p => p.text).join('');
      if (textChunk) {
        finalOutput += textChunk;
        if (config.onStreamChunk) {
          config.onStreamChunk(textChunk, 'text');
        }
      }

      const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall!);

      if (functionCalls.length > 0) {
        const functionResponses: Part[] = [];

        for (const call of functionCalls) {
          if (config.onStreamChunk) {
            config.onStreamChunk(`\n[Calling tool: ${call.name} with ${JSON.stringify(call.args)}]\n`, 'tool_call');
          }

          let toolOutput: any;
          if (!call.name) {
            toolOutput = { error: 'Function call missing name' };
          } else {
            try {
              const result = await executeMcpTool(mcpClients, call.name, call.args);
              
              if (result && result.content && Array.isArray(result.content)) {
                toolOutput = { result: result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n') };
              } else {
                toolOutput = { result: typeof result === 'string' ? result : JSON.stringify(result) };
              }
            } catch (err) {
              if (finishReason === 'MAX_TOKENS') {
                toolOutput = { error: 'Error: Tool arguments truncated due to MAX_TOKENS limit. Your output was too large. Do NOT try to execute this exact same massive operation again. Instead, break your file modifications into smaller chunks, or use the shell server (e.g., sed, echo >>) to apply targeted edits to avoid hitting the token limit.' };
              } else {
                toolOutput = { error: err instanceof Error ? err.message : String(err) };
              }
            }
          }

          if (config.onStreamChunk) {
            config.onStreamChunk(`[Tool result]: ${toolOutput.result || toolOutput.error}\n`, 'tool_result');
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: toolOutput
            }
          });
        }

        contents.push({ role: 'user', parts: functionResponses });
        continue;
      } else if (finishReason === 'MAX_TOKENS') {
        contents.push({ 
          role: 'user', 
          parts: [{ text: 'System: Your previous response was truncated because you exceeded the max token limit. Please continue your response exactly from where you left off, or summarize your progress.' }] 
        });
        continue;
      }

      // If no function calls and not truncated, turn is done
      break;
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
    provider: 'google',
    model: config.model,
    output: finalOutput,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    durationMs: Date.now() - start,
  };
}
