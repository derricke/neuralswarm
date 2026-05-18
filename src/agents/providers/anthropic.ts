import Anthropic from '@anthropic-ai/sdk';
import type { AgentConfig, AgentResult } from '../types';

export async function runAnthropicAgent(
  task: string,
  config: AgentConfig
): Promise<AgentResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const start = Date.now();

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens ?? 1024,
    system: config.systemPrompt ?? 'You are a helpful assistant. Complete the task concisely.',
    messages: [{ role: 'user', content: task }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const output = textBlock && textBlock.type === 'text' ? textBlock.text : '';

  return {
    provider: 'anthropic',
    model: config.model,
    output,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    durationMs: Date.now() - start,
  };
}
