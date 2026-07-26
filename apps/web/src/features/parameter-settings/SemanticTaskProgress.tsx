import type { SemanticTask } from '@causality/contracts';

import { formatMegabytesWithUpToOneDecimal } from './semanticPresentation';

export function SemanticTaskProgress({ task }: { task: SemanticTask }) {
  const isDownload = task.type === 'download';
  const value = isDownload ? task.downloadedBytes : task.processedItems;
  const total = isDownload ? task.totalBytes : task.totalItems;
  const progressText = isDownload
    ? `${formatMegabytesWithUpToOneDecimal(value)} / ${formatMegabytesWithUpToOneDecimal(total)}`
    : `${value} / ${total}`;
  const label =
    task.type === 'download'
      ? task.status === 'failed'
        ? '下载失败'
        : '模型下载进度'
      : task.status === 'failed'
        ? '索引任务失败'
        : '索引生成进度';

  return (
    <section className="semantic-task-panel" aria-labelledby="semantic-task-title">
      <div>
        <span id="semantic-task-title">{label}</span>
        <strong>{progressText}</strong>
      </div>
      <progress
        aria-label={task.type === 'download' ? '模型下载进度' : '索引生成进度'}
        value={Math.min(value, Math.max(total, 1))}
        max={Math.max(total, 1)}
      />
      {task.error ? <p>{task.error}</p> : null}
    </section>
  );
}
