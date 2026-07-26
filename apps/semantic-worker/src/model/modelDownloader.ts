import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { SemanticModelDefinition, SemanticModelFile } from '@causality/semantic-core';

interface ReadyManifest {
  modelCode: string;
  revision: string;
  files: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface PinnedModelDownloaderOptions {
  fetch?: FetchLike;
  requestIdleTimeoutMilliseconds?: number;
}

export class ModelFileMissingError extends Error {
  public constructor(path: string) {
    super(`Model file is missing: ${path}`);
    this.name = 'ModelFileMissingError';
  }
}

export class ModelSizeMismatchError extends Error {
  public constructor(path: string) {
    super(`Model file size mismatch: ${path}`);
    this.name = 'ModelSizeMismatchError';
  }
}

export class ModelHashMismatchError extends Error {
  public constructor(path: string) {
    super(`Model file checksum mismatch: ${path}`);
    this.name = 'ModelHashMismatchError';
  }
}

export class ModelDownloadTimeoutError extends Error {
  public constructor() {
    super('Model download timed out');
    this.name = 'ModelDownloadTimeoutError';
  }
}

export class ModelDownloadNetworkError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelDownloadNetworkError';
  }
}

export interface ModelDownloader {
  download(
    model: SemanticModelDefinition,
    targetDirectory: string,
    onProgress: (loadedBytes: number, totalBytes: number) => Promise<void>,
  ): Promise<void>;
}

function assertSafeManifestPath(path: string): void {
  const normalized = path.replaceAll('\\', '/');
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`Unsafe model manifest path: ${path}`);
  }
}

function assertPinnedTarget(model: SemanticModelDefinition, targetDirectory: string): string {
  const modelsDirectory = dirname(dirname(resolve(targetDirectory)));
  const expected = resolve(modelsDirectory, model.code, model.revision);
  if (resolve(targetDirectory) !== expected) {
    throw new Error('Model target does not match the pinned model code and revision');
  }
  return modelsDirectory;
}

