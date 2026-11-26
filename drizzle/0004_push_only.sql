ALTER TYPE public.message_channel RENAME TO message_channel_old;
--> statement-breakpoint
CREATE TYPE public.message_channel AS ENUM('push');
--> statement-breakpoint
ALTER TABLE public.outbox ALTER COLUMN channel TYPE public.message_channel USING channel::text::public.message_channel;
--> statement-breakpoint
DROP TYPE public.message_channel_old;
