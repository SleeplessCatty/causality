CREATE OR REPLACE FUNCTION semantic_invalidate(
  target_type varchar,
  target_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM semantic_embeddings
  WHERE entity_type = target_type
    AND entity_id = target_id;

  DELETE FROM semantic_jobs
  WHERE job_type = 'incremental'
    AND entity_type = target_type
    AND entity_id = target_id
    AND status = 'queued';

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
        WHEN state.status = 'updating'
          AND NOT EXISTS (
            SELECT 1
            FROM semantic_jobs job
            WHERE job.job_type = 'incremental'
              AND job.status IN ('queued', 'running')
              AND job.model_code = state.active_model_code
              AND job.state_version = state.state_version
          )
        THEN 'ready'
        ELSE state.status
      END,
      updated_at = clock_timestamp()
  WHERE state.singleton_key = true
    AND state.active_model_code IS NOT NULL;
END;
$$;
--> statement-breakpoint
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
    AND state.active_model_code IS NOT NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION semantic_refresh_event_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_event_id uuid;
  relation_row record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    current_event_id := NEW.id;
    PERFORM semantic_enqueue_incremental('event', current_event_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    current_event_id := OLD.id;
    PERFORM semantic_invalidate('event', current_event_id);
    RETURN OLD;
  END IF;

  current_event_id := NEW.id;
  IF NEW.name IS DISTINCT FROM OLD.name
    OR NEW.description IS DISTINCT FROM OLD.description
  THEN
    PERFORM semantic_invalidate('event', current_event_id);
    PERFORM semantic_enqueue_incremental('event', current_event_id);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.name IS DISTINCT FROM OLD.name THEN
    FOR relation_row IN
      SELECT id
      FROM causal_relations
      WHERE cause_event_id = current_event_id
         OR effect_event_id = current_event_id
      ORDER BY id
    LOOP
      PERFORM semantic_invalidate('relation', relation_row.id);
      PERFORM semantic_enqueue_incremental('relation', relation_row.id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION semantic_refresh_relation_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM semantic_enqueue_incremental('relation', NEW.id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM semantic_invalidate('relation', OLD.id);
    RETURN OLD;
  END IF;

  IF NEW.cause_event_id IS DISTINCT FROM OLD.cause_event_id
    OR NEW.effect_event_id IS DISTINCT FROM OLD.effect_event_id
    OR NEW.description IS DISTINCT FROM OLD.description
  THEN
    PERFORM semantic_invalidate('relation', NEW.id);
    PERFORM semantic_enqueue_incremental('relation', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION semantic_refresh_case_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM semantic_enqueue_incremental('case', NEW.id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM semantic_invalidate('case', OLD.id);
    RETURN OLD;
  END IF;

  IF NEW.content IS DISTINCT FROM OLD.content THEN
    PERFORM semantic_invalidate('case', NEW.id);
    PERFORM semantic_enqueue_incremental('case', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION semantic_refresh_alias_event_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM semantic_invalidate('event', NEW.event_id);
    PERFORM semantic_enqueue_incremental('event', NEW.event_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM semantic_invalidate('event', OLD.event_id);
    IF EXISTS (SELECT 1 FROM abstract_events WHERE id = OLD.event_id) THEN
      PERFORM semantic_enqueue_incremental('event', OLD.event_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    PERFORM semantic_invalidate('event', OLD.event_id);
    IF EXISTS (SELECT 1 FROM abstract_events WHERE id = OLD.event_id) THEN
      PERFORM semantic_enqueue_incremental('event', OLD.event_id);
    END IF;
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.alias IS DISTINCT FROM OLD.alias
  THEN
    PERFORM semantic_invalidate('event', NEW.event_id);
    PERFORM semantic_enqueue_incremental('event', NEW.event_id);
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION semantic_refresh_keyword_event_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM semantic_invalidate('event', NEW.event_id);
    PERFORM semantic_enqueue_incremental('event', NEW.event_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM semantic_invalidate('event', OLD.event_id);
    IF EXISTS (SELECT 1 FROM abstract_events WHERE id = OLD.event_id) THEN
      PERFORM semantic_enqueue_incremental('event', OLD.event_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    PERFORM semantic_invalidate('event', OLD.event_id);
    IF EXISTS (SELECT 1 FROM abstract_events WHERE id = OLD.event_id) THEN
      PERFORM semantic_enqueue_incremental('event', OLD.event_id);
    END IF;
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.keyword IS DISTINCT FROM OLD.keyword
    OR NEW.position IS DISTINCT FROM OLD.position
  THEN
    PERFORM semantic_invalidate('event', NEW.event_id);
    PERFORM semantic_enqueue_incremental('event', NEW.event_id);
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER abstract_events_semantic_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON abstract_events
FOR EACH ROW
EXECUTE FUNCTION semantic_refresh_event_trigger();
--> statement-breakpoint
CREATE TRIGGER causal_relations_semantic_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON causal_relations
FOR EACH ROW
EXECUTE FUNCTION semantic_refresh_relation_trigger();
--> statement-breakpoint
CREATE TRIGGER concrete_cases_semantic_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON concrete_cases
FOR EACH ROW
EXECUTE FUNCTION semantic_refresh_case_trigger();
--> statement-breakpoint
CREATE TRIGGER event_aliases_semantic_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON event_aliases
FOR EACH ROW
EXECUTE FUNCTION semantic_refresh_alias_event_trigger();
--> statement-breakpoint
CREATE TRIGGER event_keywords_semantic_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON event_keywords
FOR EACH ROW
EXECUTE FUNCTION semantic_refresh_keyword_event_trigger();
