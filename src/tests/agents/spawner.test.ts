import { spawnAgent } from '../../../src/agents/spawner';
import * as anthropic from '../../../src/agents/providers/anthropic';
import * as openai from '../../../src/agents/providers/openai';
import * as google from '../../../src/agents/providers/google';
import * as ollama from '../../../src/agents/providers/ollama';
import type { AgentResult } from '../../../src/agents/types';

jest.mock('../../../src/agents/providers/anthropic');
jest.mock('../../../src/agents/providers/openai');
jest.mock('../../../src/agents/providers/google');
jest.mock('../../../src/agents/providers/ollama');

describe('Agent Spawner', () => {
  const mockResult: AgentResult = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    output: 'Test response',
    inputTokens: 10,
    outputTokens: 20,
    durationMs: 1000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('spawnAgent', () => {
    it('should dispatch to anthropic provider', async () => {
      (anthropic.runAnthropicAgent as jest.Mock).mockResolvedValue(mockResult);

      const result = await spawnAgent('test task', {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      });

      expect(anthropic.runAnthropicAgent).toHaveBeenCalledWith('test task', {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      });
      expect(result).toEqual(mockResult);
    });

    it('should dispatch to openai provider', async () => {
      const openaiResult = { ...mockResult, provider: 'openai', model: 'gpt-4o' };
      (openai.runOpenAIAgent as jest.Mock).mockResolvedValue(openaiResult);

      const result = await spawnAgent('test task', {
        provider: 'openai',
        model: 'gpt-4o',
      });

      expect(openai.runOpenAIAgent).toHaveBeenCalledWith('test task', {
        provider: 'openai',
        model: 'gpt-4o',
      });
      expect(result).toEqual(openaiResult);
    });

    it('should dispatch to google provider', async () => {
      const googleResult = { ...mockResult, provider: 'google', model: 'gemini-2.0-flash' };
      (google.runGoogleAgent as jest.Mock).mockResolvedValue(googleResult);

      const result = await spawnAgent('test task', {
        provider: 'google',
        model: 'gemini-2.0-flash',
      });

      expect(google.runGoogleAgent).toHaveBeenCalledWith('test task', {
        provider: 'google',
        model: 'gemini-2.0-flash',
      });
      expect(result).toEqual(googleResult);
    });

    it('should dispatch to ollama provider', async () => {
      const ollamaResult = { ...mockResult, provider: 'ollama', model: 'llama2' };
      (ollama.runOllamaAgent as jest.Mock).mockResolvedValue(ollamaResult);

      const result = await spawnAgent('test task', {
        provider: 'ollama',
        model: 'llama2',
      });

      expect(ollama.runOllamaAgent).toHaveBeenCalledWith('test task', {
        provider: 'ollama',
        model: 'llama2',
      });
      expect(result).toEqual(ollamaResult);
    });

    it('should throw on unknown provider', async () => {
      // This is a type-checking test; the TypeScript compiler would normally catch this
      // but we test the runtime behavior for safety
      await expect(
        spawnAgent('test task', {
          provider: 'unknown' as never,
          model: 'some-model',
        })
      ).rejects.toThrow('Unknown provider');
    });

    it('should preserve token counts from provider result', async () => {
      const customResult: AgentResult = {
        ...mockResult,
        inputTokens: 42,
        outputTokens: 137,
        durationMs: 5432,
      };
      (anthropic.runAnthropicAgent as jest.Mock).mockResolvedValue(customResult);

      const result = await spawnAgent('test task', {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      });

      expect(result.inputTokens).toBe(42);
      expect(result.outputTokens).toBe(137);
      expect(result.durationMs).toBe(5432);
    });
  });
});
