/**
 * Signal Embedding Service
 * Generates embeddings for signal topics using OpenAI embeddings API.
 * Used by the clustering engine for semantic similarity.
 */

import OpenAI from 'openai';

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

// Singleton — reuses HTTP connection pool across embedding calls
let _embeddingClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_embeddingClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY for embeddings');
    _embeddingClient = new OpenAI({ apiKey });
  }
  return _embeddingClient;
}

/**
 * Generate embedding vector for a topic string.
 * Returns array of 1536 floats compatible with pgvector vector(1536).
 * Uses OpenAI text-embedding-3-small by default.
 */
export async function generateTopicEmbedding(topic: string): Promise<number[]> {
  const text = (topic ?? '').trim();
  if (!text) {
    throw new Error('Cannot embed empty topic');
  }

  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8191), // model limit
    dimensions: EMBEDDING_DIM,
  });

  const embedding = response.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid embedding response: expected ${EMBEDDING_DIM} dimensions`);
  }

  return embedding;
}

/**
 * Format embedding as pgvector string: '[0.1,0.2,...]'
 */
export function embeddingToPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns value in [-1, 1] (1 = identical).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
