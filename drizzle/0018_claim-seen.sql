ALTER TABLE "claims" ADD COLUMN "seen" jsonb;--> statement-breakpoint
-- Existing claims start from the item as it is now, so nothing reads as changed until the owner next
-- edits it. A claim this leaves empty (its owner cannot read the rows) simply never shows a change.
UPDATE "claims" SET "seen" = jsonb_build_object(
  'title', "items"."title", 'note', "items"."note", 'url', "items"."url",
  'store', "items"."store", 'price', "items"."price"::text, 'imageKey', "items"."image_key"
) FROM "items" WHERE "items"."family_id" = "claims"."family_id" AND "items"."id" = "claims"."item_id";
