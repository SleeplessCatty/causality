import type { SemanticTask } from '@causality/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SemanticTaskProgress } from './SemanticTaskProgress';

const downloadTask: SemanticTask = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'download',
  status: 'running',
  modelCode: 'bge-small-zh-v1.5',
  processedItems: 0,
  totalItems: 0,
  downloadedBytes: 13_107_200,
  totalBytes: 25_165_824,
  createdAt: '2026-07-26T10:00:00.000Z',
  startedAt: '2026-07-26T10:00:01.000Z',
  updatedAt: '2026-07-26T10:00:02.000Z',
  completedAt: null,
  error: null,
};

describe('SemanticTaskProgress', () => {
  it('shows model download progress in megabytes', () => {
    render(<SemanticTaskProgress task={downloadTask} />);

    expect(screen.getByText('12.5 MB / 24 MB')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: '模型下载进度' });
    expect((progress as HTMLProgressElement).value).toBe(downloadTask.downloadedBytes);
    expect((progress as HTMLProgressElement).max).toBe(downloadTask.totalBytes);
  });
});
