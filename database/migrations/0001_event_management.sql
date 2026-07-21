CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "abstract_events_normalized_name_trgm_idx" ON "abstract_events" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "abstract_events_updated_at_id_idx" ON "abstract_events" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_aliases_normalized_alias_trgm_idx" ON "event_aliases" USING gin ("normalized_alias" gin_trgm_ops);
