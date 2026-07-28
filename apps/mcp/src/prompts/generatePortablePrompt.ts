import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCausalityCapturePrompt } from './capturePrompt.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(currentDirectory, '../../../../prompts/causality-capture.md');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, buildCausalityCapturePrompt(), 'utf8');
