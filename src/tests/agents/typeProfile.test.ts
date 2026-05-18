import { randomUUID } from 'crypto';
import { getDb, resetDb } from '../../lib/db';
import {
  getOrCreateAgentTypeProfile,
  updateAgentTypeProfileAfterTask,
  updateAgentTypeProfileSystemPrompt,
  getAllAgentTypeProfiles,
} from '../../agents/typeProfile';

beforeEach(() => {
  resetDb();
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

afterAll(() => {
  resetDb();
});

describe('Agent Type Profile', () => {

  describe('getOrCreateAgentTypeProfile', () => {
    it('should create a new profile if it does not exist', async () => {
      const profile = await getOrCreateAgentTypeProfile('openai', 'gpt-4o');

      expect(profile.provider).toBe('openai');
      expect(profile.model).toBe('gpt-4o');
      expect(profile.temperature).toBe(0.7);
      expect(profile.top_k_tokens).toBe(1024);
      expect(profile.success_rate).toBe(0);
      expect(profile.total_tasks).toBe(0);
      expect(profile.failure_patterns).toEqual([]);
    });

    it('should retrieve an existing profile', async () => {
      await getOrCreateAgentTypeProfile('openai', 'gpt-4o');
      const profile = await getOrCreateAgentTypeProfile('openai', 'gpt-4o');

      expect(profile.provider).toBe('openai');
      expect(profile.model).toBe('gpt-4o');
    });
  });

  describe('updateAgentTypeProfileAfterTask', () => {
    it('should update success rate on successful task', async () => {
      await getOrCreateAgentTypeProfile('anthropic', 'claude-3-5-sonnet');
      await updateAgentTypeProfileAfterTask('anthropic', 'claude-3-5-sonnet', 'test task', 'test result', true);

      const profile = await getOrCreateAgentTypeProfile('anthropic', 'claude-3-5-sonnet');
      expect(profile.success_rate).toBe(1.0);
      expect(profile.total_tasks).toBe(1);
    });

    it('should accumulate success rate over multiple tasks', async () => {
      await getOrCreateAgentTypeProfile('openai', 'gpt-4o');

      // 3 successes
      await updateAgentTypeProfileAfterTask('openai', 'gpt-4o', 'task 1', 'result 1', true);
      await updateAgentTypeProfileAfterTask('openai', 'gpt-4o', 'task 2', 'result 2', true);
      await updateAgentTypeProfileAfterTask('openai', 'gpt-4o', 'task 3', 'result 3', true);

      // 1 failure
      await updateAgentTypeProfileAfterTask('openai', 'gpt-4o', 'task 4', 'error', false);

      const profile = await getOrCreateAgentTypeProfile('openai', 'gpt-4o');
      expect(profile.success_rate).toBe(0.75);
      expect(profile.total_tasks).toBe(4);
    });

    it('should track failure patterns', async () => {
      await getOrCreateAgentTypeProfile('google', 'gemini-2.0-flash');

      await updateAgentTypeProfileAfterTask('google', 'gemini-2.0-flash', 'code review task', 'error: timeout', false, 'code_review');
      await updateAgentTypeProfileAfterTask('google', 'gemini-2.0-flash', 'another code review', 'error: timeout', false, 'code_review');

      const profile = await getOrCreateAgentTypeProfile('google', 'gemini-2.0-flash');
      expect(profile.failure_patterns).toHaveLength(1);
      expect(profile.failure_patterns[0].taskType).toBe('code_review');
      expect(profile.failure_patterns[0].count).toBe(2);
    });
  });

  describe('updateAgentTypeProfileSystemPrompt', () => {
    it('should update system prompt', async () => {
      await getOrCreateAgentTypeProfile('openai', 'gpt-4o');
      const newPrompt = 'You are a helpful code reviewer.';

      await updateAgentTypeProfileSystemPrompt('openai', 'gpt-4o', newPrompt);

      const profile = await getOrCreateAgentTypeProfile('openai', 'gpt-4o');
      expect(profile.best_system_prompt).toBe(newPrompt);
    });
  });

  describe('getAllAgentTypeProfiles', () => {
    it('should return all profiles sorted by success rate', async () => {
      await getOrCreateAgentTypeProfile('openai', 'gpt-4o');
      await getOrCreateAgentTypeProfile('anthropic', 'claude-3-5-sonnet');

      // Make Claude have higher success rate (2/2 = 1.0)
      await updateAgentTypeProfileAfterTask('anthropic', 'claude-3-5-sonnet', 'task', 'result', true);
      await updateAgentTypeProfileAfterTask('anthropic', 'claude-3-5-sonnet', 'task', 'result', true);

      // GPT has lower success rate (1/2 = 0.5)
      await updateAgentTypeProfileAfterTask('openai', 'gpt-4o', 'task', 'result', true);
      await updateAgentTypeProfileAfterTask('openai', 'gpt-4o', 'task', 'error', false);

      const profiles = await getAllAgentTypeProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles[0].success_rate).toBe(1.0);
      expect(profiles[1].success_rate).toBe(0.5);
    });
  });
});
