import {
  ModelDownloadTimeoutError,
  ModelDownloadNetworkError,
  ModelFileMissingError,
  ModelHashMismatchError,
  ModelSizeMismatchError,
} from '../model/modelDownloader.js';
import {
  ModelLoadTransientError,
  ModelMemoryInsufficientError,
  ModelRuntimeIncompatibleError,
} from '../model/transformersRuntime.js';

export type SemanticFailureStage = 'download' | 'verify' | 'load';

export interface ClassifiedSemanticFailure {
  kind: 'retryable' | 'manual';
  code:
    | 'DOWNLOAD_NETWORK_ERROR'
    | 'DOWNLOAD_TIMEOUT'
    | 'MODEL_STORAGE_FULL'
    | 'MODEL_FILE_MISSING'
    | 'MODEL_SIZE_MISMATCH'
    | 'MODEL_HASH_MISMATCH'
    | 'MODEL_LOAD_TRANSIENT'
    | 'MODEL_RUNTIME_INCOMPATIBLE'
    | 'MODEL_MEMORY_INSUFFICIENT';
  message: string;
}

interface ErrorWithCode {
  code?: unknown;
  cause?: unknown;
}

const NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
]);
const TRANSIENT_LOAD_CODES = new Set(['EAGAIN', 'EBUSY', 'EMFILE', 'ENFILE', 'ETIMEDOUT']);

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function errorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const code = (current as ErrorWithCode).code;
    if (typeof code === 'string') return code;
    current = (current as ErrorWithCode).cause;
  }
  return undefined;
}

function classified(
  kind: ClassifiedSemanticFailure['kind'],
  code: ClassifiedSemanticFailure['code'],
  error: unknown,
): ClassifiedSemanticFailure {
  return { kind, code, message: errorMessage(error) };
}

export function classifySemanticFailure(
  stage: SemanticFailureStage,
  error: unknown,
): ClassifiedSemanticFailure {
  const code = errorCode(error);

  if (error instanceof ModelFileMissingError) {
    return classified('manual', 'MODEL_FILE_MISSING', error);
  }
  if (error instanceof ModelSizeMismatchError) {
    return classified('manual', 'MODEL_SIZE_MISMATCH', error);
  }
  if (error instanceof ModelHashMismatchError) {
    return classified('manual', 'MODEL_HASH_MISMATCH', error);
  }
  if (error instanceof ModelDownloadTimeoutError) {
    return classified('retryable', 'DOWNLOAD_TIMEOUT', error);
  }
  if (error instanceof ModelDownloadNetworkError) {
    return classified('retryable', 'DOWNLOAD_NETWORK_ERROR', error);
  }
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return classified('manual', 'MODEL_STORAGE_FULL', error);
  }
  if (stage === 'download' && (error instanceof TypeError || NETWORK_CODES.has(code ?? ''))) {
    return classified('retryable', 'DOWNLOAD_NETWORK_ERROR', error);
  }

  if (error instanceof ModelLoadTransientError) {
    return classified('retryable', 'MODEL_LOAD_TRANSIENT', error);
  }
  if (error instanceof ModelMemoryInsufficientError || code === 'ENOMEM') {
    return classified('manual', 'MODEL_MEMORY_INSUFFICIENT', error);
  }
  if (error instanceof ModelRuntimeIncompatibleError) {
    return classified('manual', 'MODEL_RUNTIME_INCOMPATIBLE', error);
  }
  if (stage === 'load' && TRANSIENT_LOAD_CODES.has(code ?? '')) {
    return classified('retryable', 'MODEL_LOAD_TRANSIENT', error);
  }
  if (stage === 'load') {
    const message = errorMessage(error).toLowerCase();
    if (
      message.includes('out of memory') ||
      message.includes('memory allocation') ||
      message.includes('cannot allocate memory')
    ) {
      return classified('manual', 'MODEL_MEMORY_INSUFFICIENT', error);
    }
    return classified('manual', 'MODEL_RUNTIME_INCOMPATIBLE', error);
  }

  if (stage === 'download') return classified('manual', 'MODEL_STORAGE_FULL', error);
  return classified('manual', 'MODEL_HASH_MISMATCH', error);
}
