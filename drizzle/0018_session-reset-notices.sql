ALTER TABLE "sessions" ADD COLUMN "reset_notice_eligible" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "sessions" AS prior SET "reset_notice_eligible" = true
WHERE prior."revoked_at" IS NOT NULL AND NOT prior."trusted"
  AND EXISTS (
    SELECT 1 FROM "auth_events" AS event
    WHERE event."family_id" = prior."family_id" AND event."person_id" = prior."person_id"
      AND event."kind" = 'resetUsed' AND event."at" = prior."revoked_at"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "sessions" AS later
    WHERE later."family_id" = prior."family_id" AND later."person_id" = prior."person_id"
      AND later."created_at" > prior."revoked_at"
      AND NOT EXISTS (
        SELECT 1 FROM "personal_keys" AS key
        WHERE key."family_id" = later."family_id" AND key."person_id" = later."person_id"
          AND key."kind" = 'reset' AND key."used_session_id" = later."id"
      )
  );
