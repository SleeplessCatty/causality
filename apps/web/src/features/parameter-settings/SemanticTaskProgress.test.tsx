import type { SemanticOperation } from '@causality/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SemanticTaskProgress } from './SemanticTaskProgress';

const downloadOperation: SemanticOperation = {
  type: 'download',
  phase: 'downloading',
  status: 'running',
  modelCode: 'bge-small-zh-v1.5',
  attempt: 1,
  maxAttempts: 3,
  progress: {
    unit: 'bytes',
    completed: 13_107_200,
    total: 25_165_824,
  },
  nextRetryAt: null,
  failure: null,
};

describe('SemanticTaskProgress', () => {
  it('shows download progress using decimal megabytes', () => {
    render(<SemanticTaskProgress operation={downloadOperation} />);

    expect(screen.getByText('13.1 MB / 25.2 MB')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: '模型下载进度' });
    expect((progress as HTMLProgressElement).value).toBe(13_107_200);
    expect((progress as HTMLProgressElement).max).toBe(25_165_824);
  });

  it('shows index progress using item counts', () => {
    render(
      <SemanticTaskProgress
        operation={{
          ...downloadOperation,
          type: 'full_index',
          phase: 'indexing',
          progress: { unit: 'items', completed: 120, total: 600 },
        }}
      />,
    );

    expect(screen.getByText('120 / 600')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '索引生成进度' })).toBeTruthy();
  });
});
