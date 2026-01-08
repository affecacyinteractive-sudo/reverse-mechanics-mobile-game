CREATE TYPE "public"."action_school_code" AS ENUM('FP', 'FS', 'FI', 'FU', 'FPR', 'FA', 'SF', 'SE', 'SD', 'SS', 'SX', 'SRC');--> statement-breakpoint
CREATE TYPE "public"."card_domain" AS ENUM('SOFTWARE', 'STORY', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."card_kind" AS ENUM('ACTION', 'PROMPT', 'OUTPUT');--> statement-breakpoint
CREATE TYPE "public"."card_zone" AS ENUM('LIBRARY', 'GENERATED', 'WORKSHOP');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('card', 'deck', 'op');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('Commit_Deck', 'Commit_Card', 'Edit_Card', 'Create_Card', 'Delete_Card', 'Uncommit_Card', 'Move_Card', 'Move_Deck', 'Query_Action', 'Create_Prompt', 'Edit_Prompt');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"kind" "card_kind" NOT NULL,
	"zone" "card_zone" NOT NULL,
	"domain" "card_domain" DEFAULT 'NONE' NOT NULL,
	"canon_id" text,
	"school_code" "action_school_code",
	"school_name" text,
	"anchor" text NOT NULL,
	"body" text NOT NULL,
	"is_committed" boolean DEFAULT false NOT NULL,
	"is_immutable" boolean DEFAULT false NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_cards" (
	"deck_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"zone" "card_zone" NOT NULL,
	"title" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" "event_type" NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_zone_idx" ON "cards" USING btree ("zone");--> statement-breakpoint
CREATE INDEX "cards_kind_idx" ON "cards" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "cards_domain_idx" ON "cards" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "cards_canon_idx" ON "cards" USING btree ("canon_id");--> statement-breakpoint
CREATE INDEX "deck_cards_deck_pos_idx" ON "deck_cards" USING btree ("deck_id","position");--> statement-breakpoint
CREATE INDEX "deck_cards_deck_card_idx" ON "deck_cards" USING btree ("deck_id","card_id");--> statement-breakpoint
CREATE INDEX "decks_session_idx" ON "decks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "decks_zone_idx" ON "decks" USING btree ("zone");--> statement-breakpoint
CREATE INDEX "events_session_time_idx" ON "events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "events_entity_time_idx" ON "events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "events_type_time_idx" ON "events" USING btree ("type","created_at");