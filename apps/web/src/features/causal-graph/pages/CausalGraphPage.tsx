import type { CausalGraphQuery, CausalGraphResponse, EventCandidate } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { ApiClientError, getEvent } from '../../events/api/eventApi';
import { getCausalGraph } from '../api/causalGraphApi';
import { CausalGraphCanvas, type CausalGraphCanvasHandle } from '../components/CausalGraphCanvas';
import { CausalGraphInspector } from '../components/CausalGraphInspector';
import { CausalGraphToolbar } from '../components/CausalGraphToolbar';
import type { GraphElementSelection } from '../graph/graphSelection';
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
  const [selection, setSelection] = useState<GraphElementSelection | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

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
    if (graphQuery.data) {
      setLastGraph(graphQuery.data);
      setSelection(null);
      setInspectorOpen(false);
    }
  }, [graphQuery.data]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      canvasRef.current?.resize();
      if (inspectorOpen && selection) canvasRef.current?.ensureSelectionVisible();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspectorOpen, selection]);

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
      setSelection(null);
      setInspectorOpen(false);
      setSelectedCandidate(event);
      setSearchParams({ centerEventId: event.id, direction: 'both' });
    },
    [setSearchParams],
  );

  const changeDirection = useCallback(
    (nextDirection: GraphDirection) => {
      if (!hasValidCenter) return;
      setSelection(null);
      setInspectorOpen(false);
      setSearchParams({ centerEventId, direction: nextDirection });
    },
    [centerEventId, hasValidCenter, setSearchParams],
  );

  const clearCenterEvent = useCallback(() => {
    setSelection(null);
    setInspectorOpen(false);
    setSelectedCandidate(null);
    setLastGraph(null);
    setSearchParams({});
  }, [setSearchParams]);

  const setNodeAsCenter = useCallback(
    (eventId: string) => {
      const eventName = displayedGraph?.nodes.find((node) => node.id === eventId)?.name;
      setSelection(null);
      setInspectorOpen(false);
      setLastGraph(null);
      setSelectedCandidate(eventName ? { id: eventId, name: eventName } : null);
      setSearchParams({ centerEventId: eventId, direction });
    },
    [direction, displayedGraph, setSearchParams],
  );

  const retryRequest = useCallback(() => {
    void centerEvent.refetch();
    void graphQuery.refetch();
  }, [centerEvent, graphQuery]);

  const queryError = graphQuery.error ?? centerEvent.error;
  const overlay = hasInvalidCenter
    ? { message: '链接中的中心事件无效', actionLabel: '重新选择', onAction: clearCenterEvent }
    : queryError
      ? isNotFound(queryError)
        ? { message: '中心事件不存在', actionLabel: '重新选择', onAction: clearCenterEvent }
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
      <div
        className={`causal-graph-workbench${inspectorOpen ? ' has-inspector' : ''}`}
        data-inspector-open={inspectorOpen ? 'true' : 'false'}
      >
        <CausalGraphCanvas
          ref={canvasRef}
          graph={displayedGraph}
          centerEventName={selectedEvent?.name}
          isInitialLoading={hasValidCenter && !displayedGraph && graphQuery.isPending}
          isRefreshing={Boolean(displayedGraph && graphQuery.isFetching)}
          overlay={overlay}
          onZoomChange={setZoom}
          selection={selection}
          inspectorOpen={inspectorOpen}
          onSelectionChange={setSelection}
          onClearSelection={() => setSelection(null)}
          onToggleInspector={() => setInspectorOpen((current) => !current)}
          onEscape={() => {
            setSelection(null);
            setInspectorOpen(false);
          }}
        />
        <CausalGraphInspector
          open={inspectorOpen}
          selection={selection}
          centerEventId={centerEventId}
          onClose={() => {
            setInspectorOpen(false);
            window.requestAnimationFrame(() => canvasRef.current?.focus());
          }}
          onSetCenter={setNodeAsCenter}
        />
      </div>
    </section>
  );
}
