import type {
  ExportPreviewResponse,
  ImportBatchListResponse,
  ImportBatchSummary,
  ImportRecordListResponse,
} from '@causality/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requestJson,
  requestMultipartJson,
  startBrowserDownload,
} from '../../shared/api/httpClient';
import {
  downloadExport,
  getImportBatch,
  getImportHistory,
  getImportRecords,
  previewExport,
  uploadImport,
} from './dataTransferApi';

vi.mock('../../shared/api/httpClient', () => ({
  requestJson: vi.fn(),
  requestMultipartJson: vi.fn(),
  startBrowserDownload: vi.fn(),
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

const exportPreview: ExportPreviewResponse = {
  token: 'signed-export-token',
  expiresAt: '2026-07-27T08:30:00.000Z',
  counts: { events: 4, relations: 3, cases: 7 },
};

function exportEventIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
}

describe('dataTransferApi', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockReset();
    vi.mocked(requestMultipartJson).mockReset();
    vi.mocked(startBrowserDownload).mockReset();
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

  it('previews and validates a filtered export', async () => {
    vi.mocked(requestJson).mockResolvedValue(exportPreview);
    const signal = new AbortController().signal;
    const input = {
      type: 'filtered' as const,
      startEventIds: ['11111111-1111-4111-8111-111111111111'],
      direction: 'both' as const,
      depth: 3,
    };

    await expect(previewExport(input, signal)).resolves.toEqual(exportPreview);
    expect(requestJson).toHaveBeenCalledWith(
      '/api/data-transfers/exports/preview',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      signal,
    );
  });

  it('rejects malformed export preview data at the adapter boundary', async () => {
    vi.mocked(requestJson).mockResolvedValue({
      ...exportPreview,
      counts: { events: 4, relations: -1, cases: 7 },
    });

    await expect(previewExport({ type: 'full' })).rejects.toThrow();
  });

  it('accepts exactly 100 filtered start events at the shared submit boundary', async () => {
    vi.mocked(requestJson).mockResolvedValue(exportPreview);
    const input = {
      type: 'filtered' as const,
      startEventIds: exportEventIds(100),
      direction: 'both' as const,
      depth: 3,
    };

    await expect(previewExport(input)).resolves.toEqual(exportPreview);
    expect(requestJson).toHaveBeenCalledWith(
      '/api/data-transfers/exports/preview',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      undefined,
    );
  });

  it('rejects 101 filtered start events before sending the preview request', async () => {
    const input = {
      type: 'filtered' as const,
      startEventIds: exportEventIds(101),
      direction: 'both' as const,
      depth: 3,
    };

    await expect(previewExport(input)).rejects.toThrow();
    expect(requestJson).not.toHaveBeenCalled();
  });

  it('validates availability before starting a same-route token download', async () => {
    vi.mocked(requestJson).mockResolvedValue({
      available: true,
      expiresAt: exportPreview.expiresAt,
    });

    const signal = new AbortController().signal;
    await downloadExport('token / with unsafe characters', signal);

    expect(requestJson).toHaveBeenCalledWith(
      '/api/data-transfers/exports/token%20%2F%20with%20unsafe%20characters/availability',
      {},
      signal,
    );
    expect(startBrowserDownload).toHaveBeenCalledWith(
      '/api/data-transfers/exports/token%20%2F%20with%20unsafe%20characters',
    );
  });

  it('does not start a download when availability is invalid', async () => {
    vi.mocked(requestJson).mockResolvedValue({
      available: false,
      expiresAt: exportPreview.expiresAt,
    });

    await expect(downloadExport(exportPreview.token)).rejects.toThrow();
    expect(startBrowserDownload).not.toHaveBeenCalled();
  });

  it('does not start a download when availability settles after cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(requestJson).mockImplementation(async () => {
      controller.abort(new DOMException('Cancelled', 'AbortError'));
      return { available: true, expiresAt: exportPreview.expiresAt };
    });

    await expect(downloadExport(exportPreview.token, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(startBrowserDownload).not.toHaveBeenCalled();
  });
});
