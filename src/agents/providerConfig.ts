import type { AgentProvider } from './types';

const FALLBACK_OLLAMA_MODEL = process.env.OLLAMA_DEFAULT_MODEL?.trim() || 'llama3';
const FALLBACK_OPENAI_COMPATIBLE_MODEL =
  process.env.OPENAI_COMPATIBLE_DEFAULT_MODEL?.trim() || 'gpt-4o-mini';

export const KNOWN_AGENT_PROVIDERS: AgentProvider[] = [
  'anthropic',
  'openai',
  'google',
  'openai_compatible',
  'ollama',
];

export function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === 'string' && KNOWN_AGENT_PROVIDERS.includes(value as AgentProvider);
}

export function hasOpenAICompatibleConfig(): boolean {
  return Boolean(process.env.OPENAI_COMPATIBLE_API_KEY?.trim() && process.env.OPENAI_COMPATIBLE_URL?.trim());
}

export function isProviderAvailable(provider: AgentProvider): boolean {
  switch (provider) {
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY?.trim());
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    case 'google':
      return Boolean(process.env.GOOGLE_API_KEY?.trim());
    case 'openai_compatible':
      return hasOpenAICompatibleConfig();
    case 'ollama':
      return true;
  }
}

export function resolveDefaultProviderModel(): { provider: AgentProvider; model: string } {
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return { provider: 'google', model: 'gemini-2.5-flash' };
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    return { provider: 'openai', model: 'gpt-4o-mini' };
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { provider: 'anthropic', model: 'claude-3-5-haiku-latest' };
  }

  if (hasOpenAICompatibleConfig()) {
    return { provider: 'openai_compatible', model: FALLBACK_OPENAI_COMPATIBLE_MODEL };
  }

  return { provider: 'ollama', model: FALLBACK_OLLAMA_MODEL };
}
