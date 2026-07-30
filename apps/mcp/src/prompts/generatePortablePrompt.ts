import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAnalyzeEventPrompt } from './analyzeEventPrompt.js';
import { buildCausalityCapturePrompt } from './capturePrompt.js';
import { buildInferOutcomesPrompt } from './inferOutcomesPrompt.js';
import { buildReviewChainPrompt } from './reviewChainPrompt.js';
import { buildTracePathPrompt } from './tracePathPrompt.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const promptDirectory = resolve(currentDirectory, '../../../../prompts');
const outputs = [
  ['causality-capture.md', buildCausalityCapturePrompt()],
  ['causality-analyze-event.md', buildAnalyzeEventPrompt()],
  ['causality-trace-path.md', buildTracePathPrompt()],
  ['causality-review-chain.md', buildReviewChainPrompt()],
  ['causality-infer-outcomes.md', buildInferOutcomesPrompt()],
] as const;

await mkdir(promptDirectory, { recursive: true });
await Promise.all(
  outputs.map(([name, content]) => writeFile(resolve(promptDirectory, name), content, 'utf8')),
);
