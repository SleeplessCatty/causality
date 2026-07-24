export interface SemanticValuesFragment {
  sql: string;
  parameters: string[];
}

export function buildSemanticValues(
  semanticIds: string[],
  firstParameter: number,
): SemanticValuesFragment {
  if (semanticIds.length > 100) {
    throw new Error('Semantic list merge accepts at most 100 candidates');
  }
  if (semanticIds.length === 0) {
    return {
      sql: `select null::uuid as id, null::int as semantic_rank where false`,
      parameters: [],
    };
  }
  return {
    sql: `values ${semanticIds
      .map((_id, index) => `($${firstParameter + index}::uuid, ${index + 1}::int)`)
      .join(', ')}`,
    parameters: semanticIds,
  };
}

export function buildSemanticMergeCtes(
  normalCandidatesSql: string,
  semanticValuesSql: string,
): string {
  return `semantic_candidates (id, semantic_rank) as (
         ${semanticValuesSql}
       ), normal_candidates as (
         ${normalCandidatesSql}
       ), combined as (
         select id,
                0::int as source_priority,
                normal_rank,
                null::int as semantic_rank
         from normal_candidates
         union all
         select id,
                1::int as source_priority,
                null::int as normal_rank,
                semantic_rank
         from semantic_candidates
       ), merged as (
         select id,
                min(source_priority)::int as source_priority,
                min(normal_rank)::int as normal_rank,
                min(semantic_rank)::int as semantic_rank
         from combined
         group by id
       )`;
}
