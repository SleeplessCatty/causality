DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "abstract_events" WHERE char_length(btrim("name")) > 50) THEN
		RAISE EXCEPTION 'Cannot apply UX-02R1: shorten event names to 50 characters before migrating' USING ERRCODE = '22001';
	END IF;
	IF EXISTS (SELECT 1 FROM "event_aliases" WHERE char_length(btrim("alias")) > 80) THEN
		RAISE EXCEPTION 'Cannot apply UX-02R1: shorten event aliases to 80 characters before migrating' USING ERRCODE = '22001';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "abstract_events" CROSS JOIN LATERAL unnest("keywords") AS keyword
		WHERE char_length(btrim(keyword)) NOT BETWEEN 1 AND 50
	) THEN
		RAISE EXCEPTION 'Cannot apply UX-02R1: keep every event keyword between 1 and 50 characters before migrating' USING ERRCODE = '22001';
	END IF;
END $$;--> statement-breakpoint
CREATE FUNCTION text_array_items_length_between(values_to_check text[], minimum_length integer, maximum_length integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
	SELECT coalesce(
		bool_and(value IS NOT NULL AND char_length(btrim(value)) BETWEEN minimum_length AND maximum_length),
		true
	)
	FROM unnest(values_to_check) AS value
$$;--> statement-breakpoint
ALTER TABLE "abstract_events" DROP CONSTRAINT "abstract_events_name_length_check";--> statement-breakpoint
ALTER TABLE "concrete_cases" DROP CONSTRAINT "concrete_cases_content_check";--> statement-breakpoint
ALTER TABLE "event_aliases" DROP CONSTRAINT "event_aliases_alias_length_check";--> statement-breakpoint
DROP INDEX "abstract_events_normalized_name_uidx";--> statement-breakpoint
DROP INDEX "abstract_events_normalized_name_trgm_idx";--> statement-breakpoint
DROP INDEX "event_aliases_event_normalized_uidx";--> statement-breakpoint
DROP INDEX "event_aliases_normalized_alias_idx";--> statement-breakpoint
DROP INDEX "event_aliases_normalized_alias_trgm_idx";--> statement-breakpoint
ALTER TABLE "abstract_events" DROP COLUMN "normalized_name";--> statement-breakpoint
ALTER TABLE "event_aliases" DROP COLUMN "normalized_alias";--> statement-breakpoint
ALTER TABLE "abstract_events" ALTER COLUMN "name" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "concrete_cases" ALTER COLUMN "content" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "event_aliases" ALTER COLUMN "alias" SET DATA TYPE varchar(80);--> statement-breakpoint
ALTER TABLE "abstract_events" ADD COLUMN "normalized_name" varchar(50) GENERATED ALWAYS AS (lower(btrim("name"))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "event_aliases" ADD COLUMN "normalized_alias" varchar(80) GENERATED ALWAYS AS (lower(btrim("alias"))) STORED NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "abstract_events_normalized_name_uidx" ON "abstract_events" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "abstract_events_normalized_name_trgm_idx" ON "abstract_events" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "event_aliases_event_normalized_uidx" ON "event_aliases" USING btree ("event_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "event_aliases_normalized_alias_idx" ON "event_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "event_aliases_normalized_alias_trgm_idx" ON "event_aliases" USING gin ("normalized_alias" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "abstract_events" ADD CONSTRAINT "abstract_events_keywords_length_check" CHECK (text_array_items_length_between("abstract_events"."keywords", 1, 50));--> statement-breakpoint
ALTER TABLE "abstract_events" ADD CONSTRAINT "abstract_events_name_length_check" CHECK (char_length(btrim("abstract_events"."name")) between 1 and 50);--> statement-breakpoint
ALTER TABLE "concrete_cases" ADD CONSTRAINT "concrete_cases_content_check" CHECK ("concrete_cases"."content" = btrim("concrete_cases"."content") and char_length("concrete_cases"."content") between 1 and 100);--> statement-breakpoint
ALTER TABLE "event_aliases" ADD CONSTRAINT "event_aliases_alias_length_check" CHECK (char_length(btrim("event_aliases"."alias")) between 1 and 80);
