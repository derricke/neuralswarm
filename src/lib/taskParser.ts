export type TaskInput = {
  id: string;
  description: string;
  source: 'plaintext' | 'todo';
};

const TODO_PATTERN = /^[-*]\s+\[ \]\s+(.+)$/;

export function parseTaskInput(raw: string): TaskInput[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.flatMap((line, idx) => {
    const todoMatch = TODO_PATTERN.exec(line);

    if (todoMatch) {
      const t: TaskInput = {
        id: `task-${idx}`,
        description: todoMatch[1].trim(),
        source: 'todo',
      };
      return [t];
    }

    // Skip lines that look like completed todos or headings
    if (/^[-*]\s+\[x\]/i.test(line)) return [] as TaskInput[];
    if (/^#+\s/.test(line)) return [] as TaskInput[];

    const t: TaskInput = {
      id: `task-${idx}`,
      description: line,
      source: 'plaintext',
    };
    return [t];
  });
}
