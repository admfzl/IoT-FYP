import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import {
  getSupabaseAdmin,
  type FeedScheduleRow,
  type FeederSettingsRow
} from "@/lib/supabase-server";
import { getUpcomingScheduleRuns } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: schedulesData }, { data: settingsData }, { data: runsData }] =
      await Promise.all([
        supabase
          .from("feed_schedules")
          .select("*")
          .order("time_of_day", { ascending: true }),
        supabase.from("feeder_settings").select("*").eq("id", 1).single(),
        supabase
          .from("feed_events")
          .select("*")
          .eq("source", "SCHEDULE")
          .neq("result", "PENDING")
          .order("created_at", { ascending: false })
          .limit(50)
      ]);

    const schedules = (schedulesData ?? []) as FeedScheduleRow[];
    const settings = settingsData as FeederSettingsRow | null;
    const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";
    const upcomingRuns = getUpcomingScheduleRuns(schedules, new Date(), tz, 5);

    return NextResponse.json({
      schedules,
      upcomingRuns,
      runHistory: runsData ?? [],
      settings
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load schedules."
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: {
    time_of_day?: unknown;
    days_of_week?: unknown;
    portions?: unknown;
    label?: unknown;
    enabled?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const timeRaw =
    typeof body.time_of_day === "string" ? body.time_of_day.trim() : "";
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(timeRaw)) {
    return NextResponse.json(
      { error: "time_of_day must be in HH:MM format." },
      { status: 400 }
    );
  }

  const daysRaw = Array.isArray(body.days_of_week)
    ? body.days_of_week.map(Number)
    : [0, 1, 2, 3, 4, 5, 6];
  const validDays = Array.from(
    new Set(daysRaw.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  ).sort((a, b) => a - b);

  if (validDays.length === 0) {
    return NextResponse.json(
      { error: "Select at least one day of the week (0 = Sunday … 6 = Saturday)." },
      { status: 400 }
    );
  }

  const portions = Number(body.portions ?? 1);
  if (!Number.isInteger(portions) || portions < 1 || portions > 20) {
    return NextResponse.json(
      { error: "portions must be an integer between 1 and 20." },
      { status: 400 }
    );
  }

  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim().slice(0, 60)
      : null;

  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("feed_schedules")
    .insert({
      time_of_day: timeRaw.slice(0, 5),
      days_of_week: validDays,
      portions,
      label,
      enabled
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create schedule." },
      { status: 500 }
    );
  }

  // Also ensure the SCHEDULE trigger source is enabled when user creates a schedule
  await supabase
    .from("trigger_sources")
    .update({ enabled: true, updated_at: new Date().toISOString() })
    .eq("source", "SCHEDULE");

  return NextResponse.json({ ok: true, schedule: data });
}

