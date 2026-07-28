DROP TRIGGER IF EXISTS "causal_relations_initialize_confidence_baseline" ON "causal_relations";--> statement-breakpoint
DROP TRIGGER IF EXISTS "causal_relation_cases_sync_inserted_baseline_count" ON "causal_relation_cases";--> statement-breakpoint
DROP TRIGGER IF EXISTS "causal_relation_cases_sync_deleted_baseline_count" ON "causal_relation_cases";--> statement-breakpoint
DROP FUNCTION IF EXISTS "initialize_relation_confidence_baseline"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "sync_inserted_relation_baseline_case_counts"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "sync_deleted_relation_baseline_case_counts"();--> statement-breakpoint
CREATE FUNCTION "initialize_relation_confidence_policy_baseline"()
RETURNS trigger
AS $$
BEGIN
  IF NEW."baseline_confidence" IS NULL THEN
    NEW."baseline_confidence" := NEW."confidence";
  END IF;
  IF NEW."baseline_case_count" IS NULL THEN
    NEW."baseline_case_count" := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "causal_relations_initialize_policy_baseline"
BEFORE INSERT ON "causal_relations"
FOR EACH ROW
EXECUTE FUNCTION "initialize_relation_confidence_policy_baseline"();--> statement-breakpoint
CREATE FUNCTION "recalculate_relation_confidences"(relation_ids uuid[])
RETURNS void
AS $$
  UPDATE "causal_relations" AS relation
  SET "confidence" = greatest(
    0::numeric,
    least(
      99.9999::numeric,
      100 - (100 - least(relation."baseline_confidence", 99.9999))
        * power(
            0.9::numeric,
            current_counts."case_count" - relation."baseline_case_count"
          )
    )
  )::numeric(7, 4)
  FROM (
    SELECT target."id", count(relation_case."concrete_case_id")::integer AS "case_count"
    FROM "causal_relations" AS target
    LEFT JOIN "causal_relation_cases" AS relation_case
      ON relation_case."causal_relation_id" = target."id"
    WHERE target."id" = ANY(relation_ids)
    GROUP BY target."id"
  ) AS current_counts
  WHERE relation."id" = current_counts."id";
$$ LANGUAGE sql;--> statement-breakpoint
CREATE FUNCTION "recalculate_inserted_relation_confidences"()
RETURNS trigger
AS $$
DECLARE
  affected_relation_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT inserted."causal_relation_id" ORDER BY inserted."causal_relation_id")
  INTO affected_relation_ids
  FROM inserted_relation_cases AS inserted;
  IF affected_relation_ids IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM relation."id"
  FROM "causal_relations" AS relation
  WHERE relation."id" = ANY(affected_relation_ids)
  ORDER BY relation."id"
  FOR UPDATE;
  PERFORM "recalculate_relation_confidences"(affected_relation_ids);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "causal_relation_cases_recalculate_inserted_confidence"
AFTER INSERT ON "causal_relation_cases"
REFERENCING NEW TABLE AS inserted_relation_cases
FOR EACH STATEMENT
EXECUTE FUNCTION "recalculate_inserted_relation_confidences"();--> statement-breakpoint
CREATE FUNCTION "recalculate_deleted_relation_confidences"()
RETURNS trigger
AS $$
DECLARE
  affected_relation_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT deleted."causal_relation_id" ORDER BY deleted."causal_relation_id")
  INTO affected_relation_ids
  FROM deleted_relation_cases AS deleted;
  IF affected_relation_ids IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM relation."id"
  FROM "causal_relations" AS relation
  WHERE relation."id" = ANY(affected_relation_ids)
  ORDER BY relation."id"
  FOR UPDATE;
  PERFORM "recalculate_relation_confidences"(affected_relation_ids);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "causal_relation_cases_recalculate_deleted_confidence"
AFTER DELETE ON "causal_relation_cases"
REFERENCING OLD TABLE AS deleted_relation_cases
FOR EACH STATEMENT
EXECUTE FUNCTION "recalculate_deleted_relation_confidences"();
