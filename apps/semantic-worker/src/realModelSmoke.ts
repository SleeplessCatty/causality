import { join, resolve } from 'node:path';

import { MODEL_CATALOG } from '@causality/semantic-core';

import { PinnedModelDownloader } from './model/modelDownloader.js';
import { TransformersEmbeddingRuntime } from './model/transformersRuntime.js';
import { parseSmokeModelCode } from './smokeArguments.js';

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

const modelCode = parseSmokeModelCode(process.argv.slice(2));
const model = MODEL_CATALOG[modelCode];
const modelsDirectory = resolve(
  process.env.CAUSALITY_MODEL_DIRECTORY ?? join(process.cwd(), '.cache', 'semantic-models'),
);
const target = join(modelsDirectory, model.code, model.revision);
const runtime = new TransformersEmbeddingRuntime({ modelsDirectory });
let downloadedBytes = 0;

try {
  await new PinnedModelDownloader().download(model, target, async (loadedBytes) => {
    downloadedBytes = loadedBytes;
  });
  await runtime.load(model, target);
  const query = await runtime.embedQuery('央行提高政策利率');
  const [related, unrelated] = await runtime.embedDocuments([
    '中央银行宣布上调基准利率，融资成本随之上升',
    '消费电子公司发布新款手机并扩大零售渠道',
  ]);
  if (!related || !unrelated || query.length !== model.dimensions) {
    throw new Error('Real model returned unexpected embedding dimensions');
  }
  if (cosine(query, related) <= cosine(query, unrelated)) {
    throw new Error('Real model semantic similarity ordering failed');
  }
  process.stdout.write(
    `model=${model.code} dimensions=${query.length} semantic_order=pass downloaded_bytes=${downloadedBytes}\n`,
  );
} finally {
  await runtime.dispose();
}
