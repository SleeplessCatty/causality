import type { CausalGraphQuery, EventCandidate } from '@causality/contracts';

import {
  graphCaseCountOptions,
  graphConfidenceOptions,
  graphLimitOptions,
  type GraphLimit,
} from '../graph/graphQueryState';
import { GraphEventSelector } from './GraphEventSelector';
import { CompactSelect } from './CompactSelect';

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
  { value: 'both', label: '双向' },
  { value: 'downstream', label: '下游' },
  { value: 'upstream', label: '上游' },
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
      <CompactSelect
        label="方向"
        ariaLabel="查询方向"
        value={direction}
        options={directions}
        onChange={onDirectionChange}
      />
      <CompactSelect
        label="节点"
        ariaLabel="节点上限"
        value={limit}
        options={graphLimitOptions.map((value) => ({ value, label: String(value) }))}
        onChange={onLimitChange}
      />
      <CompactSelect
        label="置信度"
        ariaLabel="最低置信度"
        value={minConfidence}
        options={graphConfidenceOptions.map((value) => ({ value, label: `${value}%` }))}
        onChange={onMinConfidenceChange}
      />
      <CompactSelect
        label="案例"
        ariaLabel="最少案例数"
        value={minCaseCount}
        options={graphCaseCountOptions.map((value) => ({ value, label: String(value) }))}
        onChange={onMinCaseCountChange}
      />
      <div className="graph-viewport-controls" aria-label="画布缩放">
        <button type="button" aria-label="缩小因果图" disabled={zoom <= 0.1} onClick={onZoomOut}>
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
