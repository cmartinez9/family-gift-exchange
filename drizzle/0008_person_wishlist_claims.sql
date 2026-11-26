ALTER TABLE "claims" DROP CONSTRAINT "claims_claimer_fk";
--> statement-breakpoint
DROP INDEX "claims_one_per_item_per_exchange";--> statement-breakpoint
ALTER TABLE "claims" ALTER COLUMN "exchange_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_exchange_fk" FOREIGN KEY ("family_id","exchange_id") REFERENCES "public"."exchanges"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimer_fk" FOREIGN KEY ("family_id","claimer_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_per_item" ON "claims" USING btree ("family_id","item_id");--> statement-breakpoint
CREATE INDEX "claims_claimer_idx" ON "claims" USING btree ("family_id","claimer_id");