export type AgentProvider = 'anthropic' | 'openai' | 'google' | 'ollama';

export type AgentConfig = {
  provider: AgentProvider;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
};

export type AgentResult = {
  provider: AgentProvider;
  model: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};
