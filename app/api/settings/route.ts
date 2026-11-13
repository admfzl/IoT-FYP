import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isTuyaConfigured } from "@/lib/tuya";
import { isEmailConfigured, isTelegramConfigured } from "@/lib/notify";
import { safeTimezone } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: settings }, { data: heartbeats }] = await Promise.all([
      supabase.from("feeder_settings").select("*").eq("id", 1).single(),
      supabase
        .from("device_heartbeats")
        .select("*")
        .order("last_seen_at", { ascending: false })
        .limit(1)
    ]);

    return NextResponse.json({
      settings: settings ?? null,
      tuyaConfigured: isTuyaConfigured(),
      tuyaDeviceId:
        process.env.TUYA_DEVICE_ID?.trim() || "a33d5216f7875b6d3er7kk",
      channelsConfigured: {
        telegram: isTelegramConfigured(),
        email: isEmailConfigured()
      },
      esp32Heartbeat: heartbeats?.[0] ?? null
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load settings."
      },
      { status: 500 }
    );
  }
}

async function handleUpdateSettings(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (body.capacity_portions !== undefined) {
    const v = Number(body.capacity_portions);
    if (!Number.isInteger(v) || v < 1 || v > 1000) {
      return NextResponse.json(
        { error: "capacity_portions must be between 1 and 1000." },
        { status: 400 }
      );
    }
    updates.capacity_portions = v;
  }

  if (body.low_food_threshold_percent !== undefined) {
    const v = Number(body.low_food_threshold_percent);
    if (!Number.isInteger(v) || v < 1 || v > 90) {
      return NextResponse.json(
        { error: "low_food_threshold_percent must be between 1 and 90." },
        { status: 400 }
      );
    }
    updates.low_food_threshold_percent = v;
  }

  if (body.daily_max_portions !== undefined) {
    const v = Number(body.daily_max_portions);
    if (!Number.isInteger(v) || v < 1 || v > 500) {
      return NextResponse.json(
        { error: "daily_max_portions must be between 1 and 500." },
        { status: 400 }
      );
    }
    updates.daily_max_portions = v;
  }

  if (body.quiet_hours_start !== undefined) {
    if (body.quiet_hours_start === null || body.quiet_hours_start === "") {
      updates.quiet_hours_start = null;
    } else if (
      typeof body.quiet_hours_start === "string" &&
      /^\d{2}:\d{2}(:\d{2})?$/.test(body.quiet_hours_start.trim())
    ) {
      updates.quiet_hours_start = body.quiet_hours_start.trim().slice(0, 5);
    } else {
      return NextResponse.json(
        { error: "quiet_hours_start must be HH:MM or null." },
        { status: 400 }
      );
    }
  }

  if (body.quiet_hours_end !== undefined) {
    if (body.quiet_hours_end === null || body.quiet_hours_end === "") {
      updates.quiet_hours_end = null;
    } else if (
      typeof body.quiet_hours_end === "string" &&
      /^\d{2}:\d{2}(:\d{2})?$/.test(body.quiet_hours_end.trim())
    ) {
      updates.quiet_hours_end = body.quiet_hours_end.trim().slice(0, 5);
    } else {
      return NextResponse.json(
        { error: "quiet_hours_end must be HH:MM or null." },
        { status: 400 }
      );
    }
  }

  if (body.skip_when_empty !== undefined) {
    if (typeof body.skip_when_empty !== "boolean") {
      return NextResponse.json(
        { error: "skip_when_empty must be a boolean." },
        { status: 400 }
      );
    }
    updates.skip_when_empty = body.skip_when_empty;
  }

  if (body.simulation_mode !== undefined) {
    if (typeof body.simulation_mode !== "boolean") {
      return NextResponse.json(
        { error: "simulation_mode must be a boolean." },
        { status: 400 }
      );
    }
    updates.simulation_mode = body.simulation_mode;
  }

  if (body.timezone !== undefined && typeof body.timezone === "string") {
    updates.timezone = safeTimezone(body.timezone.trim());
  }

  if (body.esp32_offline_minutes !== undefined) {
    const v = Number(body.esp32_offline_minutes);
    if (!Number.isInteger(v) || v < 1 || v > 1440) {
      return NextResponse.json(
        { error: "esp32_offline_minutes must be between 1 and 1440." },
        { status: 400 }
      );
    }
    updates.esp32_offline_minutes = v;
  }

  if (body.sensor_retention_days !== undefined) {
    const v = Number(body.sensor_retention_days);
    if (!Number.isInteger(v) || v < 1 || v > 365) {
      return NextResponse.json(
        { error: "sensor_retention_days must be between 1 and 365." },
        { status: 400 }
      );
    }
    updates.sensor_retention_days = v;
  }

  if (typeof body.notify_browser === "boolean") {
    updates.notify_browser = body.notify_browser;
  }
  if (typeof body.notify_telegram === "boolean") {
    updates.notify_telegram = body.notify_telegram;
  }
  if (typeof body.notify_email === "boolean") {
    updates.notify_email = body.notify_email;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("feeder_settings")
    .update(updates)
    .eq("id", 1)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: `Failed to update settings: ${error?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    settings: data
  });
}

export async function PUT(req: NextRequest) {
  return handleUpdateSettings(req);
}

export async function POST(req: NextRequest) {
  return handleUpdateSettings(req);
}
