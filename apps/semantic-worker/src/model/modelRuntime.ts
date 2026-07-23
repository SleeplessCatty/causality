import type { SemanticModelDefinition } from '@causality/semantic-core';

export interface EmbeddingRuntime {
  load(model: SemanticModelDefinition, localPath: string): Promise<void>;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  dispose(): Promise<void>;
}
