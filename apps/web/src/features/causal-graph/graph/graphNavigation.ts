import type { GraphElementSelection } from './graphSelection';

export type GraphNavigationDirection = 'up' | 'down' | 'left' | 'right';

export interface GraphPositionSnapshot {
  centerEventId: string;
  nodes: Array<{ id: string; x: number; y: number }>;
  relations: Array<{ id: string; causeEventId: string; effectEventId: string }>;
}

const directionVectors: Record<GraphNavigationDirection, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function choose<T extends { id: string; x: number; y: number }>(
  origin: { x: number; y: number },
  candidates: T[],
  direction: GraphNavigationDirection,
): T | null {
  const axis = directionVectors[direction];
  return (
    candidates
      .map((candidate) => {
        const x = candidate.x - origin.x;
        const y = candidate.y - origin.y;
        const distance = Math.hypot(x, y);
        const dot = x * axis.x + y * axis.y;
        return { candidate, distance, dot, angle: distance ? Math.acos(dot / distance) : Infinity };
      })
      .filter((item) => item.dot > 0)
      .sort(
        (left, right) =>
          left.angle - right.angle ||
          left.distance - right.distance ||
          left.candidate.id.localeCompare(right.candidate.id),
      )[0]?.candidate ?? null
  );
}

export function navigateGraph(
  selection: GraphElementSelection | null,
  direction: GraphNavigationDirection,
  snapshot: GraphPositionSnapshot,
): GraphElementSelection {
  if (!selection) return { type: 'node', id: snapshot.centerEventId };
  const positions = new Map(snapshot.nodes.map((node) => [node.id, node]));

  if (selection.type === 'node') {
    const origin = positions.get(selection.id);
    if (!origin) return selection;
    const candidates = snapshot.relations
      .filter(
        (relation) =>
          relation.causeEventId === selection.id || relation.effectEventId === selection.id,
      )
      .flatMap((relation) => {
        const cause = positions.get(relation.causeEventId);
        const effect = positions.get(relation.effectEventId);
        return cause && effect
          ? [{ id: relation.id, x: (cause.x + effect.x) / 2, y: (cause.y + effect.y) / 2 }]
          : [];
      });
    const next = choose(origin, candidates, direction);
    return next ? { type: 'relation', id: next.id } : selection;
  }

  const relation = snapshot.relations.find((item) => item.id === selection.id);
  if (!relation) return selection;
  const cause = positions.get(relation.causeEventId);
  const effect = positions.get(relation.effectEventId);
  if (!cause || !effect) return selection;
  const midpoint = { x: (cause.x + effect.x) / 2, y: (cause.y + effect.y) / 2 };
  const next = choose(midpoint, [cause, effect], direction);
  return next ? { type: 'node', id: next.id } : selection;
}
