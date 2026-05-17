import { parseTaskInput } from '../../lib/taskParser';
import type { TaskInput } from '../../lib/taskParser';

describe('parseTaskInput', () => {
  it('parses plain text lines', () => {
    const result = parseTaskInput('Write a blog post\nReview PRs');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject<Partial<TaskInput>>({ description: 'Write a blog post', source: 'plaintext' });
    expect(result[1]).toMatchObject<Partial<TaskInput>>({ description: 'Review PRs', source: 'plaintext' });
  });

  it('parses markdown todo items', () => {
    const result = parseTaskInput('- [ ] Fix the login bug\n* [ ] Update README');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject<Partial<TaskInput>>({ description: 'Fix the login bug', source: 'todo' });
    expect(result[1]).toMatchObject<Partial<TaskInput>>({ description: 'Update README', source: 'todo' });
  });

  it('ignores completed todos', () => {
    const result = parseTaskInput('- [x] Already done\n- [ ] Still todo');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<TaskInput>>({ description: 'Still todo', source: 'todo' });
  });

  it('ignores markdown headings', () => {
    const result = parseTaskInput('# My Tasks\nDo something');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<TaskInput>>({ description: 'Do something' });
  });

  it('ignores blank lines', () => {
    const result = parseTaskInput('\n\nDo something\n\n');
    expect(result).toHaveLength(1);
  });

  it('handles mixed input', () => {
    const input = `# Sprint Tasks
Write unit tests
- [ ] Deploy to staging
- [x] Update docs
Fix the auth bug`;
    const result = parseTaskInput(input);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.source)).toEqual(['plaintext', 'todo', 'plaintext']);
  });
});
