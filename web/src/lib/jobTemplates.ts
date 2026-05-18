export type Provider = 'openai' | 'anthropic' | 'google' | 'ollama';

export type JobTemplate = {
  title: string;
  description: string;
  provider: Provider;
  model: string;
  system_prompt: string;
};

export const PROVIDERS: Provider[] = ['openai', 'anthropic', 'google', 'ollama'];

const TEMPLATES_STORAGE_KEY = 'neuralswarm_job_templates';

export function templateKey(template: JobTemplate): string {
  return `${template.title}::${template.provider}::${template.model}`;
}

export function loadJobTemplates(): JobTemplate[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as JobTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJobTemplates(templates: JobTemplate[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

export function upsertJobTemplate(existing: JobTemplate[], template: JobTemplate): JobTemplate[] {
  const deduped = existing.filter(
    (item) =>
      !(
        item.title.toLowerCase() === template.title.toLowerCase() &&
        item.provider === template.provider &&
        item.model.toLowerCase() === template.model.toLowerCase()
      )
  );

  return [template, ...deduped].slice(0, 100);
}
