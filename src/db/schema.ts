import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  primaryKey,
  boolean,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums
export const userRoleEnum = pgEnum("user_role", ["admin", "editor"]);
export const assetTypeEnum = pgEnum("asset_type", ["pdf", "video", "article", "image"]);
export const layoutEnum = pgEnum("layout", ["binge", "hub", "single"]);
export const trackStatusEnum = pgEnum("track_status", ["draft", "published"]);
export const formPositionEnum = pgEnum("form_position", ["gate", "after_asset_n", "exit_intent"]);
export const abmMatchSourceEnum = pgEnum("abm_match_source", ["email_domain", "reverse_ip", "fuzzy"]);
export const abmConfidenceEnum = pgEnum("abm_confidence", ["high", "medium", "low"]);
export const eventTypeEnum = pgEnum("event_type", [
  "view",
  "scroll_25",
  "scroll_50",
  "scroll_75",
  "scroll_100",
  "video_play",
  "video_pause",
  "video_complete",
  "click",
  "dwell_tick",
]);

// Organization (Tenant)
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User (Org member)
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // Tied to auth.users.id
  email: text("email").notNull().unique(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  role: userRoleEnum("role").default("editor").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Asset
export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  type: assetTypeEnum("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  sourceUrl: text("source_url"),
  fileUrl: text("file_url"),
  durationSeconds: integer("duration_seconds"),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Track
export const tracks = pgTable("tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  layout: layoutEnum("layout").default("binge").notNull(),
  themeJson: jsonb("theme_json"),
  gateConfigJson: jsonb("gate_config_json"),
  status: trackStatusEnum("status").default("draft").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    orgSlugUnique: uniqueIndex("org_slug_idx").on(table.organizationId, table.slug),
  };
});

// TrackAsset (Join Table)
export const trackAssets = pgTable("track_assets", {
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }).notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  position: integer("position").notNull(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.trackId, table.assetId] }),
  };
});

// FormConfig
export const formConfigs = pgTable("form_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }).notNull(),
  fields: jsonb("fields").notNull(), // array of fields
  position: formPositionEnum("position").notNull(),
  requiredFields: jsonb("required_fields").notNull(), // array of required field names
  triggerRule: jsonb("trigger_rule"), // logic for triggering
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Visitor
export const visitors = pgTable("visitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  fingerprintId: text("fingerprint_id").notNull().unique(),
  capturedEmail: text("captured_email"),
  utmJson: jsonb("utm_json"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

// Session
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitorId: uuid("visitor_id").references(() => visitors.id, { onDelete: "cascade" }).notNull(),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }).notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  deviceJson: jsonb("device_json"),
  referrer: text("referrer"),
});

// Engagement
export const engagements = pgTable("engagements", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  eventType: eventTypeEnum("event_type").notNull(),
  payloadJson: jsonb("payload_json"),
  ts: timestamp("ts").defaultNow().notNull(),
});

// Lead
export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitorId: uuid("visitor_id").references(() => visitors.id, { onDelete: "cascade" }).notNull(),
  email: text("email").notNull(),
  formResponsesJson: jsonb("form_responses_json"),
  score: integer("score").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Webhook
export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").notNull(), // array of event names to listen to
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const abmAccounts = pgTable("abm_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  accountName: text("account_name").notNull(),
  priority: text("priority").default("medium").notNull(),
  ownerEmail: text("owner_email"),
  notes: text("notes"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const abmAccountDomains = pgTable("abm_account_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  abmAccountId: uuid("abm_account_id").references(() => abmAccounts.id, { onDelete: "cascade" }).notNull(),
  domain: text("domain").notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const abmMatches = pgTable("abm_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  visitorId: uuid("visitor_id").references(() => visitors.id, { onDelete: "cascade" }).notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  abmAccountId: uuid("abm_account_id").references(() => abmAccounts.id, { onDelete: "cascade" }).notNull(),
  matchSource: abmMatchSourceEnum("match_source").notNull(),
  confidence: abmConfidenceEnum("confidence").notNull(),
  matchedValue: text("matched_value").notNull(),
  payloadJson: jsonb("payload_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const abmAlerts = pgTable("abm_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  abmAccountId: uuid("abm_account_id").references(() => abmAccounts.id, { onDelete: "cascade" }).notNull(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  visitorId: uuid("visitor_id").references(() => visitors.id, { onDelete: "set null" }),
  triggerType: text("trigger_type").notNull(),
  recipientsJson: jsonb("recipients_json").notNull(),
  payloadJson: jsonb("payload_json"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});
