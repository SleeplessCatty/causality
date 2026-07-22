import type { CausalGraphQuery, EventCandidate } from '@causality/contracts';

import {
  graphCaseCountOptions,
  graphConfidenceOptions,
  graphLimitOptions,
  type GraphLimit,
} from '../graph/graphQueryState';
import { GraphEventSelector } from './GraphEventSelector';

interface CausalGraphToolbarProps {
  selectedEvent: EventCandidate | null;
  direction: CausalGraphQuery['direction'];
  limit: GraphLimit;
  minConfidence: number;
  minCaseCount: number;
  zoom: number;
  onEventSelect: (event: EventCandidate) => void;
  onDirectionChange: (direction: CausalGraphQuery['direction']) => void;
  onLimitChange: (limit: GraphLimit) => void;
  onMinConfidenceChange: (value: number) => void;
  onMinCaseCountChange: (value: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

const directions: Array<{
  value: CausalGraphQuery['direction'];
  label: string;
}> = [
  { value: 'upstream', label: '上游' },
  { value: 'downstream', label: '下游' },
  { value: 'both', label: '双向' },
];

export function CausalGraphToolbar({
  selectedEvent,
  direction,
  limit,
  minConfidence,
  minCaseCount,
  zoom,
  onEventSelect,
  onDirectionChange,
  onLimitChange,
  onMinConfidenceChange,
  onMinCaseCountChange,
  onZoomIn,
  onZoomOut,
  onFit,
}: CausalGraphToolbarProps) {
  return (
    <div className="causal-graph-toolbar" aria-label="因果图工具栏">
      <GraphEventSelector value={selectedEvent} onSelect={onEventSelect} />
      <label className="graph-toolbar-field">
        <span>方向</span>
        <select
          aria-label="查询方向"
          value={direction}
          onChange={(event) =>
            onDirectionChange(event.target.value as CausalGraphQuery['direction'])
          }
        >
          {directions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="graph-toolbar-field">
        <span>节点</span>
        <select
          aria-label="节点上限"
          value={limit}
          onChange={(event) => onLimitChange(Number(event.target.value) as GraphLimit)}
        >
          {graphLimitOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="graph-toolbar-field">
        <span>置信度</span>
        <select
          aria-label="最低置信度"
          value={minConfidence}
          onChange={(event) => onMinConfidenceChange(Number(event.target.value))}
        >
          {graphConfidenceOptions.map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
      </label>
      <label className="graph-toolbar-field">
        <span>案例</span>
        <select
          aria-label="最少案例数"
          value={minCaseCount}
          onChange={(event) => onMinCaseCountChange(Number(event.target.value))}
        >
          {graphCaseCountOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
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
