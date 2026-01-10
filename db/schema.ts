// src/db/schema.ts (only showing the parts that change)
import {
    pgTable,
    pgEnum,
    uuid,
    text,
    timestamp,
    boolean,
    integer,
    jsonb,
    index,
} from "drizzle-orm/pg-core";


export const eventType = pgEnum("event_type", [
    "Commit_Deck",
    "Commit_Card",
    "Edit_Card",
    "Create_Card",
    "Delete_Card",
    "Uncommit_Card",
    "Move_Card",
    "Move_Deck",
    "Query_Action",
    "Create_Prompt",
    "Edit_Prompt",
]);

export const entityType = pgEnum("entity_type", ["card", "deck", "op"]);

export const sessions = pgTable("sessions", {
    id: uuid("id").defaultRandom().primaryKey(), // uuid defaultRandom is supported by Drizzle pg-core :contentReference[oaicite:2]{index=2}
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cardKind = pgEnum("card_kind", ["ACTION", "PROMPT", "OUTPUT"]);
export const cardZone = pgEnum("card_zone", ["LIBRARY", "GENERATED", "WORKSHOP"]);

// domain = which deck it belongs to (Actions) OR which domain the content is tagged as (others)
export const cardDomain = pgEnum("card_domain", ["SOFTWARE", "STORY", "NONE"]);

// only meaningful for ACTION cards
export const actionSchoolCode = pgEnum("action_school_code", [
    "FP", "FS", "FI", "FU", "FPR", "FA",
    "SF", "SE", "SD", "SS", "SX", "SRC",
]);

export const cards = pgTable(
    "cards",
    {
        id: uuid("id").defaultRandom().primaryKey(),

        // nullable for global library cards (Actions live outside a session)
        sessionId: uuid("session_id"),

        kind: cardKind("kind").notNull(),
        zone: cardZone("zone").notNull(),

        // general-purpose classification
        domain: cardDomain("domain").notNull().default("NONE"),

        // ACTION taxonomy (NULL for non-action cards)
        canonId: text("canon_id"),           // e.g. "FP-01" (unique for ACTIONS)
        schoolCode: actionSchoolCode("school_code"), // e.g. "FP"
        schoolName: text("school_name"),     // e.g. "Feature Planning"

        anchor: text("anchor").notNull(),
        body: text("body").notNull(),

        isDraft: boolean("is_draft").notNull().default(false),

        isCommitted: boolean("is_committed").notNull().default(false),

        // actions are immutable
        isImmutable: boolean("is_immutable").notNull().default(false),

        meta: jsonb("meta").notNull().default({}),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    },
    (t) => ({
        zoneIdx: index("cards_zone_idx").on(t.zone),
        kindIdx: index("cards_kind_idx").on(t.kind),
        domainIdx: index("cards_domain_idx").on(t.domain),

        // recommended: uniqueness for canon action ids
        canonIdx: index("cards_canon_idx").on(t.canonId),
    })
);

export const decks = pgTable(
    "decks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        sessionId: uuid("session_id").notNull().references(() => sessions.id),
        zone: cardZone("zone").notNull(),
        title: text("title").notNull(),
        meta: jsonb("meta").notNull().default({}),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull()
            .$onUpdate(() => new Date()),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => ({
        sessionIdx: index("decks_session_idx").on(t.sessionId),
        zoneIdx: index("decks_zone_idx").on(t.zone),
    })
);

export const deckCards = pgTable(
    "deck_cards",
    {
        deckId: uuid("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
        cardId: uuid("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
    },
    (t) => ({
        deckPosIdx: index("deck_cards_deck_pos_idx").on(t.deckId, t.position),
        deckCardIdx: index("deck_cards_deck_card_idx").on(t.deckId, t.cardId),
    })
);

export const events = pgTable(
    "events",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        sessionId: uuid("session_id").notNull().references(() => sessions.id),
        actorId: uuid("actor_id"), // v1: nullable (no auth yet). Can be NOT NULL once users exist.
        type: eventType("type").notNull(),

        entityType: entityType("entity_type").notNull(), // card | deck | op
        entityId: uuid("entity_id").notNull(), // cardId/deckId/opId

        payload: jsonb("payload").notNull().default({}),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        sessionTimeIdx: index("events_session_time_idx").on(t.sessionId, t.createdAt),
        entityTimeIdx: index("events_entity_time_idx").on(t.entityType, t.entityId, t.createdAt),
        typeTimeIdx: index("events_type_time_idx").on(t.type, t.createdAt),
    })
);