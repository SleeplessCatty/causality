import multipart from '@fastify/multipart';
import type {
  ImportBatchListResponse,
  ImportBatchSummary,
  ImportDetailQuery,
  ImportHistoryQuery,
  ImportRecordListResponse,
} from '@causality/contracts';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ImportError,
  type ImportCommitCommand,
  type ImportCommitResult,
  type ImportRepository,
} from '../src/features/data-transfer/importRepository.js';
import type { ImportHistoryRepository } from '../src/features/data-transfer/importHistoryRepository.js';
import { registerDataTransferRoutes } from '../src/features/data-transfer/dataTransferRoutes.js';

const validBatch: ImportBatchSummary = {
  id: 'f1000000-0000-4000-8000-000000000001',
  filename: '有效数据.csv',
  completedAt: '2026-07-27T08:00:00.000Z',
  recordTypes: ['event'],
  counts: {
    event: { created: 1, reused: 0 },
    case: { created: 0, reused: 0 },
    relation: { created: 0, reused: 0 },
    relationCase: { created: 0, reused: 0 },
  },
};

class RecordingImportRepository implements ImportRepository {
  public commands: ImportCommitCommand[] = [];

  public constructor(
    private readonly execute: (
      command: ImportCommitCommand,
    ) => Promise<ImportCommitResult> = async () => ({ batch: validBatch }),
  ) {}

  public commit(command: ImportCommitCommand): Promise<ImportCommitResult> {
    this.commands.push(command);
    return this.execute(command);
  }
}

class RecordingHistoryRepository implements ImportHistoryRepository {
  public historyQueries: ImportHistoryQuery[] = [];
  public batchIds: string[] = [];
  public recordQueries: Array<{ batchId: string; query: ImportDetailQuery }> = [];

  public constructor(
    private readonly batches: ImportBatchListResponse = {
      items: [validBatch],
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
    },
    private readonly batch: ImportBatchSummary | null = validBatch,
    private readonly records: ImportRecordListResponse | null = {
      items: [
        {
          id: 'f2000000-0000-4000-8000-000000000001',
          sequence: 1,
          outcome: 'created',
          text: { type: 'event', eventName: '测试事件' },
        },
      ],
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
    },
  ) {}

  public listBatches(query: ImportHistoryQuery): Promise<ImportBatchListResponse> {
    this.historyQueries.push(query);
    return Promise.resolve(this.batches);
  }

  public findBatch(batchId: string): Promise<ImportBatchSummary | null> {
    this.batchIds.push(batchId);
    return Promise.resolve(this.batch);
  }

  public listRecords(
    batchId: string,
    query: ImportDetailQuery,
  ): Promise<ImportRecordListResponse | null> {
    this.recordQueries.push({ batchId, query });
    return Promise.resolve(this.records);
  }
}

interface MultipartFileInput {
  fieldname?: string;
  filename: string;
  content: Buffer | string;
  mimetype?: string;
}

