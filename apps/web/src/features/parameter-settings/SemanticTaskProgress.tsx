import type { SemanticOperation } from '@causality/contracts';

import { formatMegabytesWithUpToOneDecimal } from './semanticPresentation';

export function SemanticTaskProgress({ operation }: { operation: SemanticOperation }) {
  const progress = operation.progress;
  const isDownload = progress?.unit === 'bytes';
  const value = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  const progressText = isDownload
    ? `${formatMegabytesWithUpToOneDecimal(value)} / ${formatMegabytesWithUpToOneDecimal(total)}`
    : `${value} / ${total}`;
  const label =
    operation.type === 'download'
      ? operation.status === 'failed'
        ? '下载失败'
        : '模型下载进度'
      : operation.type === 'load'
        ? '模型加载进度'
        : operation.status === 'failed'
          ? '索引任务失败'
          : '索引生成进度';
  const progressLabel =
    operation.type === 'download'
      ? '模型下载进度'
      : operation.type === 'load'
        ? '模型加载进度'
        : '索引生成进度';

  return (
    <section className="semantic-task-panel" aria-labelledby="semantic-task-title">
      <div>
        <span id="semantic-task-title">{label}</span>
        {progress ? <strong>{progressText}</strong> : null}
      </div>
      {progress ? (
        <progress
          aria-label={progressLabel}
          value={Math.min(value, Math.max(total, 1))}
          max={Math.max(total, 1)}
        />
      ) : (
        <span className="semantic-task-panel__waiting">等待 Worker 处理</span>
      )}
      {operation.status === 'retry_wait' && operation.nextRetryAt ? (
        <p>将在 {new Date(operation.nextRetryAt).toLocaleTimeString('zh-CN')} 自动重试</p>
      ) : null}
      {operation.failure ? <p>{operation.failure.message}</p> : null}
    </section>
  );
}
