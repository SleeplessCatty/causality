import {
  exportAvailabilityResponseSchema,
  exportPreviewInputSchema,
  exportPreviewResponseSchema,
  importBatchListResponseSchema,
  importBatchSummarySchema,
  importRecordListResponseSchema,
  importUploadResponseSchema,
  type ExportPreviewInput,
  type ExportPreviewResponse,
  type ImportBatchListResponse,
  type ImportBatchSummary,
  type ImportRecordListResponse,
  type ImportRecordType,
} from '@causality/contracts';

import {
  requestJson,
  requestMultipartJson,
  startBrowserDownload,
} from '../../shared/api/httpClient';

const importTimeoutMilliseconds = 5 * 60 * 1_000;

export async function uploadImport(file: File, signal: AbortSignal): Promise<ImportBatchSummary> {
  const form = new FormData();
  form.append('file', file);
  const response = importUploadResponseSchema.parse(
    await requestMultipartJson(
      '/api/data-transfers/imports',
      form,
      signal,
      importTimeoutMilliseconds,
    ),
  );
  return response.batch;
}

export async function getImportHistory(
  page: number,
  signal?: AbortSignal,
): Promise<ImportBatchListResponse> {
  return importBatchListResponseSchema.parse(
    await requestJson(`/api/data-transfers/imports?page=${page}`, {}, signal),
  );
}

export async function getImportBatch(
  batchId: string,
  signal?: AbortSignal,
): Promise<ImportBatchSummary> {
  return importBatchSummarySchema.parse(
    await requestJson(`/api/data-transfers/imports/${batchId}`, {}, signal),
  );
}

export async function getImportRecords(
  batchId: string,
  type: ImportRecordType,
  page: number,
  signal?: AbortSignal,
): Promise<ImportRecordListResponse> {
  const parameters = new URLSearchParams({ type, page: String(page) });
  return importRecordListResponseSchema.parse(
    await requestJson(`/api/data-transfers/imports/${batchId}/records?${parameters}`, {}, signal),
  );
}

export async function previewExport(
  input: ExportPreviewInput,
  signal?: AbortSignal,
): Promise<ExportPreviewResponse> {
  const validatedInput = exportPreviewInputSchema.parse(input);
  return exportPreviewResponseSchema.parse(
    await requestJson(
      '/api/data-transfers/exports/preview',
      {
        method: 'POST',
        body: JSON.stringify(validatedInput),
      },
      signal,
    ),
  );
}

export async function downloadExport(token: string, signal?: AbortSignal): Promise<void> {
  const encodedToken = encodeURIComponent(token);
  exportAvailabilityResponseSchema.parse(
    await requestJson(`/api/data-transfers/exports/${encodedToken}/availability`, {}, signal),
  );
  signal?.throwIfAborted();
  startBrowserDownload(`/api/data-transfers/exports/${encodedToken}`);
}
