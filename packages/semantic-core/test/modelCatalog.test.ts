import { describe, expect, it } from 'vitest';

import { MODEL_CATALOG, semanticModelCodes } from '../src/index.js';

describe('semantic model catalog', () => {
  it('contains only the two approved pinned models', () => {
    expect(semanticModelCodes).toEqual(['multilingual-e5-small', 'bge-m3']);
    expect(MODEL_CATALOG['multilingual-e5-small']).toMatchObject({
      revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
      dimensions: 384,
      dtype: 'q8',
      pooling: 'mean',
      queryPrefix: 'query: ',
      documentPrefix: 'passage: ',
      defaultThreshold: 70,
    });
    expect(MODEL_CATALOG['bge-m3']).toMatchObject({
      revision: '25b9af8e87a38eb120cfe87125383677b9cd309e',
      dimensions: 1024,
      dtype: 'q8',
      pooling: 'cls',
      queryPrefix: '',
      documentPrefix: '',
      defaultThreshold: 55,
    });
  });

  it('pins every file to a size and SHA-256 digest', () => {
    for (const model of Object.values(MODEL_CATALOG)) {
      expect(model.files.length).toBeGreaterThanOrEqual(5);
      expect(model.expectedDownloadBytes).toBe(
        model.files.reduce((total, file) => total + file.bytes, 0),
      );
      for (const file of model.files) {
        expect(file.remotePath).not.toContain('..');
        expect(file.localPath).not.toContain('..');
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });
});
