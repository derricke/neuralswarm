import OpenAI from 'openai';
import type { EmbeddingProvider } from './types';

const DEFAULT_MODEL = 'text-embedding-3-small';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(private readonly model = DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async embed(text: string): Promise<number[]> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for learning-engine embeddings');
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });

    return response.data[0]?.embedding ?? [];
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
