import type { CausalGraphQuery, CausalGraphResponse, EventCandidate } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { ApiClientError, getEvent } from '../../events/api/eventApi';
import { getCausalGraph } from '../api/causalGraphApi';
import { CausalGraphCanvas, type CausalGraphCanvasHandle } from '../components/CausalGraphCanvas';
import { CausalGraphInspector } from '../components/CausalGraphInspector';
import { CausalGraphToolbar } from '../components/CausalGraphToolbar';
import { GraphStatusOverlay, type GraphQueryErrorKind } from '../components/GraphStatusOverlay';
import {
  parseGraphQueryState,
  toGraphSearchParams,
  type GraphLimit,
  type GraphQueryState,
} from '../graph/graphQueryState';
import type { GraphElementSelection } from '../graph/graphSelection';
import '../causalGraph.css';

type GraphDirection = CausalGraphQuery['direction'];
type LayoutState = 'idle' | 'loading' | 'ready' | 'error';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && error.details.code === 'EVENT_NOT_FOUND';
}

export function CausalGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedQuery = parseGraphQueryState(searchParams);
  const requestedQuery = parsedQuery.state;
  const { centerEventId, direction, limit, minConfidence, minCaseCount } = requestedQuery;
  const hasValidCenter = uuidPattern.test(centerEventId);
  const hasInvalidCenter = Boolean(centerEventId) && !hasValidCenter;
  const canvasRef = useRef<CausalGraphCanvasHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedCandidate, setSelectedCandidate] = useState<EventCandidate | null>(null);
  const [lastGraph, setLastGraph] = useState<CausalGraphResponse | null>(null);
  const [selection, setSelection] = useState<GraphElementSelection | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [layoutState, setLayoutState] = useState<LayoutState>('idle');

  const setGraphQuery = useCallback(
    (nextQuery: GraphQueryState, replace = false) => {
      setSearchParams(toGraphSearchParams(nextQuery), { replace });
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (parsedQuery.needsCanonicalization) setGraphQuery(requestedQuery, true);
  }, [
    centerEventId,
    direction,
    limit,
    minCaseCount,
    minConfidence,
    parsedQuery.needsCanonicalization,
    requestedQuery,
    setGraphQuery,
  ]);

  useEffect(() => {
    if (selectedCandidate && selectedCandidate.id !== centerEventId) setSelectedCandidate(null);
    if (!centerEventId) {
      setLastGraph(null);
      setSelection(null);
      setInspectorOpen(false);
    }
  }, [centerEventId, selectedCandidate]);

  useEffect(() => {
    if (hasValidCenter) setLayoutState('loading');
  }, [centerEventId, direction, hasValidCenter, limit, minCaseCount, minConfidence]);

  const centerEvent = useQuery({
    queryKey: ['events', 'detail', 'causal-graph', centerEventId],
    queryFn: ({ signal }) => getEvent(centerEventId, signal),
    enabled: hasValidCenter,
  });

  const graphQuery = useQuery({
    queryKey: ['causal-graph', centerEventId, direction, limit, minConfidence, minCaseCount],
    queryFn: ({ signal }) => getCausalGraph(requestedQuery, signal),
    enabled: hasValidCenter,
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (inspectorOpen && selection) canvasRef.current?.ensureSelectionVisible();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspectorOpen, selection]);

  const selectedEvent: EventCandidate | null =
    selectedCandidate?.id === centerEventId
      ? selectedCandidate
      : centerEvent.data
        ? { id: centerEvent.data.id, name: centerEvent.data.name }
        : lastGraph?.meta.centerEventId === centerEventId
          ? {
              id: centerEventId,
              name: lastGraph.nodes.find((node) => node.id === centerEventId)?.name ?? '中心事件',
            }
          : null;

  const chooseEvent = useCallback(
    (event: EventCandidate) => {
      setSelectedCandidate(event);
      setGraphQuery({
        centerEventId: event.id,
        direction: 'both',
        limit: 20,
        minConfidence: 0,
        minCaseCount: 0,
      });
    },
    [requestedQuery, setGraphQuery],
  );

  const changeDirection = useCallback(
    (nextDirection: GraphDirection) => {
      if (!hasValidCenter || nextDirection === direction) return;
      setGraphQuery({ ...requestedQuery, direction: nextDirection });
    },
    [direction, hasValidCenter, requestedQuery, setGraphQuery],
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
      const eventName = lastGraph?.nodes.find((node) => node.id === eventId)?.name;
      setSelectedCandidate(eventName ? { id: eventId, name: eventName } : null);
      setGraphQuery({ ...requestedQuery, centerEventId: eventId });
    },
    [lastGraph, requestedQuery, setGraphQuery],
  );

  const changeLimit = useCallback(
    (nextLimit: GraphLimit) => {
      setGraphQuery({ ...requestedQuery, limit: nextLimit });
    },
    [requestedQuery, setGraphQuery],
  );

  const changeMinConfidence = useCallback(
    (value: number) => setGraphQuery({ ...requestedQuery, minConfidence: value }),
    [requestedQuery, setGraphQuery],
  );

  const changeMinCaseCount = useCallback(
    (value: number) => setGraphQuery({ ...requestedQuery, minCaseCount: value }),
    [requestedQuery, setGraphQuery],
  );

  const commitGraph = useCallback((graph: CausalGraphResponse) => {
    setLastGraph(graph);
    setSelection(null);
    setInspectorOpen(false);
    setLayoutState('ready');
  }, []);

  const queryError = graphQuery.error ?? centerEvent.error;
  const errorKind: GraphQueryErrorKind = queryError
    ? 'query'
    : layoutState === 'error'
      ? 'layout'
      : null;

  const retryRequest = useCallback(() => {
    if (layoutState === 'error' && !queryError) {
      canvasRef.current?.retryLayout();
      return;
    }
    void centerEvent.refetch();
    void graphQuery.refetch();
  }, [centerEvent, graphQuery, layoutState, queryError]);

  const overlay = hasInvalidCenter
    ? { message: '链接中的中心事件无效', actionLabel: '重新选择', onAction: clearCenterEvent }
    : queryError && !lastGraph
      ? isNotFound(queryError)
        ? { message: '中心事件不存在', actionLabel: '重新选择', onAction: clearCenterEvent }
        : { message: '无法加载因果图', actionLabel: '重试', onAction: retryRequest }
      : undefined;

  const isReplacing = Boolean(
    lastGraph &&
    (graphQuery.isFetching || (graphQuery.data && layoutState === 'loading' && !graphQuery.error)),
  );

  return (
    <section className="causal-graph-page" aria-label="局部因果图工作台">
      <div
        className="causal-graph-workbench"
        data-inspector-open={inspectorOpen ? 'true' : 'false'}
      >
        <CausalGraphCanvas
          ref={canvasRef}
          graph={graphQuery.data ?? lastGraph}
          centerEventName={selectedEvent?.name}
          isInitialLoading={hasValidCenter && !lastGraph && !queryError}
          isRefreshing={isReplacing}
          overlay={overlay}
          onZoomChange={setZoom}
          onLayoutStateChange={setLayoutState}
          onGraphCommit={commitGraph}
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
      </div>
      <CausalGraphToolbar
        selectedEvent={selectedEvent}
        direction={direction}
        limit={limit}
        minConfidence={minConfidence}
        minCaseCount={minCaseCount}
        zoom={zoom}
        onEventSelect={chooseEvent}
        onDirectionChange={changeDirection}
        onLimitChange={changeLimit}
        onMinConfidenceChange={changeMinConfidence}
        onMinCaseCountChange={changeMinCaseCount}
        onZoomIn={() => canvasRef.current?.zoomIn()}
        onZoomOut={() => canvasRef.current?.zoomOut()}
        onFit={() => canvasRef.current?.fit()}
      />
      <GraphStatusOverlay
        graph={lastGraph}
        isPending={isReplacing}
        errorKind={lastGraph ? errorKind : null}
        empty={!centerEventId}
        onRetry={retryRequest}
      />
      <CausalGraphInspector
        open={inspectorOpen}
        selection={selection}
        centerEventId={lastGraph?.meta.centerEventId ?? centerEventId}
        onClose={() => {
          setInspectorOpen(false);
          window.requestAnimationFrame(() => canvasRef.current?.focus());
        }}
        onSetCenter={setNodeAsCenter}
      />
    </section>
  );
}
