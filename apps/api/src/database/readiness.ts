import type { Pool, PoolClient } from 'pg';

export async function isDatabaseReady(pool: Pool | PoolClient): Promise<boolean> {
  try {
    const result = await pool.query<{ ready: boolean }>(
      `select
         exists (
           select 1
           from pg_extension
           where extname = 'vector'
         )
         and to_regclass('public.semantic_model_settings') is not null
         and to_regclass('public.semantic_index_state') is not null
         and to_regclass('public.semantic_embeddings') is not null
         and to_regclass('public.semantic_jobs') is not null
         as ready`,
    );
    return result.rows[0]?.ready ?? false;
  } catch {
    return false;
  }
}
