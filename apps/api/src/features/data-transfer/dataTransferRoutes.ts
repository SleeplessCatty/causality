import path from 'node:path';

import {
  apiErrorSchema,
  exportAvailabilityResponseSchema,
  exportPreviewInputSchema,
  exportPreviewResponseSchema,
  importBatchListResponseSchema,
  importBatchSummarySchema,
  importDetailQuerySchema,
  importHistoryQuerySchema,
  importRecordListResponseSchema,
  importUploadResponseSchema,
  type ApiErrorCode,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { CsvFileError, parseImportCsv } from './csvCodec.js';
import {
  ImportError,
  PostgresImportRepository,
  type ImportRepository,
} from './importRepository.js';
import {
  PostgresImportHistoryRepository,
  type ImportHistoryRepository,
} from './importHistoryRepository.js';
import { ImportService } from './importService.js';
import {
  ExportRequestError,
} from './exportRequestRepository.js';
import {
  ExportScopeError,
} from './exportScopeRepository.js';
import {
  createExportService,
  ExportService,
  ExportServiceError,
  type ExportServiceOptions,
} from './exportService.js';

const DEFAULT_IMPORT_TIMEOUT_MS = 5 * 60 * 1000;

export interface DataTransferRouteOptions {
  importTimeoutMs?: number;
  importRepository?: ImportRepository;
  historyRepository?: ImportHistoryRepository;
  exportService?: ExportService;
  exportServiceOptions?: ExportServiceOptions;
}

class UploadValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

function sanitizeFilename(filename: string): string {
  return [...path.posix.basename(filename.replaceAll('\\', '/'))]
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('')
    .trim();
}

function sendApiError(
  reply: FastifyReply,
  status: 400 | 408 | 409 | 410 | 413,
  code: ApiErrorCode,
  message: string,
) {
  return reply.status(status).send({ code, message });
}

function sendExportError(error: unknown, reply: FastifyReply) {
  if (
    error instanceof ExportServiceError ||
    error instanceof ExportRequestError ||
    error instanceof ExportScopeError
  ) {
    return sendApiError(
      reply,
      error.code === 'EXPORT_TOKEN_EXPIRED' ? 410 : 400,
      error.code,
      error.message,
    );
  }
  throw error;
}

function multipartErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function sendImportError(error: unknown, reply: FastifyReply, timedOut: boolean) {
  if (timedOut) {
    return sendApiError(reply, 408, 'IMPORT_TIMEOUT', '导入处理超时');
  }
  if (error instanceof UploadValidationError) {
    return sendApiError(reply, 400, 'VALIDATION_ERROR', error.message);
  }
  if (error instanceof CsvFileError) {
    return sendApiError(
      reply,
      error.code === 'CSV_FILE_TOO_LARGE' ? 413 : 400,
      error.code,
      error.message,
    );
  }
  if (error instanceof ImportError) {
    const status =
      error.code === 'IMPORT_CONFLICT_RETRY'
        ? 409
        : error.code === 'IMPORT_CANCELLED' || error.code === 'IMPORT_TIMEOUT'
          ? 408
          : 400;
    return sendApiError(reply, status, error.code, error.message);
  }

  switch (multipartErrorCode(error)) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return sendApiError(reply, 413, 'CSV_FILE_TOO_LARGE', 'CSV 文件不能超过 20 MiB');
    case 'FST_FILES_LIMIT':
    case 'FST_PARTS_LIMIT':
      return sendApiError(reply, 400, 'VALIDATION_ERROR', '每次只能上传一个 CSV 文件');
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
      return sendApiError(reply, 400, 'VALIDATION_ERROR', '请选择一个 CSV 文件');
    default:
      throw error;
  }
}

function connectRequestAbort(
  request: FastifyRequest,
  reply: FastifyReply,
  controller: AbortController,
): () => void {
  const abort = () => controller.abort();
  const abortIfUnfinished = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', abortIfUnfinished);
  return () => {
    request.raw.off('aborted', abort);
    reply.raw.off('close', abortIfUnfinished);
  };
}

