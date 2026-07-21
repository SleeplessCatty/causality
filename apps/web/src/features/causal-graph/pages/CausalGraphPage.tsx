import type { CausalGraphQuery, CausalGraphResponse, EventCandidate } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { ApiClientError, getEvent } from '../../events/api/eventApi';
import { getCausalGraph } from '../api/causalGraphApi';
import { CausalGraphCanvas, type CausalGraphCanvasHandle } from '../components/CausalGraphCanvas';
import { CausalGraphInspector } from '../components/CausalGraphInspector';
import { CausalGraphToolbar } from '../components/CausalGraphToolbar';
import { GraphFilterPopover } from '../components/GraphFilterPopover';
import { GraphQueryStatus, type GraphQueryErrorKind } from '../components/GraphQueryStatus';
import {
  activeGraphFilterCount,
  parseGraphQueryState,
  toGraphSearchParams,
  type GraphFilterValues,
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
  const [filterOpen, setFilterOpen] = useState(false);
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
      canvasRef.current?.resize();
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
      setFilterOpen(false);
      setGraphQuery({
        ...requestedQuery,
        centerEventId: event.id,
        direction: 'both',
        limit: 20,
      });
    },
    [requestedQuery, setGraphQuery],
  );

  const changeDirection = useCallback(
    (nextDirection: GraphDirection) => {
      if (!hasValidCenter || nextDirection === direction) return;
      setFilterOpen(false);
      setGraphQuery({ ...requestedQuery, direction: nextDirection, limit: 20 });
    },
    [direction, hasValidCenter, requestedQuery, setGraphQuery],
  );

  const clearCenterEvent = useCallback(() => {
    setSelection(null);
    setInspectorOpen(false);
    setSelectedCandidate(null);
    setLastGraph(null);
    setFilterOpen(false);
    setSearchParams({});
  }, [setSearchParams]);

  const setNodeAsCenter = useCallback(
    (eventId: string) => {
      const eventName = lastGraph?.nodes.find((node) => node.id === eventId)?.name;
      setSelectedCandidate(eventName ? { id: eventId, name: eventName } : null);
      setGraphQuery({ ...requestedQuery, centerEventId: eventId, limit: 20 });
    },
    [lastGraph, requestedQuery, setGraphQuery],
  );

  const applyFilters = useCallback(
    (filters: GraphFilterValues) => {
      setFilterOpen(false);
      setGraphQuery({ ...requestedQuery, ...filters, limit: 20 });
    },
    [requestedQuery, setGraphQuery],
  );

  const resetFilters = useCallback(() => {
    setFilterOpen(false);
    setGraphQuery({ ...requestedQuery, minConfidence: 0, minCaseCount: 0, limit: 20 });
  }, [requestedQuery, setGraphQuery]);

  const expandGraph = useCallback(
    (nextLimit: GraphLimit) => {
      setFilterOpen(false);
      setGraphQuery({ ...requestedQuery, limit: nextLimit });
    },
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

  const countText = lastGraph
    ? `${lastGraph.meta.nodeCount} 个节点 · ${lastGraph.meta.relationCount} 条关系`
    : '等待选择中心事件';
  const isReplacing = Boolean(
    lastGraph &&
    (graphQuery.isFetching || (graphQuery.data && layoutState === 'loading' && !graphQuery.error)),
  );

  return (
    <section className="causal-graph-page" aria-labelledby="causal-graph-title">
      <header className="causal-graph-page__heading">
        <div>
          <h1 id="causal-graph-title">局部因果图</h1>
          <p>从一个原子事件查看局部因果网络</p>
        </div>
        <div className="causal-graph-page__count" aria-live="polite">
          <span>{countText}</span>
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
        filterCount={activeGraphFilterCount(requestedQuery)}
        filterOpen={filterOpen}
        onFilterToggle={() => setFilterOpen((current) => !current)}
        filterPopover={
          <GraphFilterPopover
            open={filterOpen}
            values={requestedQuery}
            onApply={applyFilters}
            onReset={resetFilters}
            onClose={() => setFilterOpen(false)}
          />
        }
      />
      <GraphQueryStatus
        displayedGraph={lastGraph}
        requestedQuery={requestedQuery}
        isPending={isReplacing}
        errorKind={lastGraph ? errorKind : null}
        onExpand={expandGraph}
        onAdjustFilter={() => setFilterOpen(true)}
        onRetry={retryRequest}
      />
      <div
        className={`causal-graph-workbench${inspectorOpen ? ' has-inspector' : ''}`}
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
      </div>
    </section>
  );
}
