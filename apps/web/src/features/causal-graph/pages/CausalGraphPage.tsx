import type { CausalGraphQuery, CausalGraphResponse, EventCandidate } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { ApiClientError, getEvent } from '../../events/api/eventApi';
import { getCausalGraph } from '../api/causalGraphApi';
import { CausalGraphCanvas, type CausalGraphCanvasHandle } from '../components/CausalGraphCanvas';
import { CausalGraphToolbar } from '../components/CausalGraphToolbar';
import '../causalGraph.css';

type GraphDirection = CausalGraphQuery['direction'];

const directions = new Set<GraphDirection>(['upstream', 'downstream', 'both']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isDirection(value: string | null): value is GraphDirection {
  return Boolean(value && directions.has(value as GraphDirection));
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && error.details.code === 'EVENT_NOT_FOUND';
}

export function CausalGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const centerEventId = searchParams.get('centerEventId') ?? '';
  const directionParameter = searchParams.get('direction');
  const direction: GraphDirection = isDirection(directionParameter) ? directionParameter : 'both';
  const hasValidCenter = uuidPattern.test(centerEventId);
  const hasInvalidCenter = Boolean(centerEventId) && !hasValidCenter;
  const canvasRef = useRef<CausalGraphCanvasHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedCandidate, setSelectedCandidate] = useState<EventCandidate | null>(null);
  const [lastGraph, setLastGraph] = useState<CausalGraphResponse | null>(null);

  useEffect(() => {
    if (centerEventId && !isDirection(directionParameter)) {
      setSearchParams({ centerEventId, direction: 'both' }, { replace: true });
    }
  }, [centerEventId, directionParameter, setSearchParams]);

  useEffect(() => {
    if (selectedCandidate && selectedCandidate.id !== centerEventId) setSelectedCandidate(null);
    if (!centerEventId || hasInvalidCenter) setLastGraph(null);
  }, [centerEventId, hasInvalidCenter, selectedCandidate]);

  const centerEvent = useQuery({
    queryKey: ['events', 'detail', 'causal-graph', centerEventId],
    queryFn: ({ signal }) => getEvent(centerEventId, signal),
    enabled: hasValidCenter,
  });

  const graphQuery = useQuery({
    queryKey: ['causal-graph', centerEventId, direction, 20, 0, 0],
    queryFn: ({ signal }) => getCausalGraph(centerEventId, direction, signal),
    enabled: hasValidCenter,
  });

  useEffect(() => {
    if (graphQuery.data) setLastGraph(graphQuery.data);
  }, [graphQuery.data]);

  const displayedGraph = graphQuery.data ?? lastGraph;
  const selectedEvent: EventCandidate | null =
    selectedCandidate?.id === centerEventId
      ? selectedCandidate
      : centerEvent.data
        ? { id: centerEvent.data.id, name: centerEvent.data.name }
        : displayedGraph
          ? {
              id: centerEventId,
              name:
                displayedGraph.nodes.find((node) => node.id === centerEventId)?.name ?? '中心事件',
            }
          : null;

  const chooseEvent = useCallback(
    (event: EventCandidate) => {
      setSelectedCandidate(event);
      setSearchParams({ centerEventId: event.id, direction: 'both' });
    },
    [setSearchParams],
  );

  const changeDirection = useCallback(
    (nextDirection: GraphDirection) => {
      if (!hasValidCenter) return;
      setSearchParams({ centerEventId, direction: nextDirection });
    },
    [centerEventId, hasValidCenter, setSearchParams],
  );

  const clearSelection = useCallback(() => {
    setSelectedCandidate(null);
    setLastGraph(null);
    setSearchParams({});
  }, [setSearchParams]);

  const retryRequest = useCallback(() => {
    void centerEvent.refetch();
    void graphQuery.refetch();
  }, [centerEvent, graphQuery]);

  const queryError = graphQuery.error ?? centerEvent.error;
  const overlay = hasInvalidCenter
    ? { message: '链接中的中心事件无效', actionLabel: '重新选择', onAction: clearSelection }
    : queryError
      ? isNotFound(queryError)
        ? { message: '中心事件不存在', actionLabel: '重新选择', onAction: clearSelection }
        : { message: '无法加载因果图', actionLabel: '重试', onAction: retryRequest }
      : undefined;

  const countText = displayedGraph
    ? `${displayedGraph.meta.nodeCount} 个节点 · ${displayedGraph.meta.relationCount} 条关系`
    : '等待选择中心事件';

  return (
    <section className="causal-graph-page" aria-labelledby="causal-graph-title">
      <header className="causal-graph-page__heading">
        <div>
          <h1 id="causal-graph-title">局部因果图</h1>
          <p>从一个原子事件查看局部因果网络</p>
        </div>
        <div className="causal-graph-page__count" aria-live="polite">
          <span>{countText}</span>
          {displayedGraph?.meta.stopReason === 'relation_limit' ? (
            <small>已按关系上限缩小</small>
          ) : null}
        </div>
      </header>
      <CausalGraphToolbar
        selectedEvent={selectedEvent}
        direction={direction}
        zoom={zoom}
        onEventSelect={chooseEvent}
        onDirectionChange={changeDirection}
        onZoomIn={() => canvasRef.current?.zoomIn()}
        onZoomOut={() => canvasRef.current?.zoomOut()}
        onFit={() => canvasRef.current?.fit()}
      />
      <CausalGraphCanvas
        ref={canvasRef}
        graph={displayedGraph}
        centerEventName={selectedEvent?.name}
        isInitialLoading={hasValidCenter && !displayedGraph && graphQuery.isPending}
        isRefreshing={Boolean(displayedGraph && graphQuery.isFetching)}
        overlay={overlay}
        onZoomChange={setZoom}
      />
    </section>
  );
}
