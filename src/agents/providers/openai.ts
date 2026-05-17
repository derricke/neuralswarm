import OpenAI from 'openai';
import type { AgentConfig, AgentResult } from '../types';

export async function runOpenAIAgent(
  task: string,
  config: AgentConfig
): Promise<AgentResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const start = Date.now();

  const response = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens ?? 1024,
    messages: [
      {
        role: 'system',
        content: config.systemPrompt ?? 'You are a helpful assistant. Complete the task concisely.',
      },
      { role: 'user', content: task },
    ],
  });

  const output = response.choices[0]?.message?.content ?? '';
  const usage = response.usage;

  return {
    provider: 'openai',
    model: config.model,
    output,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    durationMs: Date.now() - start,
  };
}
