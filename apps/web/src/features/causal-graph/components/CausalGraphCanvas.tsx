import type { CausalGraphResponse } from '@causality/contracts';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { createGraphElements } from '../graph/createGraphElements';
import { createGraphRuntime, type GraphRuntime } from '../graph/createGraphRuntime';
import { GRAPH_FIT_PADDING, graphLayoutOptions } from '../graph/graphLayoutOptions';
import { navigateGraph, type GraphNavigationDirection } from '../graph/graphNavigation';
import type { GraphElementSelection } from '../graph/graphSelection';

export type { GraphRuntime } from '../graph/createGraphRuntime';

type LayoutState = 'idle' | 'loading' | 'ready' | 'error';

export interface CausalGraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  retryLayout(): void;
  resize(): void;
  ensureSelectionVisible(padding?: number): void;
  focus(): void;
}

interface CausalGraphCanvasProps {
  graph: CausalGraphResponse | null;
  centerEventName?: string | undefined;
  isInitialLoading?: boolean;
  isRefreshing?: boolean;
  overlay?:
    | {
        message: string;
        actionLabel?: string;
        onAction?: () => void;
        role?: 'status' | 'alert';
      }
    | undefined;
  onZoomChange?: (zoom: number) => void;
  onLayoutStateChange?: (state: LayoutState) => void;
  onGraphCommit?: (graph: CausalGraphResponse) => void;
  selection?: GraphElementSelection | null;
  inspectorOpen?: boolean;
  onSelectionChange?: (selection: GraphElementSelection) => void;
  onClearSelection?: () => void;
  onToggleInspector?: () => void;
  onEscape?: () => void;
  createRuntime?: (container: HTMLElement) => GraphRuntime;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export const CausalGraphCanvas = forwardRef<CausalGraphCanvasHandle, CausalGraphCanvasProps>(
  function CausalGraphCanvas(
    {
      graph,
      centerEventName,
      isInitialLoading = false,
      isRefreshing = false,
      overlay,
      onZoomChange,
      onLayoutStateChange,
      onGraphCommit,
      selection = null,
      inspectorOpen = false,
      onSelectionChange,
      onClearSelection,
      onToggleInspector,
      onEscape,
      createRuntime = createGraphRuntime,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<GraphRuntime | null>(null);
    const graphRef = useRef(graph);
    const selectionRef = useRef(selection);
    const interactionCallbacksRef = useRef({
      onSelectionChange,
      onClearSelection,
    });
    const layoutRunRef = useRef(0);
    const cancelLayoutRef = useRef<(() => void) | undefined>(undefined);
    const [layoutState, setLayoutState] = useState<LayoutState>(graph ? 'loading' : 'idle');
    const [committedGraph, setCommittedGraph] = useState<CausalGraphResponse | null>(null);

    const updateLayoutState = useCallback(
      (state: LayoutState) => {
        setLayoutState(state);
        onLayoutStateChange?.(state);
      },
      [onLayoutStateChange],
    );

    const runLayout = useCallback(() => {
      const runtime = runtimeRef.current;
      const currentGraph = graphRef.current;
      if (!runtime || !currentGraph) return;
      cancelLayoutRef.current?.();
      const run = ++layoutRunRef.current;
      updateLayoutState('loading');
      cancelLayoutRef.current =
        runtime.layout(
          createGraphElements(currentGraph),
          graphLayoutOptions,
          (elements) => {
            if (run !== layoutRunRef.current) return;
            runtime.commit(elements);
            runtime.setSelection(null);
            runtime.fit(GRAPH_FIT_PADDING, false);
            setCommittedGraph(currentGraph);
            updateLayoutState('ready');
            onGraphCommit?.(currentGraph);
          },
          () => {
            if (run === layoutRunRef.current) updateLayoutState('error');
          },
        ) ?? undefined;
    }, [onGraphCommit, updateLayoutState]);

    useEffect(() => {
      if (!containerRef.current) return;
      const runtime = createRuntime(containerRef.current);
      runtimeRef.current = runtime;
      const removeZoomListener = runtime.onZoom((zoom) => onZoomChange?.(zoom));
      const removeInteractionListeners = runtime.subscribeInteractions({
        onSelect(nextSelection) {
          interactionCallbacksRef.current.onSelectionChange?.(nextSelection);
        },
        onClearSelection() {
          interactionCallbacksRef.current.onClearSelection?.();
        },
      });
      return () => {
        layoutRunRef.current += 1;
        cancelLayoutRef.current?.();
        removeZoomListener();
        removeInteractionListeners();
        runtime.destroy();
        runtimeRef.current = null;
      };
    }, [createRuntime, onZoomChange, runLayout]);

    useEffect(() => {
      interactionCallbacksRef.current = { onSelectionChange, onClearSelection };
    }, [onClearSelection, onSelectionChange]);

    useEffect(() => {
      const focusAfterCanvasInteraction = (event: PointerEvent) => {
        const container = containerRef.current;
        if (container && event.target instanceof Node && container.contains(event.target)) {
          window.setTimeout(() => container.focus({ preventScroll: true }), 0);
        }
      };
      document.addEventListener('pointerup', focusAfterCanvasInteraction, true);
      return () => document.removeEventListener('pointerup', focusAfterCanvasInteraction, true);
    }, []);

    useEffect(() => {
      selectionRef.current = selection;
      runtimeRef.current?.setSelection(selection);
    }, [selection]);

    useEffect(() => {
      graphRef.current = graph;
      if (graph && runtimeRef.current) runLayout();
      if (!graph) {
        runtimeRef.current?.commit([]);
        setCommittedGraph(null);
        updateLayoutState('idle');
      }
    }, [graph, runLayout, updateLayoutState]);

    useImperativeHandle(
      ref,
      () => ({
        zoomIn() {
          const runtime = runtimeRef.current;
          if (!runtime) return;
          runtime.setZoom(Math.min(2, runtime.getZoom() * 1.2), !prefersReducedMotion());
        },
        zoomOut() {
          const runtime = runtimeRef.current;
          if (!runtime) return;
          runtime.setZoom(Math.max(0.1, runtime.getZoom() / 1.2), !prefersReducedMotion());
        },
        fit() {
          runtimeRef.current?.fit(GRAPH_FIT_PADDING, !prefersReducedMotion());
        },
        retryLayout: runLayout,
        resize() {
          runtimeRef.current?.resize();
        },
        ensureSelectionVisible(padding = 32) {
          const currentSelection = selectionRef.current;
          if (!currentSelection) return;
          runtimeRef.current?.ensureVisible(currentSelection, padding, !prefersReducedMotion());
        },
        focus() {
          containerRef.current?.focus({ preventScroll: true });
        },
      }),
      [runLayout],
    );

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        const keyDirections: Partial<Record<string, GraphNavigationDirection>> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        };
        const direction = keyDirections[event.key];
        const navigationGraph = committedGraph ?? graph;
        if (direction && navigationGraph) {
          event.preventDefault();
          const runtime = runtimeRef.current;
          if (!runtime) return;
          const nextSelection = navigateGraph(
            selectionRef.current,
            direction,
            runtime.getNavigationSnapshot(navigationGraph.meta.centerEventId),
          );
          onSelectionChange?.(nextSelection);
          return;
        }
        if (event.key === ' ' && navigationGraph) {
          event.preventDefault();
          onToggleInspector?.();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          onEscape?.();
        }
      },
      [committedGraph, graph, onEscape, onSelectionChange, onToggleInspector],
    );

