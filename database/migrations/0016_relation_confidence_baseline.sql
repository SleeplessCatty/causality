ALTER TABLE "causal_relations"
  ALTER COLUMN "confidence" TYPE numeric(7, 4)
  USING "confidence"::numeric(7, 4);--> statement-breakpoint
ALTER TABLE "causal_relations"
  ADD COLUMN "baseline_confidence" numeric(7, 4),
  ADD COLUMN "baseline_case_count" integer;--> statement-breakpoint
UPDATE "causal_relations" AS relation
SET
  "baseline_confidence" = relation."confidence",
  "baseline_case_count" = (
    SELECT count(*)::integer
    FROM "causal_relation_cases" AS relation_case
    WHERE relation_case."causal_relation_id" = relation."id"
  );--> statement-breakpoint
ALTER TABLE "causal_relations"
  ALTER COLUMN "baseline_confidence" SET NOT NULL,
  ALTER COLUMN "baseline_case_count" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "causal_relations" ADD CONSTRAINT "causal_relations_baseline_confidence_check" CHECK ("causal_relations"."baseline_confidence" between 0 and 100);--> statement-breakpoint
ALTER TABLE "causal_relations" ADD CONSTRAINT "causal_relations_baseline_case_count_check" CHECK ("causal_relations"."baseline_case_count" >= 0);--> statement-breakpoint
CREATE FUNCTION "initialize_relation_confidence_baseline"()
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
CREATE TRIGGER "causal_relations_initialize_confidence_baseline"
BEFORE INSERT ON "causal_relations"
FOR EACH ROW
EXECUTE FUNCTION "initialize_relation_confidence_baseline"();--> statement-breakpoint
CREATE FUNCTION "sync_inserted_relation_baseline_case_counts"()
RETURNS trigger
AS $$
BEGIN
  UPDATE "causal_relations" AS relation
  SET "baseline_case_count" = (
    SELECT count(*)::integer
    FROM "causal_relation_cases" AS relation_case
    WHERE relation_case."causal_relation_id" = relation."id"
  )
  WHERE relation."id" IN (
    SELECT DISTINCT inserted."causal_relation_id"
    FROM inserted_relation_cases AS inserted
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "causal_relation_cases_sync_inserted_baseline_count"
AFTER INSERT ON "causal_relation_cases"
REFERENCING NEW TABLE AS inserted_relation_cases
FOR EACH STATEMENT
EXECUTE FUNCTION "sync_inserted_relation_baseline_case_counts"();--> statement-breakpoint
CREATE FUNCTION "sync_deleted_relation_baseline_case_counts"()
RETURNS trigger
AS $$
BEGIN
  UPDATE "causal_relations" AS relation
  SET "baseline_case_count" = (
    SELECT count(*)::integer
    FROM "causal_relation_cases" AS relation_case
    WHERE relation_case."causal_relation_id" = relation."id"
  )
  WHERE relation."id" IN (
    SELECT DISTINCT deleted."causal_relation_id"
    FROM deleted_relation_cases AS deleted
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "causal_relation_cases_sync_deleted_baseline_count"
AFTER DELETE ON "causal_relation_cases"
REFERENCING OLD TABLE AS deleted_relation_cases
FOR EACH STATEMENT
EXECUTE FUNCTION "sync_deleted_relation_baseline_case_counts"();
