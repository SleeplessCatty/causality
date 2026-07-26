import { describe, expect, it } from 'vitest';

import { classifySemanticFailure } from '../src/jobs/failureClassifier.js';
import {
  ModelFileMissingError,
  ModelHashMismatchError,
  ModelSizeMismatchError,
  ModelDownloadNetworkError,
  ModelDownloadTimeoutError,
} from '../src/model/modelDownloader.js';
import {
  ModelLoadTransientError,
  ModelMemoryInsufficientError,
  ModelRuntimeIncompatibleError,
} from '../src/model/transformersRuntime.js';

describe('classifySemanticFailure', () => {
  it('classifies typed validation failures as manual recovery', () => {
    expect(classifySemanticFailure('verify', new ModelFileMissingError('config.json'))).toEqual({
      kind: 'manual',
      code: 'MODEL_FILE_MISSING',
      message: 'Model file is missing: config.json',
    });
    expect(classifySemanticFailure('verify', new ModelSizeMismatchError('model.onnx'))).toEqual({
      kind: 'manual',
      code: 'MODEL_SIZE_MISMATCH',
      message: 'Model file size mismatch: model.onnx',
    });
    expect(classifySemanticFailure('verify', new ModelHashMismatchError('model.onnx'))).toEqual({
      kind: 'manual',
      code: 'MODEL_HASH_MISMATCH',
      message: 'Model file checksum mismatch: model.onnx',
    });
  });

  it('classifies download timeouts, network failures, and storage exhaustion', () => {
    const networkError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const storageError = Object.assign(new Error('no space left'), { code: 'ENOSPC' });

    expect(classifySemanticFailure('download', new ModelDownloadTimeoutError())).toMatchObject({
      kind: 'retryable',
      code: 'DOWNLOAD_TIMEOUT',
    });
    expect(
      classifySemanticFailure('download', new ModelDownloadNetworkError('HTTP 503')),
    ).toMatchObject({
      kind: 'retryable',
      code: 'DOWNLOAD_NETWORK_ERROR',
    });
    expect(classifySemanticFailure('download', networkError)).toMatchObject({
      kind: 'retryable',
      code: 'DOWNLOAD_NETWORK_ERROR',
    });
    expect(classifySemanticFailure('download', new TypeError('fetch failed'))).toMatchObject({
      kind: 'retryable',
      code: 'DOWNLOAD_NETWORK_ERROR',
    });
    expect(classifySemanticFailure('download', storageError)).toMatchObject({
      kind: 'manual',
      code: 'MODEL_STORAGE_FULL',
    });
  });

  it('classifies explicit and recognizable runtime load failures', () => {
    expect(
      classifySemanticFailure('load', new ModelLoadTransientError('runtime busy')),
    ).toMatchObject({
      kind: 'retryable',
      code: 'MODEL_LOAD_TRANSIENT',
    });
    expect(
      classifySemanticFailure('load', new ModelMemoryInsufficientError('out of memory')),
    ).toMatchObject({
      kind: 'manual',
      code: 'MODEL_MEMORY_INSUFFICIENT',
    });
    expect(
      classifySemanticFailure(
        'load',
        new ModelRuntimeIncompatibleError('Error loading shared library ld-linux-aarch64.so.1'),
      ),
    ).toMatchObject({
      kind: 'manual',
      code: 'MODEL_RUNTIME_INCOMPATIBLE',
    });
    expect(
      classifySemanticFailure('load', new Error('ONNX RuntimeError: invalid graph')),
    ).toMatchObject({
      kind: 'manual',
      code: 'MODEL_RUNTIME_INCOMPATIBLE',
    });
  });

  it('treats unknown failures as manual and bounds their message', () => {
    const failure = classifySemanticFailure('load', new Error('unknown'.repeat(100)));

    expect(failure).toMatchObject({
      kind: 'manual',
      code: 'MODEL_RUNTIME_INCOMPATIBLE',
    });
    expect(failure.message).toHaveLength(500);
  });
});
