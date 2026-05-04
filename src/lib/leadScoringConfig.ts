import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadScoringConfigs } from '@/db/schema'

export type LeadScoringWeights = {
  uniqueAssetViewPoints: number
  dwellTickPoints: number
  deepScrollPoints: number
  videoPlayPoints: number
  videoCompletePoints: number
  returnSessionPoints: number
}

export const DEFAULT_LEAD_SCORING: LeadScoringWeights = {
  uniqueAssetViewPoints: 5,
  dwellTickPoints: 2,
  deepScrollPoints: 3,
  videoPlayPoints: 5,
  videoCompletePoints: 10,
  returnSessionPoints: 20,
}

let bootstrapAttempted = false

export async function ensureLeadScoringSchema(): Promise<boolean> {
  if (bootstrapAttempted) {
    try {
      await db.select({ id: leadScoringConfigs.id }).from(leadScoringConfigs).limit(1)
      return true
    } catch {
      return false
    }
  }
  bootstrapAttempted = true

  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "lead_scoring_configs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL UNIQUE,
        "unique_asset_view_points" integer DEFAULT 5 NOT NULL,
        "dwell_tick_points" integer DEFAULT 2 NOT NULL,
        "deep_scroll_points" integer DEFAULT 3 NOT NULL,
        "video_play_points" integer DEFAULT 5 NOT NULL,
        "video_complete_points" integer DEFAULT 10 NOT NULL,
        "return_session_points" integer DEFAULT 20 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `))
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'lead_scoring_configs_organization_id_organizations_id_fk'
        ) THEN
          ALTER TABLE "lead_scoring_configs"
          ADD CONSTRAINT "lead_scoring_configs_organization_id_organizations_id_fk"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `))
    await db.select({ id: leadScoringConfigs.id }).from(leadScoringConfigs).limit(1)
    return true
  } catch {
    return false
  }
}

function clampNonNegative(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

export async function getLeadScoringWeightsForOrg(orgId: string): Promise<LeadScoringWeights> {
  const ready = await ensureLeadScoringSchema()
  if (!ready) return DEFAULT_LEAD_SCORING
  try {
    const [row] = await db.select().from(leadScoringConfigs).where(eq(leadScoringConfigs.organizationId, orgId))
    if (!row) return DEFAULT_LEAD_SCORING
    return {
      uniqueAssetViewPoints: clampNonNegative(row.uniqueAssetViewPoints, DEFAULT_LEAD_SCORING.uniqueAssetViewPoints),
      dwellTickPoints: clampNonNegative(row.dwellTickPoints, DEFAULT_LEAD_SCORING.dwellTickPoints),
      deepScrollPoints: clampNonNegative(row.deepScrollPoints, DEFAULT_LEAD_SCORING.deepScrollPoints),
      videoPlayPoints: clampNonNegative(row.videoPlayPoints, DEFAULT_LEAD_SCORING.videoPlayPoints),
      videoCompletePoints: clampNonNegative(row.videoCompletePoints, DEFAULT_LEAD_SCORING.videoCompletePoints),
      returnSessionPoints: clampNonNegative(row.returnSessionPoints, DEFAULT_LEAD_SCORING.returnSessionPoints),
    }
  } catch {
    return DEFAULT_LEAD_SCORING
  }
}

export async function upsertLeadScoringWeightsForOrg(orgId: string, input: Partial<LeadScoringWeights>) {
  const ready = await ensureLeadScoringSchema()
  if (!ready) return

  const current = await getLeadScoringWeightsForOrg(orgId)
  const next: LeadScoringWeights = {
    uniqueAssetViewPoints: clampNonNegative(input.uniqueAssetViewPoints ?? current.uniqueAssetViewPoints, current.uniqueAssetViewPoints),
    dwellTickPoints: clampNonNegative(input.dwellTickPoints ?? current.dwellTickPoints, current.dwellTickPoints),
    deepScrollPoints: clampNonNegative(input.deepScrollPoints ?? current.deepScrollPoints, current.deepScrollPoints),
    videoPlayPoints: clampNonNegative(input.videoPlayPoints ?? current.videoPlayPoints, current.videoPlayPoints),
    videoCompletePoints: clampNonNegative(input.videoCompletePoints ?? current.videoCompletePoints, current.videoCompletePoints),
    returnSessionPoints: clampNonNegative(input.returnSessionPoints ?? current.returnSessionPoints, current.returnSessionPoints),
  }

  const [existing] = await db.select({ id: leadScoringConfigs.id })
    .from(leadScoringConfigs)
    .where(eq(leadScoringConfigs.organizationId, orgId))

  if (existing) {
    await db.update(leadScoringConfigs).set({
      ...next,
      updatedAt: new Date(),
    }).where(and(eq(leadScoringConfigs.id, existing.id), eq(leadScoringConfigs.organizationId, orgId)))
  } else {
    await db.insert(leadScoringConfigs).values({
      organizationId: orgId,
      ...next,
    })
  }
}
