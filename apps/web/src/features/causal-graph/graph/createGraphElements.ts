import type { CausalGraphResponse } from '@causality/contracts';

import {
  fitNodeLabel,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  type FittedNodeLabel,
} from './fitNodeLabel';

export interface GraphNodeElement {
  group: 'nodes';
  data: {
    id: string;
    name: string;
    label: string;
    fontSize: number;
    isCenter: boolean;
    width: number;
    height: number;
  };
}

export interface GraphEdgeElement {
  group: 'edges';
  data: {
    id: string;
    source: string;
    target: string;
    confidence: number;
    caseCount: number;
    label: string;
  };
}

export interface GraphElements {
  nodes: GraphNodeElement[];
  edges: GraphEdgeElement[];
}

export function createGraphElements(
  graph: CausalGraphResponse,
  fitLabel: (name: string) => FittedNodeLabel = fitNodeLabel,
): GraphElements {
  return {
    nodes: graph.nodes.map((node) => {
      const fitted = fitLabel(node.name);
      return {
        group: 'nodes' as const,
        data: {
          id: node.id,
          name: node.name,
          label: fitted.text,
          fontSize: fitted.fontSize,
          isCenter: node.id === graph.meta.centerEventId,
          width: GRAPH_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
        },
      };
    }),
    edges: graph.relations.map((relation) => ({
      group: 'edges' as const,
      data: {
        id: relation.id,
        source: relation.causeEventId,
        target: relation.effectEventId,
        confidence: relation.confidence,
        caseCount: relation.caseCount,
        label: `${relation.confidence}% · ${relation.caseCount}例`,
      },
    })),
  };
}
