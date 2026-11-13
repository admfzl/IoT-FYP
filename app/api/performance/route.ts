import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseAdmin,
  type FeedEventRow
} from "@/lib/supabase-server";
import {
  computeClientLatencyBySource,
  computeScheduleServerStats
} from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const source = searchParams.get("source");
    const label = searchParams.get("label");
    const includeDemo = searchParams.get("includeDemo") === "true";

    let query = supabase
      .from("feed_events")
      .select("*")
      .neq("result", "PENDING")
      .order("created_at", { ascending: true })
      .limit(2000);

    if (!includeDemo) {
      query = query.eq("data_origin", "LIVE");
    }
    if (from) {
      query = query.gte("created_at", from);
    }
    if (to) {
      query = query.lte("created_at", to);
    }
    if (source && source !== "ALL") {
      query = query.eq("source", source);
    }
    if (label && label.trim().length > 0) {
      query = query.ilike("test_label", `%${label.trim()}%`);
    }

    const [{ data: eventsData, error }, { data: settings }] = await Promise.all(
      [
        query,
        supabase
          .from("feeder_settings")
          .select("timezone, simulation_mode")
          .eq("id", 1)
          .single()
      ]
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const events = (eventsData ?? []) as FeedEventRow[];
    const summaryBySource = computeClientLatencyBySource(events);
    const scheduleStats = computeScheduleServerStats(events);

    // Distinct test labels for filter dropdown
    const { data: labelRows } = await supabase
      .from("feed_events")
      .select("test_label")
      .not("test_label", "is", null)
      .limit(200);

    const distinctLabels = Array.from(
      new Set(
        (labelRows ?? [])
          .map((r) => r.test_label)
          .filter((l): l is string => typeof l === "string" && l.length > 0)
      )
    ).sort();

    return NextResponse.json({
      events,
      summaryBySource,
      scheduleStats,
      distinctLabels,
      timezone: settings?.timezone ?? "Asia/Kuala_Lumpur"
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load performance data."
      },
      { status: 500 }
    );
  }
}

