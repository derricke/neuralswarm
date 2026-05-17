import { GoogleGenAI } from '@google/genai';
import type { AgentConfig, AgentResult } from '../types';

export async function runGoogleAgent(
  task: string,
  config: AgentConfig
): Promise<AgentResult> {
  const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
  const start = Date.now();

  const systemInstruction =
    config.systemPrompt ?? 'You are a helpful assistant. Complete the task concisely.';

  const response = await client.models.generateContent({
    model: config.model,
    contents: [{ role: 'user', parts: [{ text: task }] }],
    config: {
      systemInstruction,
      maxOutputTokens: config.maxTokens ?? 1024,
    },
  });

  const output = response.text ?? '';
  const usage = response.usageMetadata;

  return {
    provider: 'google',
    model: config.model,
    output,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    durationMs: Date.now() - start,
  };
}
