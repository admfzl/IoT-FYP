import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: {
    grams_per_portion?: unknown;
    max_capacity_grams?: unknown;
    cooldown_seconds?: unknown;
    simulation_mode?: unknown;
  };
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

  if (body.grams_per_portion !== undefined) {
    const val = Number(body.grams_per_portion);
    if (!Number.isFinite(val) || val <= 0 || val > 500) {
      return NextResponse.json(
        { error: "grams_per_portion must be between 0.01 and 500." },
        { status: 400 }
      );
    }
    updates.grams_per_portion = Math.round(val * 100) / 100;
  }

  if (body.max_capacity_grams !== undefined) {
    const val = Number(body.max_capacity_grams);
    if (!Number.isFinite(val) || val <= 0 || val > 10000) {
      return NextResponse.json(
        { error: "max_capacity_grams must be between 1 and 10000." },
        { status: 400 }
      );
    }
    updates.max_capacity_grams = Math.round(val * 100) / 100;
  }

  if (body.cooldown_seconds !== undefined) {
    const val = Number(body.cooldown_seconds);
    if (!Number.isInteger(val) || val < 1 || val > 3600) {
      return NextResponse.json(
        { error: "cooldown_seconds must be an integer between 1 and 3600." },
        { status: 400 }
      );
    }
    updates.cooldown_seconds = val;
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

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Database configuration error on server."
      },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("feeder_state")
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
    feederState: data
  });
}

