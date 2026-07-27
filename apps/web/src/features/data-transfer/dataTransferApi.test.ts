import type {
  ImportBatchListResponse,
  ImportBatchSummary,
  ImportRecordListResponse,
} from '@causality/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestJson, requestMultipartJson } from '../../shared/api/httpClient';
import {
  getImportBatch,
  getImportHistory,
  getImportRecords,
  uploadImport,
} from './dataTransferApi';

vi.mock('../../shared/api/httpClient', () => ({
  requestJson: vi.fn(),
  requestMultipartJson: vi.fn(),
}));

const batch: ImportBatchSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  filename: 'mixed-import.csv',
  completedAt: '2026-07-27T06:00:00.000Z',
  recordTypes: ['event', 'case', 'relation', 'relation_case'],
  counts: {
    event: { created: 2, reused: 1 },
    case: { created: 3, reused: 2 },
    relation: { created: 1, reused: 1 },
    relationCase: { created: 2, reused: 3 },
  },
};

const history: ImportBatchListResponse = {
  items: [batch],
  page: 2,
  pageSize: 50,
  totalItems: 51,
  totalPages: 2,
};

const records: ImportRecordListResponse = {
  items: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      sequence: 1,
      outcome: 'created',
      text: { type: 'event', eventName: '供应商交付压力上升' },
    },
  ],
  page: 3,
  pageSize: 50,
  totalItems: 101,
  totalPages: 3,
};

describe('dataTransferApi', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockReset();
    vi.mocked(requestMultipartJson).mockReset();
  });

  it('uploads the selected CSV under the file field with the five-minute timeout', async () => {
    vi.mocked(requestMultipartJson).mockResolvedValue({ batch });
    const signal = new AbortController().signal;
    const file = new File(['"原子事件","需求上升"'], 'mixed-import.csv', {
      type: 'text/csv',
    });

    await expect(uploadImport(file, signal)).resolves.toEqual(batch);

    expect(requestMultipartJson).toHaveBeenCalledOnce();
    const [url, form, passedSignal, timeout] = vi.mocked(requestMultipartJson).mock.calls[0]!;
    expect(url).toBe('/api/data-transfers/imports');
    expect(form.get('file')).toBe(file);
    expect([...form.keys()]).toEqual(['file']);
    expect(passedSignal).toBe(signal);
    expect(timeout).toBe(300_000);
  });

  it('loads and validates the requested import history page', async () => {
    vi.mocked(requestJson).mockResolvedValue(history);
    const signal = new AbortController().signal;

    await expect(getImportHistory(2, signal)).resolves.toEqual(history);
    expect(requestJson).toHaveBeenCalledWith('/api/data-transfers/imports?page=2', {}, signal);
  });

  it('loads one batch and validates its identifier', async () => {
    vi.mocked(requestJson).mockResolvedValue(batch);
    const signal = new AbortController().signal;

    await expect(getImportBatch(batch.id, signal)).resolves.toEqual(batch);
    expect(requestJson).toHaveBeenCalledWith(`/api/data-transfers/imports/${batch.id}`, {}, signal);
  });

  it('loads one typed detail page with encoded parameters', async () => {
    vi.mocked(requestJson).mockResolvedValue(records);
    const signal = new AbortController().signal;

    await expect(getImportRecords(batch.id, 'event', 3, signal)).resolves.toEqual(records);
    expect(requestJson).toHaveBeenCalledWith(
      `/api/data-transfers/imports/${batch.id}/records?type=event&page=3`,
      {},
      signal,
    );
  });

  it('rejects malformed server data at the adapter boundary', async () => {
    vi.mocked(requestJson).mockResolvedValue({ ...history, pageSize: 20 });

    await expect(getImportHistory(1)).rejects.toThrow();
  });
});
