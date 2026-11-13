import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseAdmin,
  type CalibrationRow,
  type FeederSettingsRow,
  type RefillEventRow
} from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const includeDemo = searchParams.get("includeDemo") === "true";

    let feedsQuery = supabase
      .from("feed_events")
      .select(
        "id, created_at, source, data_origin, portions_dispensed, remaining_portions_after, calibration_id"
      )
      .eq("result", "FED")
      .order("created_at", { ascending: true })
      .limit(1000);

    let refillsQuery = supabase
      .from("refill_events")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(200);

    if (!includeDemo) {
      feedsQuery = feedsQuery.eq("data_origin", "LIVE");
      refillsQuery = refillsQuery.eq("data_origin", "LIVE");
    }

    const [
      { data: settingsData },
      { data: feedsData },
      { data: refillsData },
      { data: calibrationsData }
    ] = await Promise.all([
      supabase.from("feeder_settings").select("*").eq("id", 1).single(),
      feedsQuery,
      refillsQuery,
      supabase
        .from("calibrations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50)
    ]);

    const settings = settingsData as FeederSettingsRow | null;
    const refills = (refillsData ?? []) as RefillEventRow[];
    const calibrations = (calibrationsData ?? []) as CalibrationRow[];
    const cap = Math.max(1, settings?.capacity_portions ?? 40);

    // Build combined timeline of step chart points and refill cycles
    const points: Array<{
      id: string;
      timestamp: string;
      portions: number;
      percent: number;
      kind: "feed" | "refill";
      detail: string;
      refillId?: number;
    }> = [];

    for (const r of refills) {
      // Point immediately before refill jump so step chart shows vertical rise
      const beforeTs = new Date(
        new Date(r.created_at).getTime() - 1
      ).toISOString();
      points.push({
        id: `refill-before-${r.id}`,
        timestamp: beforeTs,
        portions: r.portions_before,
        percent: Math.round((r.portions_before / cap) * 100),
        kind: "feed",
        detail: `Before refill #${r.id}`
      });
      points.push({
        id: `refill-${r.id}`,
        timestamp: r.created_at,
        portions: r.portions_after,
        percent: Math.round((r.portions_after / cap) * 100),
        kind: "refill",
        detail: `Refill: ${r.portions_before} -> ${r.portions_after} portions`,
        refillId: r.id
      });
    }

    for (const f of feedsData ?? []) {
      if (typeof f.remaining_portions_after === "number") {
        points.push({
          id: `feed-${f.id}`,
          timestamp: f.created_at,
          portions: f.remaining_portions_after,
          percent: Math.round((f.remaining_portions_after / cap) * 100),
          kind: "feed",
          detail: `Fed ${f.portions_dispensed ?? 1} portion(s)`
        });
      }
    }

    points.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (settings && points.length === 0) {
      points.push({
        id: "current",
        timestamp: new Date().toISOString(),
        portions: settings.remaining_portions,
        percent: Math.round((settings.remaining_portions / cap) * 100),
        kind: "feed",
        detail: "Current level"
      });
    }

    // Build refill cycles list for the cycle selector
    const sortedRefillsAsc = [...refills].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const cycles = sortedRefillsAsc.map((r, idx) => {
      const nextRefill = sortedRefillsAsc[idx + 1];
      return {
        refillId: r.id,
        startAt: r.created_at,
        endAt: nextRefill ? nextRefill.created_at : null,
        portionsAfter: r.portions_after,
        note: r.note
      };
    });

    return NextResponse.json({
      settings,
      points,
      refills: [...refills].reverse(),
      cycles,
      calibrations
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load hopper history."
      },
      { status: 500 }
    );
  }
}