export function registerDataTransferRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: DataTransferRouteOptions = {},
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const importService = new ImportService(
    options.importRepository ?? new PostgresImportRepository(pool),
  );
  const historyRepository = options.historyRepository ?? new PostgresImportHistoryRepository(pool);
  const exportService =
    options.exportService ?? createExportService(pool, options.exportServiceOptions);
  const importTimeoutMs = options.importTimeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS;
  const batchParamsSchema = z.object({ batchId: z.uuid() }).strict();
  const exportTokenParamsSchema = z.object({ token: z.string().min(1).max(512) }).strict();

  routes.post(
    '/api/data-transfers/exports/preview',
    {
      schema: {
        tags: ['data-transfers'],
        body: exportPreviewInputSchema,
        response: {
          200: exportPreviewResponseSchema,
          400: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await exportService.previewExport(request.body);
      } catch (error) {
        return sendExportError(error, reply);
      }
    },
  );

  routes.get(
    '/api/data-transfers/exports/:token/availability',
    {
      schema: {
        tags: ['data-transfers'],
        params: exportTokenParamsSchema,
        response: {
          200: exportAvailabilityResponseSchema,
          400: apiErrorSchema,
          410: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await exportService.checkExportAvailability(request.params.token);
      } catch (error) {
        return sendExportError(error, reply);
      }
    },
  );

  routes.post(
    '/api/data-transfers/imports',
    {
      schema: {
        tags: ['data-transfers'],
        response: {
          201: importUploadResponseSchema,
          400: apiErrorSchema,
          408: apiErrorSchema,
          409: apiErrorSchema,
          413: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, importTimeoutMs);
      const disconnectRequestAbort = connectRequestAbort(request, reply, controller);

      try {
        let filename: string | undefined;
        let parseResult: Awaited<ReturnType<typeof parseImportCsv>> | undefined;

        for await (const part of request.parts()) {
          if (part.type !== 'file') {
            throw new UploadValidationError('上传内容只能包含 CSV 文件');
          }
          if (part.fieldname !== 'file') {
            part.file.resume();
            throw new UploadValidationError('上传字段必须命名为 file');
          }
          if (filename !== undefined) {
            part.file.resume();
            throw new UploadValidationError('每次只能上传一个 CSV 文件');
          }

          filename = sanitizeFilename(part.filename);
          if (filename.length === 0) {
            part.file.resume();
            throw new UploadValidationError('CSV 文件名不能为空');
          }
          if (!filename.toLowerCase().endsWith('.csv')) {
            part.file.resume();
            throw new UploadValidationError('文件扩展名必须为 .csv');
          }
          try {
            parseResult = await parseImportCsv(part.file, controller.signal);
          } catch (error) {
            if (part.file.truncated) {
              throw new CsvFileError('CSV_FILE_TOO_LARGE', 'CSV 文件不能超过 20 MiB', {
                cause: error,
              });
            }
            throw error;
          }
          if (part.file.truncated) {
            throw new CsvFileError('CSV_FILE_TOO_LARGE', 'CSV 文件不能超过 20 MiB');
          }
        }

        if (!filename || !parseResult) {
          throw new UploadValidationError('请选择一个 CSV 文件');
        }
        const result = await importService.execute({
          filename,
          parseResult,
          signal: controller.signal,
        });
        return reply.status(201).send(result);
      } catch (error) {
        return sendImportError(error, reply, timedOut);
      } finally {
        clearTimeout(timeout);
        disconnectRequestAbort();
      }
    },
  );

  routes.get(
    '/api/data-transfers/imports',
    {
      schema: {
        tags: ['data-transfers'],
        querystring: importHistoryQuerySchema,
        response: {
          200: importBatchListResponseSchema,
          400: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request) => historyRepository.listBatches(request.query),
  );

  routes.get(
    '/api/data-transfers/imports/:batchId',
    {
      schema: {
        tags: ['data-transfers'],
        params: batchParamsSchema,
        response: {
          200: importBatchSummarySchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const batch = await historyRepository.findBatch(request.params.batchId);
      if (!batch) {
        return reply.status(404).send({
          code: 'IMPORT_BATCH_NOT_FOUND',
          message: '导入记录不存在',
        });
      }
      return batch;
    },
  );

  routes.get(
    '/api/data-transfers/imports/:batchId/records',
    {
      schema: {
        tags: ['data-transfers'],
        params: batchParamsSchema,
        querystring: importDetailQuerySchema,
        response: {
          200: importRecordListResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const records = await historyRepository.listRecords(request.params.batchId, request.query);
      if (!records) {
        return reply.status(404).send({
          code: 'IMPORT_BATCH_NOT_FOUND',
          message: '导入记录不存在',
        });
      }
      return records;
    },
  );
}
