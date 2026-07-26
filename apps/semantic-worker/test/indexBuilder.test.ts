import { describe, expect, it } from 'vitest';

import { semanticIndexBatchSize } from '../src/jobs/indexBuilder.js';

describe('semantic index batch sizing', () => {
  it('keeps transformer inference batches safe for memory-constrained local containers', () => {
    expect(semanticIndexBatchSize('multilingual-e5-small')).toBe(4);
    expect(semanticIndexBatchSize('bge-small-zh-v1.5')).toBe(8);
    expect(semanticIndexBatchSize('granite-embedding-97m-multilingual-r2')).toBe(4);
    expect(semanticIndexBatchSize('bge-m3')).toBe(1);
  });
});
