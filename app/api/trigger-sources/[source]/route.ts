import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import {
  getSupabaseAdmin,
  type TriggerSourceKey
} from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const VALID_SOURCES: TriggerSourceKey[] = [
  "MANUAL",
  "SCHEDULE",
  "ESP32_SENSOR",
  "PHONE_SENSOR"
];

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ source: string }> }
) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const { source: rawSource } = await context.params;
  const source = rawSource.toUpperCase() as TriggerSourceKey;
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: "Unknown trigger source." },
      { status: 400 }
    );
  }

  let body: {
    enabled?: unknown;
    portions_per_trigger?: unknown;
    cooldown_seconds?: unknown;
    threshold_g?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean." },
        { status: 400 }
      );
    }
    updates.enabled = body.enabled;
  }

  if (body.portions_per_trigger !== undefined) {
    const p = Number(body.portions_per_trigger);
    if (!Number.isInteger(p) || p < 1 || p > 20) {
      return NextResponse.json(
        { error: "portions_per_trigger must be an integer between 1 and 20." },
        { status: 400 }
      );
    }
    updates.portions_per_trigger = p;
  }

  if (body.cooldown_seconds !== undefined) {
    const c = Number(body.cooldown_seconds);
    if (!Number.isInteger(c) || c < 0 || c > 86_400) {
      return NextResponse.json(
        { error: "cooldown_seconds must be an integer between 0 and 86400." },
        { status: 400 }
      );
    }
    updates.cooldown_seconds = c;
  }

  if (
    body.threshold_g !== undefined &&
    (source === "ESP32_SENSOR" || source === "PHONE_SENSOR")
  ) {
    if (body.threshold_g === null) {
      updates.threshold_g = 0.3;
    } else {
      const t = Number(body.threshold_g);
      if (!Number.isFinite(t) || t <= 0 || t > 16) {
        return NextResponse.json(
          { error: "threshold_g must be between 0.01 and 16." },
          { status: 400 }
        );
      }
      updates.threshold_g = Math.round(t * 1000) / 1000;
    }
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trigger_sources")
    .update(updates)
    .eq("source", source)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update trigger source." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, source: data });
}

