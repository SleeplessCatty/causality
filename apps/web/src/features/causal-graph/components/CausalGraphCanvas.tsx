import type { CausalGraphResponse } from '@causality/contracts';
import cytoscape, {
  type ElementDefinition,
  type LayoutOptions,
  type StylesheetJson,
} from 'cytoscape';
import elk from 'cytoscape-elk';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { createGraphElements, type GraphElements } from '../graph/createGraphElements';
import { GRAPH_FIT_PADDING, graphLayoutOptions } from '../graph/graphLayoutOptions';

cytoscape.use(elk);

type LayoutState = 'idle' | 'loading' | 'ready' | 'error';
type LaidOutElements = ElementDefinition[];

export interface GraphRuntime {
  layout(
    elements: GraphElements,
    options: typeof graphLayoutOptions,
    onSuccess: (elements: LaidOutElements) => void,
    onError: (error: unknown) => void,
  ): (() => void) | void;
  commit(elements: LaidOutElements): void;
  fit(padding: number, animate: boolean): void;
  getZoom(): number;
  setZoom(zoom: number, animate: boolean): void;
  onZoom(listener: (zoom: number) => void): () => void;
  destroy(): void;
}

export interface CausalGraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  retryLayout(): void;
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
  createRuntime?: (container: HTMLElement) => GraphRuntime;
}

const graphStyles: StylesheetJson = [
  {
    selector: 'node',
    style: {
      width: 'data(width)',
      height: 'data(height)',
      shape: 'round-rectangle',
      label: 'data(label)',
      'font-size': 'data(fontSize)',
      'font-weight': 600,
      'text-wrap': 'wrap',
      'text-valign': 'center',
      'text-halign': 'center',
      color: '#183328',
      'background-color': '#ffffff',
      'border-width': 1.5,
      'border-color': '#72a58c',
      'underlay-color': '#1f513b',
      'underlay-opacity': 0.07,
      'underlay-padding': 6,
    },
  },
  {
    selector: 'node[?isCenter]',
    style: {
      'background-color': '#e4f3ea',
      'border-width': 3,
      'border-color': '#247052',
      'font-weight': 700,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.6,
      'line-color': '#4f876d',
      'target-arrow-color': '#39745a',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.9,
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 10,
      'font-weight': 600,
      color: '#365647',
      'text-background-color': '#fffefa',
      'text-background-opacity': 0.86,
      'text-background-padding': '3px',
      'text-background-shape': 'roundrectangle',
      'text-rotation': 'autorotate',
    },
  },
];

function createProductionRuntime(container: HTMLElement): GraphRuntime {
  const visible = cytoscape({
    container,
    elements: [],
    style: graphStyles,
    minZoom: 0.25,
    maxZoom: 2,
    boxSelectionEnabled: false,
    autoungrabify: true,
    autounselectify: true,
  });

  return {
    layout(elements, options, onSuccess, onError) {
      let disposed = false;
      const staging = cytoscape({
        headless: true,
        styleEnabled: true,
        elements: [...elements.nodes, ...elements.edges] as ElementDefinition[],
        style: graphStyles,
        autoungrabify: true,
        autounselectify: true,
      });
      try {
        const layout = staging.layout(options as unknown as LayoutOptions);
        layout.one('layoutstop', () => {
          if (!disposed) {
            onSuccess(
              staging.elements().map((element) => {
                const json = element.json();
                if (element.isNode()) json.position = element.position();
                return json;
              }) as unknown as ElementDefinition[],
            );
          }
          staging.destroy();
        });
        layout.run();
      } catch (error) {
        staging.destroy();
        if (!disposed) onError(error);
      }
      return () => {
        disposed = true;
        staging.destroy();
      };
    },
    commit(elements) {
      visible.batch(() => {
        visible.elements().remove();
        visible.add(elements);
        visible.nodes().lock().ungrabify().unselectify();
        visible.edges().unselectify();
      });
    },
    fit(padding, animate) {
      if (animate) {
        visible.animate({ fit: { eles: visible.elements(), padding }, duration: 180 });
      } else {
        visible.fit(visible.elements(), padding);
      }
    },
    getZoom: () => visible.zoom(),
    setZoom(zoom, animate) {
      const position = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
      if (animate) {
        visible.animate({ zoom: { level: zoom, position }, duration: 140 });
      } else {
        visible.zoom({ level: zoom, renderedPosition: position });
      }
    },
    onZoom(listener) {
      const handler = () => listener(visible.zoom());
      visible.on('zoom', handler);
      return () => visible.off('zoom', handler);
    },
    destroy: () => visible.destroy(),
  };
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
      createRuntime = createProductionRuntime,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<GraphRuntime | null>(null);
    const graphRef = useRef(graph);
    const layoutRunRef = useRef(0);
    const cancelLayoutRef = useRef<(() => void) | undefined>(undefined);
    const [layoutState, setLayoutState] = useState<LayoutState>(graph ? 'loading' : 'idle');

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
            runtime.fit(GRAPH_FIT_PADDING, false);
            updateLayoutState('ready');
          },
          () => {
            if (run === layoutRunRef.current) updateLayoutState('error');
          },
        ) ?? undefined;
    }, [updateLayoutState]);

    useEffect(() => {
      if (!containerRef.current) return;
      const runtime = createRuntime(containerRef.current);
      runtimeRef.current = runtime;
      const removeZoomListener = runtime.onZoom((zoom) => onZoomChange?.(zoom));
      return () => {
        layoutRunRef.current += 1;
        cancelLayoutRef.current?.();
        removeZoomListener();
        runtime.destroy();
        runtimeRef.current = null;
      };
    }, [createRuntime, onZoomChange, runLayout]);

    useEffect(() => {
      graphRef.current = graph;
      if (graph && runtimeRef.current) runLayout();
      if (!graph) updateLayoutState('idle');
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
          runtime.setZoom(Math.max(0.25, runtime.getZoom() / 1.2), !prefersReducedMotion());
        },
        fit() {
          runtimeRef.current?.fit(GRAPH_FIT_PADDING, !prefersReducedMotion());
        },
        retryLayout: runLayout,
      }),
      [runLayout],
    );

    const nodeCount = graph?.meta.nodeCount ?? 0;
    const relationCount = graph?.meta.relationCount ?? 0;
    const accessibleName = centerEventName
      ? `${centerEventName}的局部因果图，${nodeCount} 个节点，${relationCount} 条关系`
      : '局部因果图画布，尚未选择中心事件';

    return (
      <section className={`causal-graph-canvas${isRefreshing ? ' is-refreshing' : ''}`}>
        <div
          ref={containerRef}
          className="causal-graph-canvas__renderer"
          role="img"
          aria-label={accessibleName}
          data-layout-state={layoutState}
          data-node-count={nodeCount}
          data-relation-count={relationCount}
        />
        {!graph && !isInitialLoading && !overlay ? (
          <div className="causal-graph-canvas__state" role="status">
            <strong>搜索并选择一个中心事件</strong>
            <span>选择后将自动生成初始局部因果图</span>
          </div>
        ) : null}
        {isInitialLoading ? (
          <div className="causal-graph-canvas__state" role="status">
            <strong>正在生成因果图…</strong>
          </div>
        ) : null}
        {isRefreshing ? (
          <div className="causal-graph-canvas__state is-overlay" role="status">
            <strong>正在重新生成…</strong>
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
        {layoutState === 'ready' && graph?.relations.length === 0 ? (
          <p className="causal-graph-canvas__notice">当前方向暂无关联事件</p>
        ) : null}
      </section>
    );
  },
);
