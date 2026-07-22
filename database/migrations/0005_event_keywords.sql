CREATE TABLE "event_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"keyword" varchar(50) NOT NULL,
	"normalized_keyword" varchar(50) GENERATED ALWAYS AS (lower(btrim(keyword))) STORED NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "event_keywords_length_check" CHECK (char_length(btrim("event_keywords"."keyword")) between 1 and 50),
	CONSTRAINT "event_keywords_position_check" CHECK ("event_keywords"."position" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "event_keywords" ADD CONSTRAINT "event_keywords_event_id_abstract_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."abstract_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_keywords_event_normalized_uidx" ON "event_keywords" USING btree ("event_id","normalized_keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "event_keywords_event_position_uidx" ON "event_keywords" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "event_keywords_normalized_trgm_idx" ON "event_keywords" USING gin ("normalized_keyword" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "event_keywords_event_id_idx" ON "event_keywords" USING btree ("event_id");--> statement-breakpoint
INSERT INTO "event_keywords" ("event_id", "keyword", "position")
SELECT event.id, source.keyword, source.position::integer
FROM "abstract_events" event
CROSS JOIN LATERAL unnest(event."keywords") WITH ORDINALITY AS source(keyword, position);--> statement-breakpoint
DO $$
DECLARE
	source_count bigint;
	target_count bigint;
BEGIN
	SELECT coalesce(sum(cardinality("keywords")), 0)
	INTO source_count
	FROM "abstract_events";

	SELECT count(*)
	INTO target_count
	FROM "event_keywords";

	IF source_count <> target_count THEN
		RAISE EXCEPTION 'Event keyword migration count mismatch: source %, target %', source_count, target_count;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "abstract_events" DROP CONSTRAINT "abstract_events_keywords_length_check";--> statement-breakpoint
ALTER TABLE "abstract_events" DROP COLUMN "keywords";
