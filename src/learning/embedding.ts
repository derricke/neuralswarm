import OpenAI from 'openai';
import type { EmbeddingProvider } from './types';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_GOOGLE_EMBEDDING_MODEL = 'gemini-embedding-001';
const GOOGLE_EMBEDDING_MODEL_FALLBACKS = ['gemini-embedding-001', 'text-embedding-004'] as const;
const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';

type EmbeddingProviderName = 'openai' | 'google' | 'openai_compatible' | 'ollama';

export class EmbeddingConfigurationError extends Error {
  readonly code = 'embedding_configuration_error';

  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingConfigurationError';
  }
}

export function isEmbeddingConfigurationError(error: unknown): error is EmbeddingConfigurationError {
  return error instanceof EmbeddingConfigurationError;
}

function normalizeProviderName(value: string): EmbeddingProviderName | null {
  if (value === 'openai' || value === 'google' || value === 'openai_compatible' || value === 'ollama') {
    return value;
  }

  return null;
}

function getExplicitProvider(): EmbeddingProviderName | null {
  const raw = process.env.LEARNING_EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (!raw) return null;

  const normalized = normalizeProviderName(raw);
  if (!normalized) {
    throw new EmbeddingConfigurationError(
      `LEARNING_EMBEDDING_PROVIDER must be one of: openai, google, openai_compatible, ollama (received: ${raw})`
    );
  }

  return normalized;
}

function requireApiKey(name: 'OPENAI_API_KEY' | 'GOOGLE_API_KEY' | 'OPENAI_COMPATIBLE_API_KEY'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new EmbeddingConfigurationError(`${name} is required for learning-engine embeddings`);
  }

  return value;
}

function resolveProviderName(): EmbeddingProviderName {
  const explicit = getExplicitProvider();
  if (explicit) {
    return explicit;
  }

  if (process.env.GOOGLE_API_KEY?.trim()) return 'google';
  if (process.env.OPENAI_API_KEY?.trim()) return 'openai';
  if (process.env.OPENAI_COMPATIBLE_API_KEY?.trim() && process.env.OPENAI_COMPATIBLE_URL?.trim()) {
    return 'openai_compatible';
  }
  if (process.env.OLLAMA_HOST?.trim()) return 'ollama';

  throw new EmbeddingConfigurationError(
    'No embedding provider configured: set GOOGLE_API_KEY, OPENAI_API_KEY, OPENAI_COMPATIBLE_API_KEY+OPENAI_COMPATIBLE_URL, or OLLAMA_HOST'
  );
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI | null = null;

  constructor(
    private readonly model = DEFAULT_MODEL,
    private readonly apiKeyEnv: 'OPENAI_API_KEY' | 'OPENAI_COMPATIBLE_API_KEY' = 'OPENAI_API_KEY',
    private readonly baseUrlEnv?: 'OPENAI_COMPATIBLE_URL'
  ) {}

  private getClient(): OpenAI {
    const apiKey = requireApiKey(this.apiKeyEnv);
    const baseURL = this.baseUrlEnv ? process.env[this.baseUrlEnv]?.trim() : undefined;

    if (this.baseUrlEnv && !baseURL) {
      throw new EmbeddingConfigurationError(`${this.baseUrlEnv} is required for learning-engine embeddings`);
    }

    if (!this.client) {
      this.client = new OpenAI({ apiKey, baseURL });
    }

    return this.client;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.getClient().embeddings.create({
      model: this.model,
      input: text,
    });

    return response.data[0]?.embedding ?? [];
  }
}

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly model = DEFAULT_GOOGLE_EMBEDDING_MODEL) {}

  private getModelCandidates(): string[] {
    const ordered = [this.model, ...GOOGLE_EMBEDDING_MODEL_FALLBACKS];
    return Array.from(new Set(ordered));
  }

  async embed(text: string): Promise<number[]> {
    const apiKey = requireApiKey('GOOGLE_API_KEY');
    const modelsTried: string[] = [];
    let lastErrorMessage = 'google embedding request failed';

    for (const model of this.getModelCandidates()) {
      modelsTried.push(model);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text }],
          },
        }),
      });

      if (!response.ok) {
        let details = '';
        try {
          const errorPayload = (await response.json()) as {
            error?: { message?: string };
          };
          details = errorPayload.error?.message ? ` - ${errorPayload.error.message}` : '';
        } catch {
          // Keep base status text when response body is not JSON.
        }

        lastErrorMessage = `google embedding request failed for model=${model}: ${response.status} ${response.statusText}${details}`;

        // If the model is not found, try fallback candidates.
        if (response.status === 404) {
          continue;
        }

        throw new Error(lastErrorMessage);
      }

      const payload = (await response.json()) as {
        embedding?: {
          values?: unknown;
        };
      };

      const values = payload.embedding?.values;
      if (!Array.isArray(values)) {
        throw new Error(`google embedding response missing numeric values for model=${model}`);
      }

      return values.map((value) => Number(value));
    }

    throw new Error(`${lastErrorMessage}; modelsTried=${modelsTried.join(',')}`);
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly model = DEFAULT_OLLAMA_EMBEDDING_MODEL) {}

  async embed(text: string): Promise<number[]> {
    const host = process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434';
    const response = await fetch(`${host.replace(/\/$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`ollama embedding request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      embedding?: unknown;
    };

    if (!Array.isArray(payload.embedding)) {
      throw new Error('ollama embedding response missing numeric vector');
    }

    return payload.embedding.map((value) => Number(value));
  }
}

export class AutoEmbeddingProvider implements EmbeddingProvider {
  private resolved: EmbeddingProvider | null = null;

  private buildResolvedProvider(): EmbeddingProvider {
    const provider = resolveProviderName();

    switch (provider) {
      case 'google':
        return new GoogleEmbeddingProvider();
      case 'openai':
        return new OpenAIEmbeddingProvider();
      case 'openai_compatible':
        return new OpenAIEmbeddingProvider(DEFAULT_MODEL, 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_URL');
      case 'ollama':
        return new OllamaEmbeddingProvider();
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.resolved) {
      this.resolved = this.buildResolvedProvider();
    }

    return this.resolved.embed(text);
  }
}

export function buildTrajectoryEmbeddingText(input: {
  description: string;
  result: string | null;
  provider: string;
  model: string;
  success: boolean;
}): string {
  return [
    `task: ${input.description}`,
    `provider: ${input.provider}`,
    `model: ${input.model}`,
    `success: ${input.success ? 'yes' : 'no'}`,
    input.result ? `result: ${input.result}` : 'result: none',
  ].join('\n');
}

export function serializeEmbedding(vector: number[]): Buffer {
  return Buffer.from(Float32Array.from(vector).buffer);
}

export function deserializeEmbedding(blob: Buffer): number[] {
  const vector = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / Float32Array.BYTES_PER_ELEMENT);
  return Array.from(vector);
}
