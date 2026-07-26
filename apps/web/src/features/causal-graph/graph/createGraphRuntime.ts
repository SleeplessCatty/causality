import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObject,
  type LayoutOptions,
} from 'cytoscape';
import elk from 'cytoscape-elk';

import type { GraphElements } from './createGraphElements';
import type { graphLayoutOptions } from './graphLayoutOptions';
import type { GraphPositionSnapshot } from './graphNavigation';
import type { GraphElementSelection } from './graphSelection';
import { graphStyles } from './graphStyles';

cytoscape.use(elk);

export type LaidOutElements = ElementDefinition[];

export interface GraphInteractionCallbacks {
  onSelect(selection: GraphElementSelection): void;
  onClearSelection(): void;
}

export interface GraphRuntime {
  layout(
    elements: GraphElements,
    options: typeof graphLayoutOptions,
    onSuccess: (elements: LaidOutElements) => void,
    onError: (error: unknown) => void,
  ): (() => void) | void;
  commit(elements: LaidOutElements): void;
  fit(padding: number, animate: boolean): void;
  focusNode(id: string, padding: number, minimumZoom: number): void;
  getZoom(): number;
  setZoom(zoom: number, animate: boolean): void;
  onZoom(listener: (zoom: number) => void): () => void;
  setSelection(selection: GraphElementSelection | null): void;
  getNavigationSnapshot(centerEventId: string): GraphPositionSnapshot;
  resize(): void;
  ensureVisible(selection: GraphElementSelection, padding: number, animate: boolean): void;
  subscribeInteractions(callbacks: GraphInteractionCallbacks): () => void;
  destroy(): void;
}

export function createLayoutRuntime(
  elements: GraphElements,
  options: typeof graphLayoutOptions,
  onSuccess: (elements: LaidOutElements) => void,
  onError: (error: unknown) => void,
): () => void {
  let disposed = false;
  let cleaned = false;
  const staging = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [...elements.nodes, ...elements.edges] as ElementDefinition[],
    style: graphStyles,
    autoungrabify: true,
    autounselectify: true,
  });
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    staging.destroy();
  };
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
      cleanup();
    });
    layout.run();
    return () => {
      if (disposed) return;
      disposed = true;
      layout.stop();
      cleanup();
    };
  } catch (error) {
    cleanup();
    if (!disposed) onError(error);
    return () => {
      disposed = true;
    };
  }
}

function selectionElement(cy: Core, selection: GraphElementSelection) {
  return cy.getElementById(selection.id);
}

export function applyGraphSelection(visible: Core, selection: GraphElementSelection | null): void {
  visible.batch(() => {
    visible.elements().removeClass('is-current is-context is-incoming is-outgoing');
    if (!selection) return;
    const current = selectionElement(visible, selection);
    if (current.empty()) return;
    current.addClass('is-current');
    if (selection.type === 'relation') {
      current.connectedNodes().addClass('is-context');
      return;
    }
    const relations = current.connectedEdges();
    relations.addClass('is-context');
    current.incomers('edge').addClass('is-incoming');
    current.outgoers('edge').addClass('is-outgoing');
    relations.connectedNodes().not(current).addClass('is-context');
  });
}

export function focusVisibleNode(
  visible: Core,
  id: string,
  padding: number,
  minimumZoom: number,
): void {
  const node = visible.getElementById(id);
  visible.fit(visible.elements(), padding);
  if (visible.zoom() < minimumZoom) visible.zoom(minimumZoom);
  if (!node.empty()) visible.center(node);
}

export function createGraphRuntime(container: HTMLElement): GraphRuntime {
  const visible = cytoscape({
    container,
    elements: [],
    style: graphStyles,
    minZoom: 0.1,
    maxZoom: 2,
    boxSelectionEnabled: false,
    autoungrabify: false,
    autounselectify: true,
    desktopTapThreshold: 4,
  });

  return {
    layout: createLayoutRuntime,
    commit(elements) {
      visible.batch(() => {
        visible.elements().remove();
        visible.add(elements);
        visible.nodes().unlock().grabify().unselectify();
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
    focusNode(id, padding, minimumZoom) {
      focusVisibleNode(visible, id, padding, minimumZoom);
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
    setSelection(selection) {
      applyGraphSelection(visible, selection);
    },
    getNavigationSnapshot(centerEventId) {
      return {
        centerEventId,
        nodes: visible.nodes().map((node) => ({ id: node.id(), ...node.position() })),
        relations: visible.edges().map((edge) => ({
          id: edge.id(),
          causeEventId: edge.source().id(),
          effectEventId: edge.target().id(),
        })),
      };
    },
    resize: () => visible.resize(),
    ensureVisible(selection, padding, animate) {
      const element = selectionElement(visible, selection);
      if (element.empty()) return;
      const bounds = element.renderedBoundingBox({ includeLabels: true });
      const width = container.clientWidth;
      const height = container.clientHeight;
      let x = 0;
      let y = 0;
      if (bounds.x1 < padding) x = padding - bounds.x1;
      else if (bounds.x2 > width - padding) x = width - padding - bounds.x2;
      if (bounds.y1 < padding) y = padding - bounds.y1;
      else if (bounds.y2 > height - padding) y = height - padding - bounds.y2;
      if (!x && !y) return;
      if (animate) visible.animate({ panBy: { x, y }, duration: 140 });
      else visible.panBy({ x, y });
    },
    subscribeInteractions(callbacks) {
      const focusCanvas = () => {
        window.setTimeout(() => container.focus({ preventScroll: true }), 0);
      };
      const onNode = (event: EventObject) => {
        focusCanvas();
        callbacks.onSelect({ type: 'node', id: event.target.id() });
      };
      const onEdge = (event: EventObject) => {
        focusCanvas();
        callbacks.onSelect({ type: 'relation', id: event.target.id() });
      };
      const onBackground = (event: EventObject) => {
        if (event.target === visible) {
          focusCanvas();
          callbacks.onClearSelection();
        }
      };
      visible.on('tap', 'node', onNode);
      visible.on('tap', 'edge', onEdge);
      visible.on('tap', onBackground);
      container.addEventListener('click', focusCanvas, { capture: true });
      return () => {
        visible.off('tap', 'node', onNode);
        visible.off('tap', 'edge', onEdge);
        visible.off('tap', onBackground);
        container.removeEventListener('click', focusCanvas, { capture: true });
      };
    },
    destroy: () => visible.destroy(),
  };
}
