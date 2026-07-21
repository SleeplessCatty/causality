export type GraphElementSelection = { type: 'node'; id: string } | { type: 'relation'; id: string };

interface RelationReference {
  id: string;
  causeEventId: string;
  effectEventId: string;
}

export function adjacentSelectionIds(
  selection: GraphElementSelection,
  graph: { relations: RelationReference[] },
): { currentId: string; contextNodeIds: string[]; contextRelationIds: string[] } {
  if (selection.type === 'relation') {
    const relation = graph.relations.find((item) => item.id === selection.id);
    return {
      currentId: selection.id,
      contextNodeIds: relation ? [relation.causeEventId, relation.effectEventId] : [],
      contextRelationIds: [],
    };
  }

  const nodeIds = new Set<string>();
  const relationIds: string[] = [];
  for (const relation of graph.relations) {
    if (relation.causeEventId === selection.id) {
      relationIds.push(relation.id);
      nodeIds.add(relation.effectEventId);
    } else if (relation.effectEventId === selection.id) {
      relationIds.push(relation.id);
      nodeIds.add(relation.causeEventId);
    }
  }
  return {
    currentId: selection.id,
    contextNodeIds: [...nodeIds],
    contextRelationIds: relationIds,
  };
}
