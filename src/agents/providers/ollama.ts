import type { AgentConfig, AgentResult } from '../types';

type OllamaChatResponse = {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
};

export async function runOllamaAgent(
  task: string,
  config: AgentConfig
): Promise<AgentResult> {
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const start = Date.now();

  const body = {
    model: config.model,
    stream: false,
    messages: [
      {
        role: 'system',
        content: config.systemPrompt ?? 'You are a helpful assistant. Complete the task concisely.',
      },
      { role: 'user', content: task },
    ],
    options: { num_predict: config.maxTokens ?? 1024 },
  };

  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  const output = data.message?.content ?? '';

  return {
    provider: 'ollama',
    model: config.model,
    output,
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
    durationMs: Date.now() - start,
  };
}
