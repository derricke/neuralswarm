import { runAnthropicAgent } from './providers/anthropic';
import { runOpenAIAgent } from './providers/openai';
import { runGoogleAgent } from './providers/google';
import { runOllamaAgent } from './providers/ollama';
import type { AgentConfig, AgentResult } from './types';
import { logger } from '../lib/logger';

export async function spawnAgent(task: string, config: AgentConfig): Promise<AgentResult> {
  logger.info({ provider: config.provider, model: config.model }, 'agent spawned');

  let result: AgentResult;

  switch (config.provider) {
    case 'anthropic':
      result = await runAnthropicAgent(task, config);
      break;
    case 'openai':
    case 'openai_compatible':
      result = await runOpenAIAgent(task, config);
      break;
    case 'google':
      result = await runGoogleAgent(task, config);
      break;
    case 'ollama':
      result = await runOllamaAgent(task, config);
      break;
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${exhaustive}`);
    }
  }

  logger.info(
    {
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    'agent completed'
  );

  return result;
}