function multipartPayload(files: MultipartFileInput[]): {
  body: Buffer;
  headers: Record<string, string>;
} {
  const boundary = 'causality-test-boundary';
  const chunks: Buffer[] = [];
  for (const file of files) {
    const headers = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="${file.fieldname ?? 'file'}"; filename="${file.filename}"\r\n`,
      ...(file.mimetype ? [`Content-Type: ${file.mimetype}\r\n`] : []),
      '\r\n',
    ];
    chunks.push(Buffer.from(headers.join(''), 'utf8'));
    chunks.push(typeof file.content === 'string' ? Buffer.from(file.content) : file.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function validEventCsv(name = '测试事件'): string {
  return `"原子事件","${name}","","",""\n`;
}

async function createRouteTestApp(
  repository: ImportRepository,
  options: {
    importTimeoutMs?: number;
    historyRepository?: ImportHistoryRepository;
  } = {},
) {
  const app = Fastify({ logger: false });
  void app.register(multipart, {
    limits: {
      files: 1,
      parts: 1,
      fileSize: 20 * 1024 * 1024,
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const validationError = error as { validation?: unknown };
    if (validationError.validation) {
      void reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不合法',
      });
      return;
    }
    void reply.send(error);
  });
  app.after(() => {
    registerDataTransferRoutes(app, {} as Pool, {
      importRepository: repository,
      ...(options.importTimeoutMs === undefined
        ? {}
        : { importTimeoutMs: options.importTimeoutMs }),
      ...(options.historyRepository === undefined
        ? {}
        : { historyRepository: options.historyRepository }),
    });
  });
  await app.ready();
  return app;
}

describe('data transfer import routes', () => {
  const apps: Array<Awaited<ReturnType<typeof createRouteTestApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('rejects a multipart request without the required file', async () => {
    const app = await createRouteTestApp(new RecordingImportRepository());
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'VALIDATION_ERROR',
      message: '请选择一个 CSV 文件',
    });
  });

  it('rejects the wrong field name and multiple files with stable validation errors', async () => {
    const app = await createRouteTestApp(new RecordingImportRepository());
    apps.push(app);

    const wrongField = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([
        { fieldname: 'attachment', filename: '错误字段.csv', content: validEventCsv() },
      ]),
    });
    const multipleFiles = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([
        { filename: '一.csv', content: validEventCsv('事件一') },
        { filename: '二.csv', content: validEventCsv('事件二') },
      ]),
    });

    expect(wrongField.statusCode).toBe(400);
    expect(wrongField.json()).toEqual({
      code: 'VALIDATION_ERROR',
      message: '上传字段必须命名为 file',
    });
    expect(multipleFiles.statusCode).toBe(400);
    expect(multipleFiles.json()).toEqual({
      code: 'VALIDATION_ERROR',
      message: '每次只能上传一个 CSV 文件',
    });
  });

  it('rejects a non-CSV filename before committing any records', async () => {
    const repository = new RecordingImportRepository();
    const app = await createRouteTestApp(repository);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([{ filename: '数据.txt', content: validEventCsv() }]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'VALIDATION_ERROR',
      message: '文件扩展名必须为 .csv',
    });
    expect(repository.commands).toHaveLength(0);
  });

  it('accepts valid strict CSV independently of unusual or absent MIME types', async () => {
    const repository = new RecordingImportRepository();
    const app = await createRouteTestApp(repository);
    apps.push(app);

    const unusualMime = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([
        {
          filename: '../控制\u0001名称.csv',
          content: validEventCsv('异常 MIME 事件'),
          mimetype: 'application/x-causality-data',
        },
      ]),
    });
    const absentMime = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([{ filename: '无 MIME.csv', content: validEventCsv('无 MIME 事件') }]),
    });

    expect(unusualMime.statusCode).toBe(201);
    expect(absentMime.statusCode).toBe(201);
    expect(repository.commands.map((command) => command.filename)).toEqual([
      '控制名称.csv',
      '无 MIME.csv',
    ]);
    expect(repository.commands.map((command) => command.records[0])).toMatchObject([
      { type: 'event', name: '异常 MIME 事件' },
      { type: 'event', name: '无 MIME 事件' },
    ]);
  });

  it('returns 413 when the uploaded stream exceeds 20 MiB', async () => {
    const repository = new RecordingImportRepository();
    const app = await createRouteTestApp(repository);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([
        {
          filename: '超大.csv',
          content: Buffer.alloc(20 * 1024 * 1024 + 1, 0x61),
        },
      ]),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      code: 'CSV_FILE_TOO_LARGE',
      message: 'CSV 文件不能超过 20 MiB',
    });
    expect(repository.commands).toHaveLength(0);
  });

  it('aborts an over-time import and returns a stable timeout error', async () => {
    const repository = new RecordingImportRepository(
      (command) =>
        new Promise((_resolve, reject) => {
          command.signal.addEventListener(
            'abort',
            () => reject(new ImportError('IMPORT_CANCELLED', '导入任务已取消')),
            { once: true },
          );
        }),
    );
    const app = await createRouteTestApp(repository, { importTimeoutMs: 10 });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([{ filename: '超时.csv', content: validEventCsv() }]),
    });

    expect(response.statusCode).toBe(408);
    expect(response.json()).toEqual({
      code: 'IMPORT_TIMEOUT',
      message: '导入处理超时',
    });
    expect(repository.commands[0]?.signal.aborted).toBe(true);
  });

  it('preserves import error codes in the standard API error shape', async () => {
    const repository = new RecordingImportRepository(async () => {
      throw new ImportError('IMPORT_CONFLICT_RETRY', '数据已被并发修改，请重新导入');
    });
    const app = await createRouteTestApp(repository);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/data-transfers/imports',
      ...multipartPayload([{ filename: '冲突.csv', content: validEventCsv() }]),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'IMPORT_CONFLICT_RETRY',
      message: '数据已被并发修改，请重新导入',
    });
  });
});

describe('data transfer history routes', () => {
  const apps: Array<Awaited<ReturnType<typeof createRouteTestApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns history, batch summary, and filtered records through the public contracts', async () => {
    const history = new RecordingHistoryRepository();
    const app = await createRouteTestApp(new RecordingImportRepository(), {
      historyRepository: history,
    });
    apps.push(app);

    const list = await app.inject({
      method: 'GET',
      url: '/api/data-transfers/imports?page=3',
    });
    const batch = await app.inject({
      method: 'GET',
      url: `/api/data-transfers/imports/${validBatch.id}`,
    });
    const records = await app.inject({
      method: 'GET',
      url: `/api/data-transfers/imports/${validBatch.id}/records?type=event&page=2`,
    });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      items: [validBatch],
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
    });
    expect(batch.statusCode).toBe(200);
    expect(batch.json()).toEqual(validBatch);
    expect(records.statusCode).toBe(200);
    expect(records.json()).toMatchObject({
      items: [
        {
          sequence: 1,
          outcome: 'created',
          text: { type: 'event', eventName: '测试事件' },
        },
      ],
    });
    expect(history.historyQueries).toEqual([{ page: 3 }]);
    expect(history.batchIds).toEqual([validBatch.id]);
    expect(history.recordQueries).toEqual([
      { batchId: validBatch.id, query: { type: 'event', page: 2 } },
    ]);
  });

  it('returns IMPORT_BATCH_NOT_FOUND for a missing summary or detail batch', async () => {
    const history = new RecordingHistoryRepository(
      { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
      null,
      null,
    );
    const app = await createRouteTestApp(new RecordingImportRepository(), {
      historyRepository: history,
    });
    apps.push(app);

    const batch = await app.inject({
      method: 'GET',
      url: `/api/data-transfers/imports/${validBatch.id}`,
    });
    const records = await app.inject({
      method: 'GET',
      url: `/api/data-transfers/imports/${validBatch.id}/records?type=case&page=1`,
    });

    expect(batch.statusCode).toBe(404);
    expect(batch.json()).toEqual({
      code: 'IMPORT_BATCH_NOT_FOUND',
      message: '导入记录不存在',
    });
    expect(records.statusCode).toBe(404);
    expect(records.json()).toEqual({
      code: 'IMPORT_BATCH_NOT_FOUND',
      message: '导入记录不存在',
    });
  });

  it('rejects invalid batch IDs, detail types, and pages before querying storage', async () => {
    const history = new RecordingHistoryRepository();
    const app = await createRouteTestApp(new RecordingImportRepository(), {
      historyRepository: history,
    });
    apps.push(app);

    const invalidId = await app.inject({
      method: 'GET',
      url: '/api/data-transfers/imports/not-a-uuid',
    });
    const invalidType = await app.inject({
      method: 'GET',
      url: `/api/data-transfers/imports/${validBatch.id}/records?type=unknown&page=1`,
    });
    const invalidPage = await app.inject({
      method: 'GET',
      url: '/api/data-transfers/imports?page=0',
    });

    expect([invalidId.statusCode, invalidType.statusCode, invalidPage.statusCode]).toEqual([
      400, 400, 400,
    ]);
    expect(history.historyQueries).toHaveLength(0);
    expect(history.batchIds).toHaveLength(0);
    expect(history.recordQueries).toHaveLength(0);
  });
});
