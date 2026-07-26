import type { SemanticIndexStatus, SemanticModel, SemanticModelCode } from '@causality/contracts';
import { useEffect, useState } from 'react';

import { PercentageControl } from '../../shared/controls/PercentageControl';
import {
  availabilityStatus,
  downloadStatus,
  formatMegabytes,
  formatSemanticDate,
  modelIndexStatus,
} from './semanticPresentation';

interface SemanticModelCardProps {
  model: SemanticModel;
  indexStatus: SemanticIndexStatus;
  busy: boolean;
  thresholdPending: boolean;
  reindexPending: boolean;
  onUse(model: SemanticModel): void;
  onReindex(): void;
  onThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void>;
}

export function SemanticModelCard({
  model,
  indexStatus,
  busy,
  thresholdPending,
  reindexPending,
  onUse,
  onReindex,
  onThreshold,
}: SemanticModelCardProps) {
  const [threshold, setThreshold] = useState<number | null>(model.threshold);
  const statuses = [
    downloadStatus(model),
    availabilityStatus(model, indexStatus),
    modelIndexStatus(model, indexStatus),
  ];

  useEffect(() => setThreshold(model.threshold), [model.threshold]);

  async function saveThreshold(): Promise<void> {
    if (threshold === null || !Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
      setThreshold(model.threshold);
      return;
    }
    if (threshold === model.threshold) return;
    try {
      await onThreshold(model.code, threshold);
    } catch {
      setThreshold(model.threshold);
    }
  }

  const actionLabel = model.downloadStatus === 'downloaded' ? '切换到此模型' : '下载并使用';

  return (
    <article
      className={`semantic-model-card${model.isActive ? ' semantic-model-card--active' : ''}`}
      aria-label={model.label}
    >
      <div className="semantic-model-card__heading">
        <div>
          <h2>{model.label}</h2>
          <p>{model.description}</p>
        </div>
      </div>
      <div className="semantic-model-card__badges" aria-label="模型状态">
        {statuses.map((status) => (
          <span key={status.label} className={`semantic-badge semantic-badge--${status.tone}`}>
            {status.label}
          </span>
        ))}
      </div>

      <dl className="semantic-model-card__metadata">
        <div>
          <dt>语言支持</dt>
          <dd>{model.languageLabel}</dd>
        </div>
        <div>
          <dt>预计下载</dt>
          <dd>{formatMegabytes(model.expectedDownloadBytes)}</dd>
        </div>
        <div>
          <dt>最近下载</dt>
          <dd>{formatSemanticDate(model.downloadedAt)}</dd>
        </div>
      </dl>

      <PercentageControl
        id={`semantic-threshold-${model.code}`}
        label="相似度门槛"
        value={threshold}
        sliderLabel="相似度门槛滑块"
        numberLabel="相似度门槛数值"
        help="只影响增强查询的候选过滤，不会重新生成索引。"
        disabled={thresholdPending}
        preserveAppearanceWhenDisabled
        onChange={setThreshold}
        onCommit={() => void saveThreshold()}
      />

      {model.error ? (
        <div className="semantic-model-card__error" role="status">
          {model.error}
        </div>
      ) : null}

      <div className="semantic-model-card__actions">
        {model.isActive ? (
          <button
            className="button button--secondary"
            type="button"
            disabled={busy || model.downloadStatus !== 'downloaded'}
            onClick={onReindex}
          >
            {reindexPending ? '重新索引中…' : '重新索引'}
          </button>
        ) : (
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() => onUse(model)}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  );
}
