import { NextResponse } from "next/server";
import {
  getSupabaseAdmin,
  type FeedEventRow,
  type FeedScheduleRow,
  type FeederSettingsRow,
  type NotificationRow,
  type RefillEventRow,
  type TriggerSourceRow
} from "@/lib/supabase-server";
import { getUpcomingScheduleRuns } from "@/lib/schedule";
import { getStartOfDayInTz } from "@/lib/time";
import { isTuyaConfigured } from "@/lib/tuya";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const [
      { data: settingsData },
      { data: sourcesData },
      { data: schedulesData },
      { data: alertsData },
      { data: recentFeedsData },
      { data: recentRefillsData },
      { data: heartbeatsData }
    ] = await Promise.all([
      supabase.from("feeder_settings").select("*").eq("id", 1).single(),
      supabase.from("trigger_sources").select("*").order("source"),
      supabase
        .from("feed_schedules")
        .select("*")
        .order("time_of_day", { ascending: true }),
      supabase
        .from("notifications")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("feed_events")
        .select("*")
        .eq("data_origin", "LIVE")
        .neq("result", "PENDING")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("refill_events")
        .select("*")
        .eq("data_origin", "LIVE")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("device_heartbeats")
        .select("*")
        .order("last_seen_at", { ascending: false })
        .limit(1)
    ]);

    const settings = settingsData as FeederSettingsRow | null;
    const sources = (sourcesData ?? []) as TriggerSourceRow[];
    const schedules = (schedulesData ?? []) as FeedScheduleRow[];
    const activeAlerts = (alertsData ?? []) as NotificationRow[];
    const recentFeeds = (recentFeedsData ?? []) as FeedEventRow[];
    const recentRefills = (recentRefillsData ?? []) as RefillEventRow[];
    const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";

    // Today's dispensed breakdown by source in configured timezone
    const startOfTodayUtc = getStartOfDayInTz(new Date(), tz).toISOString();
    const { data: todayEventsData } = await supabase
      .from("feed_events")
      .select("source, portions_dispensed, result")
      .neq("data_origin", "SEEDED")
      .eq("result", "FED")
      .gte("created_at", startOfTodayUtc);

    const todayBySource: Record<string, number> = {
      MANUAL: 0,
      SCHEDULE: 0,
      ESP32_SENSOR: 0,
      PHONE_SENSOR: 0
    };
    let todayTotalPortions = 0;
    for (const row of todayEventsData ?? []) {
      const p = Number(row.portions_dispensed ?? 0);
      todayTotalPortions += p;
      if (row.source && todayBySource[row.source] !== undefined) {
        todayBySource[row.source] += p;
      }
    }

    // Last 7 days hopper level points
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: weekFeeds }, { data: weekRefills }] = await Promise.all([
      supabase
        .from("feed_events")
        .select("id, created_at, remaining_portions_after, portions_dispensed, source")
        .neq("data_origin", "SEEDED")
        .eq("result", "FED")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: true })
        .limit(500),
      supabase
        .from("refill_events")
        .select("id, created_at, portions_before, portions_after")
        .neq("data_origin", "SEEDED")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: true })
        .limit(100)
    ]);

    const hopperPoints: Array<{
      timestamp: string;
      portions: number;
      percent: number;
      kind: "feed" | "refill";
    }> = [];
    const cap = Math.max(1, settings?.capacity_portions ?? 40);

    for (const f of weekFeeds ?? []) {
      if (typeof f.remaining_portions_after === "number") {
        hopperPoints.push({
          timestamp: f.created_at,
          portions: f.remaining_portions_after,
          percent: Math.round((f.remaining_portions_after / cap) * 100),
          kind: "feed"
        });
      }
    }
    for (const r of weekRefills ?? []) {
      hopperPoints.push({
        timestamp: r.created_at,
        portions: r.portions_after,
        percent: Math.round((r.portions_after / cap) * 100),
        kind: "refill"
      });
    }
    hopperPoints.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (settings && hopperPoints.length === 0) {
      hopperPoints.push({
        timestamp: new Date().toISOString(),
        portions: settings.remaining_portions,
        percent: Math.round((settings.remaining_portions / cap) * 100),
        kind: "feed"
      });
    }

    // Estimate days left at current schedule
    let scheduledDailyPortions = 0;
    for (const s of schedules) {
      if (s.enabled) {
        const daysCount = Array.isArray(s.days_of_week)
          ? s.days_of_week.length
          : 7;
        scheduledDailyPortions += (s.portions * daysCount) / 7;
      }
    }

    const estimatedDaysLeft =
      scheduledDailyPortions > 0 && settings
        ? Math.round((settings.remaining_portions / scheduledDailyPortions) * 10) /
          10
        : null;

    const upcomingRuns = getUpcomingScheduleRuns(schedules, new Date(), tz, 5);
    const lastFedEvent =
      recentFeeds.find((f) => f.result === "FED") ?? null;

    return NextResponse.json({
      settings,
      tuyaConfigured: isTuyaConfigured(),
      sources,
      schedules,
      upcomingRuns,
      activeAlerts,
      recentFeeds: recentFeeds.slice(0, 10),
      recentRefills: recentRefills.slice(0, 5),
      lastFedEvent,
      todayTotalPortions,
      todayBySource,
      estimatedDaysLeft,
      scheduledDailyPortions: Math.round(scheduledDailyPortions * 10) / 10,
      hopperPoints,
      esp32Heartbeat: heartbeatsData?.[0] ?? null
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load overview data."
      },
      { status: 500 }
    );
  }
}