    const visibleGraph = committedGraph ?? graph;
    const nodeCount = visibleGraph?.meta.nodeCount ?? 0;
    const relationCount = visibleGraph?.meta.relationCount ?? 0;
    const accessibleName = centerEventName
      ? `${centerEventName}的局部因果图，${nodeCount} 个节点，${relationCount} 条关系`
      : '局部因果图画布，尚未选择中心事件';
    const selectedNode =
      selection?.type === 'node'
        ? visibleGraph?.nodes.find((node) => node.id === selection.id)
        : undefined;
    const selectedRelation =
      selection?.type === 'relation'
        ? visibleGraph?.relations.find((relation) => relation.id === selection.id)
        : undefined;
    const selectedRelationCause = selectedRelation
      ? visibleGraph?.nodes.find((node) => node.id === selectedRelation.causeEventId)
      : undefined;
    const selectedRelationEffect = selectedRelation
      ? visibleGraph?.nodes.find((node) => node.id === selectedRelation.effectEventId)
      : undefined;
    const selectionAnnouncement = selectedNode
      ? `已选择事件：${selectedNode.name}`
      : selectedRelation
        ? `已选择关系：${selectedRelationCause?.name ?? ''}到${selectedRelationEffect?.name ?? ''}，置信度${selectedRelation.confidence}%，${selectedRelation.caseCount}条案例`
        : '';

    return (
      <section className={`causal-graph-canvas${isRefreshing ? ' is-refreshing' : ''}`}>
        <div
          ref={containerRef}
          className="causal-graph-canvas__renderer"
          role="application"
          tabIndex={visibleGraph ? 0 : -1}
          aria-label={accessibleName}
          onKeyDown={handleKeyDown}
          data-layout-state={layoutState}
          data-node-count={nodeCount}
          data-relation-count={relationCount}
          data-selection-type={selection?.type ?? ''}
          data-selection-id={selection?.id ?? ''}
          data-inspector-open={inspectorOpen ? 'true' : 'false'}
        />
        <span className="sr-only" aria-live="polite">
          {selectionAnnouncement}
        </span>
        {!graph && !isInitialLoading && !overlay ? (
          <div className="causal-graph-canvas__state" role="status">
            <strong>搜索并选择一个中心事件</strong>
            <span>选择后将自动生成初始局部因果图</span>
          </div>
        ) : null}
        {overlay ? (
          <div className="causal-graph-canvas__state is-overlay" role={overlay.role ?? 'alert'}>
            <strong>{overlay.message}</strong>
            {overlay.actionLabel && overlay.onAction ? (
              <button type="button" onClick={overlay.onAction}>
                {overlay.actionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
        {layoutState === 'error' && !overlay ? (
          <div className="causal-graph-canvas__state is-overlay" role="alert">
            <strong>无法生成布局</strong>
            <button type="button" onClick={runLayout}>
              重新布局
            </button>
          </div>
        ) : null}
        {layoutState === 'ready' && visibleGraph?.relations.length === 0 ? (
          <p className="causal-graph-canvas__notice">当前方向暂无关联事件</p>
        ) : null}
      </section>
    );
  },
);
