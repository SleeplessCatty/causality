import type {
  SemanticAction,
  SemanticModelCode,
  SemanticModelLifecycle,
} from '@causality/contracts';
import { useEffect, useState } from 'react';

import { PercentageControl } from '../../shared/controls/PercentageControl';
import {
  formatApproximateMegabytes,
  formatSemanticDate,
  semanticActionLabel,
  semanticFileBadge,
  semanticRoleBadge,
  semanticStageBadge,
} from './semanticPresentation';

interface SemanticModelCardProps {
  model: SemanticModelLifecycle;
  actionsDisabled: boolean;
  pendingAction: SemanticAction | null;
  thresholdPending: boolean;
  onAction(action: SemanticAction, model: SemanticModelLifecycle): void;
  onThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void>;
}

export function SemanticModelCard({
  model,
  actionsDisabled,
  pendingAction,
  thresholdPending,
  onAction,
  onThreshold,
}: SemanticModelCardProps) {
  const [threshold, setThreshold] = useState<number | null>(model.threshold);
  const statuses = [semanticFileBadge(model), semanticRoleBadge(model), semanticStageBadge(model)];

  useEffect(() => setThreshold(model.threshold), [model.threshold]);

  async function saveThreshold(): Promise<void> {
    if (threshold === null || !Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
      setThreshold(model.threshold);
      return;
    }
    if (threshold === model.threshold) return;
    try {
      await onThreshold(model.modelCode, threshold);
    } catch {
      setThreshold(model.threshold);
    }
  }

  return (
    <article
      className={`semantic-model-card${
        model.role === 'current' ? ' semantic-model-card--active' : ''
      }`}
      aria-label={model.label}
    >
      <div className="semantic-model-card__heading">
        <div>
          <h2>{model.label}</h2>
          <p>{model.description}</p>
        </div>
      </div>
      <div className="semantic-model-card__badges" aria-label="模型状态">
        {statuses.map((status, index) => (
          <span
            key={`${index}-${status.label}`}
            className={`semantic-badge semantic-badge--${status.tone}`}
          >
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
          <dd>{formatApproximateMegabytes(model.expectedDownloadBytes)}</dd>
        </div>
        <div>
          <dt>最近下载</dt>
          <dd>{formatSemanticDate(model.downloadedAt)}</dd>
        </div>
      </dl>

      <PercentageControl
        id={`semantic-threshold-${model.modelCode}`}
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

      {model.failure ? (
        <div className="semantic-model-card__error" role="status">
          {model.failure.message}
        </div>
      ) : null}

      {model.allowedActions.length > 0 ? (
        <div className="semantic-model-card__actions">
          {model.allowedActions.map((action) => (
            <button
              key={action}
              className="button button--secondary"
              type="button"
              disabled={actionsDisabled}
              onClick={() => onAction(action, model)}
            >
              {pendingAction === action
                ? `${semanticActionLabel(action)}中…`
                : semanticActionLabel(action)}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
