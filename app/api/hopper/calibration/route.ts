import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: {
    gramsPerPortion?: unknown;
    sd?: unknown;
    sampleCount?: unknown;
    capacityPortions?: unknown;
    notes?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const gramsPerPortion = Number(body.gramsPerPortion);
  if (
    !Number.isFinite(gramsPerPortion) ||
    gramsPerPortion <= 0 ||
    gramsPerPortion > 100
  ) {
    return NextResponse.json(
      { error: "gramsPerPortion must be between 0.01 and 100." },
      { status: 400 }
    );
  }

  let sd: number | null = null;
  if (body.sd !== undefined && body.sd !== null && String(body.sd).trim() !== "") {
    const parsedSd = Number(body.sd);
    if (!Number.isFinite(parsedSd) || parsedSd < 0 || parsedSd > 50) {
      return NextResponse.json(
        { error: "sd must be a non-negative number." },
        { status: 400 }
      );
    }
    sd = Math.round(parsedSd * 1000) / 1000;
  }

  let sampleCount: number | null = null;
  if (
    body.sampleCount !== undefined &&
    body.sampleCount !== null &&
    String(body.sampleCount).trim() !== ""
  ) {
    const sc = Number(body.sampleCount);
    if (!Number.isInteger(sc) || sc < 1 || sc > 1000) {
      return NextResponse.json(
        { error: "sampleCount must be a positive integer." },
        { status: 400 }
      );
    }
    sampleCount = sc;
  }

  let capacityPortions: number | null = null;
  if (body.capacityPortions !== undefined && body.capacityPortions !== null) {
    const cap = Number(body.capacityPortions);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1000) {
      return NextResponse.json(
        { error: "capacityPortions must be an integer between 1 and 1000." },
        { status: 400 }
      );
    }
    capacityPortions = cap;
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 160)
      : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("apply_calibration", {
    p_grams_per_portion: Math.round(gramsPerPortion * 1000) / 1000,
    p_sd: sd,
    p_sample_count: sampleCount,
    p_capacity_portions: capacityPortions,
    p_notes: notes
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    calibration: data
  });
}

