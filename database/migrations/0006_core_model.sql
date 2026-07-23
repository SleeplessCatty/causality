DROP INDEX "causal_relations_cause_event_id_idx";--> statement-breakpoint
DROP INDEX "causal_relations_effect_event_id_idx";--> statement-breakpoint
CREATE INDEX "causal_relations_cause_created_at_id_idx" ON "causal_relations" USING btree ("cause_event_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "causal_relations_effect_created_at_id_idx" ON "causal_relations" USING btree ("effect_event_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);