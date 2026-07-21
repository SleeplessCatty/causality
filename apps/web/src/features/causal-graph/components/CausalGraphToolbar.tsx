import type { CausalGraphQuery, EventCandidate } from '@causality/contracts';

import { GraphEventSelector } from './GraphEventSelector';

interface CausalGraphToolbarProps {
  selectedEvent: EventCandidate | null;
  direction: CausalGraphQuery['direction'];
  zoom: number;
  onEventSelect: (event: EventCandidate) => void;
  onDirectionChange: (direction: CausalGraphQuery['direction']) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

const directions: Array<{
  value: CausalGraphQuery['direction'];
  label: string;
  ariaLabel: string;
}> = [
  { value: 'upstream', label: '上游', ariaLabel: '只看上游' },
  { value: 'downstream', label: '下游', ariaLabel: '只看下游' },
  { value: 'both', label: '双向', ariaLabel: '查看上游和下游' },
];

export function CausalGraphToolbar({
  selectedEvent,
  direction,
  zoom,
  onEventSelect,
  onDirectionChange,
  onZoomIn,
  onZoomOut,
  onFit,
}: CausalGraphToolbarProps) {
  return (
    <div className="causal-graph-toolbar" aria-label="因果图工具栏">
      <GraphEventSelector value={selectedEvent} onSelect={onEventSelect} />
      <div className="graph-direction-control" role="radiogroup" aria-label="查询方向">
        {directions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-label={option.ariaLabel}
            aria-checked={direction === option.value}
            className={direction === option.value ? 'is-active' : undefined}
            onClick={() => onDirectionChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="graph-viewport-controls" aria-label="画布缩放">
        <button type="button" aria-label="缩小因果图" disabled={zoom <= 0.25} onClick={onZoomOut}>
          −
        </button>
        <output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label="放大因果图" disabled={zoom >= 2} onClick={onZoomIn}>
          +
        </button>
        <button type="button" className="graph-fit-button" onClick={onFit}>
          适应画布
        </button>
      </div>
    </div>
  );
}