function fileUrl(model: SemanticModelDefinition, file: SemanticModelFile): string {
  const encodedPath = file.remotePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${encodedPath}`;
}

async function hashFile(path: string): Promise<string> {
  const handle = await open(path, 'r');
  const hash = createHash('sha256');
  try {
    for await (const chunk of handle.readableWebStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export async function validateReadyModel(
  model: SemanticModelDefinition,
  targetDirectory: string,
): Promise<void> {
  let rawManifest: string;
  try {
    rawManifest = await readFile(join(targetDirectory, 'READY.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ModelFileMissingError('READY.json');
    }
    throw error;
  }

  let manifest: Partial<ReadyManifest>;
  try {
    manifest = JSON.parse(rawManifest) as Partial<ReadyManifest>;
  } catch {
    throw new ModelHashMismatchError('READY.json');
  }
  if (manifest.modelCode !== model.code || manifest.revision !== model.revision) {
    throw new ModelHashMismatchError('READY.json');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== model.files.length) {
    throw new ModelHashMismatchError('READY.json');
  }

  for (const file of model.files) {
    assertSafeManifestPath(file.localPath);
    const path = join(targetDirectory, file.localPath);
    let metadata;
    try {
      metadata = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ModelFileMissingError(file.localPath);
      }
      throw error;
    }
    if (!metadata.isFile() || metadata.size !== file.bytes) {
      throw new ModelSizeMismatchError(file.localPath);
    }
    if ((await hashFile(path)) !== file.sha256) {
      throw new ModelHashMismatchError(file.localPath);
    }
    const readyFile = manifest.files.find((entry) => entry.path === file.localPath);
    if (!readyFile || readyFile.bytes !== file.bytes || readyFile.sha256 !== file.sha256) {
      throw new ModelHashMismatchError('READY.json');
    }
  }
}

export async function verifyReadyModel(
  model: SemanticModelDefinition,
  targetDirectory: string,
): Promise<boolean> {
  try {
    assertPinnedTarget(model, targetDirectory);
    await validateReadyModel(model, targetDirectory);
    return true;
  } catch {
    return false;
  }
}

export async function removeModelVersion(
  model: SemanticModelDefinition,
  targetDirectory: string,
): Promise<void> {
  const modelsDirectory = assertPinnedTarget(model, targetDirectory);
  await Promise.all([
    rm(targetDirectory, { recursive: true, force: true }),
    rm(join(modelsDirectory, '.partial', model.code), { recursive: true, force: true }),
  ]);
}

async function publishDirectory(partialDirectory: string, targetDirectory: string): Promise<void> {
  const parent = dirname(targetDirectory);
  const backup = `${targetDirectory}.previous-${randomUUID()}`;
  await mkdir(parent, { recursive: true });

  let movedExisting = false;
  try {
    await rename(targetDirectory, backup);
    movedExisting = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await rename(partialDirectory, targetDirectory);
  } catch (error) {
    if (movedExisting) await rename(backup, targetDirectory);
    throw error;
  }

  if (movedExisting) await rm(backup, { recursive: true, force: true });
}

export class PinnedModelDownloader implements ModelDownloader {
  private readonly fetch: FetchLike;
  private readonly requestIdleTimeoutMilliseconds: number;

  public constructor(options: PinnedModelDownloaderOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.requestIdleTimeoutMilliseconds = options.requestIdleTimeoutMilliseconds ?? 120_000;
    if (
      !Number.isInteger(this.requestIdleTimeoutMilliseconds) ||
      this.requestIdleTimeoutMilliseconds < 1
    ) {
      throw new Error('Model download idle timeout must be a positive integer');
    }
  }

  public async download(
    model: SemanticModelDefinition,
    targetDirectory: string,
    onProgress: (loadedBytes: number, totalBytes: number) => Promise<void>,
  ): Promise<void> {
    const modelsDirectory = assertPinnedTarget(model, targetDirectory);
    for (const file of model.files) {
      assertSafeManifestPath(file.localPath);
      assertSafeManifestPath(file.remotePath);
    }
    if (await verifyReadyModel(model, targetDirectory)) {
      await onProgress(model.expectedDownloadBytes, model.expectedDownloadBytes);
      return;
    }

    const partialModelDirectory = join(modelsDirectory, '.partial', model.code, model.revision);
    const partialCodeDirectory = dirname(partialModelDirectory);
    await rm(partialCodeDirectory, { recursive: true, force: true });
    await mkdir(partialModelDirectory, { recursive: true });

    let loadedBytes = 0;
    try {
      for (const file of model.files) {
        const destination = join(partialModelDirectory, file.localPath);
        const relativeDestination = relative(partialModelDirectory, destination);
        if (
          relativeDestination === '..' ||
          relativeDestination.startsWith(`..${sep}`) ||
          isAbsolute(relativeDestination)
        ) {
          throw new Error(`Unsafe model destination: ${file.localPath}`);
        }
        await mkdir(dirname(destination), { recursive: true });

        const controller = new AbortController();
        let idleTimeout: NodeJS.Timeout | undefined;
        const refreshIdleTimeout = () => {
          if (idleTimeout) clearTimeout(idleTimeout);
          idleTimeout = setTimeout(() => {
            controller.abort(new ModelDownloadTimeoutError());
          }, this.requestIdleTimeoutMilliseconds);
          idleTimeout.unref();
        };
        refreshIdleTimeout();
        try {
          const response = await this.fetch(fileUrl(model, file), {
            redirect: 'follow',
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new ModelDownloadNetworkError(
              `Model download failed (${response.status}): ${file.remotePath}`,
            );
          }

          const handle = await open(destination, 'wx');
          const hash = createHash('sha256');
          let fileBytes = 0;
          try {
            for await (const chunk of response.body) {
              refreshIdleTimeout();
              const bytes = Buffer.from(chunk);
              fileBytes += bytes.byteLength;
              loadedBytes += bytes.byteLength;
              if (fileBytes > file.bytes || loadedBytes > model.expectedDownloadBytes) {
                throw new ModelSizeMismatchError(file.localPath);
              }
              hash.update(bytes);
              await handle.write(bytes);
              await onProgress(loadedBytes, model.expectedDownloadBytes);
            }
          } finally {
            await handle.close();
          }

          if (fileBytes !== file.bytes) {
            throw new ModelSizeMismatchError(file.localPath);
          }
          if (hash.digest('hex') !== file.sha256) {
            throw new ModelHashMismatchError(file.localPath);
          }
        } finally {
          if (idleTimeout) clearTimeout(idleTimeout);
        }
      }

      if (loadedBytes !== model.expectedDownloadBytes) {
        throw new ModelSizeMismatchError('download manifest total');
      }
      const readyManifest: ReadyManifest = {
        modelCode: model.code,
        revision: model.revision,
        files: model.files.map((file) => ({
          path: file.localPath,
          bytes: file.bytes,
          sha256: file.sha256,
        })),
      };
      await writeFile(
        join(partialModelDirectory, 'READY.json'),
        `${JSON.stringify(readyManifest, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      await validateReadyModel(model, partialModelDirectory);
      await publishDirectory(partialModelDirectory, targetDirectory);
      await rm(partialCodeDirectory, { recursive: true, force: true });
      await onProgress(model.expectedDownloadBytes, model.expectedDownloadBytes);
    } catch (error) {
      await rm(partialCodeDirectory, { recursive: true, force: true });
      throw error;
    }
  }
}
