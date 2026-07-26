CREATE OR REPLACE FUNCTION semantic_enqueue_incremental(
  target_type varchar,
  target_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO semantic_jobs (
    job_type,
    model_code,
    entity_type,
    entity_id,
    status,
    state_version
  )
  SELECT
    'incremental',
    active_model_code,
    target_type,
    target_id,
    'queued',
    state_version
  FROM semantic_index_state
  WHERE singleton_key = true
    AND active_model_code IS NOT NULL
    AND status IN ('building', 'ready', 'updating', 'incomplete')
  ON CONFLICT (entity_type, entity_id)
  WHERE job_type = 'incremental' AND status = 'queued'
  DO UPDATE SET
    model_code = EXCLUDED.model_code,
    state_version = EXCLUDED.state_version,
    attempts = 0,
    error = NULL,
    updated_at = clock_timestamp();

  UPDATE semantic_index_state state
  SET pending_items = (
        SELECT count(*)::int
        FROM semantic_jobs job
        WHERE job.job_type = 'incremental'
          AND job.status = 'queued'
          AND job.model_code = state.active_model_code
          AND job.state_version = state.state_version
      ),
      status = CASE
        WHEN state.status = 'ready' THEN 'updating'
        ELSE state.status
      END,
      updated_at = clock_timestamp()
  WHERE state.singleton_key = true
    AND state.active_model_code IS NOT NULL
    AND state.status IN ('building', 'ready', 'updating', 'incomplete');
END;
$$;
