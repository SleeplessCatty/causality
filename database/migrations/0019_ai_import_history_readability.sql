UPDATE "ai_import_records" AS record
SET "detail" = jsonb_build_object('name', event."name") || record."detail"
FROM "abstract_events" AS event
WHERE record."record_type" = 'event'
  AND record."primary_record_id" = event."id"
  AND NOT (record."detail" ? 'name');
--> statement-breakpoint
UPDATE "ai_import_records" AS record
SET "detail" = jsonb_build_object('content', concrete_case."content") || record."detail"
FROM "concrete_cases" AS concrete_case
WHERE record."record_type" = 'case'
  AND record."primary_record_id" = concrete_case."id"
  AND NOT (record."detail" ? 'content');
--> statement-breakpoint
UPDATE "ai_import_records" AS record
SET "detail" = jsonb_build_object(
  'causeEventName', cause_event."name",
  'effectEventName', effect_event."name",
  'relationDescription', coalesce(
    record."detail" -> 'relationDescription',
    record."detail" -> 'description',
    to_jsonb(relation."description"),
    'null'::jsonb
  )
) || record."detail"
FROM "causal_relations" AS relation
JOIN "abstract_events" AS cause_event ON cause_event."id" = relation."cause_event_id"
JOIN "abstract_events" AS effect_event ON effect_event."id" = relation."effect_event_id"
WHERE record."record_type" IN ('relation', 'relation_case', 'confidence')
  AND record."primary_record_id" = relation."id";
--> statement-breakpoint
UPDATE "ai_import_records" AS record
SET "detail" = jsonb_build_object('caseContent', concrete_case."content") || record."detail"
FROM "concrete_cases" AS concrete_case
WHERE record."record_type" = 'relation_case'
  AND record."related_record_id" = concrete_case."id"
  AND NOT (record."detail" ? 'caseContent');
