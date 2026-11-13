import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: {
    portionsAfter?: unknown;
    gramsMeasured?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabase = getSupabaseAdmin();
  const { data: settings } = await supabase
    .from("feeder_settings")
    .select("capacity_portions")
    .eq("id", 1)
    .single();

  const capacity = settings?.capacity_portions ?? 40;
  const portionsAfter =
    body.portionsAfter !== undefined && body.portionsAfter !== null
      ? Number(body.portionsAfter)
      : capacity;

  if (
    !Number.isInteger(portionsAfter) ||
    portionsAfter < 1 ||
    portionsAfter > capacity
  ) {
    return NextResponse.json(
      {
        error: `portionsAfter must be an integer between 1 and ${capacity}.`
      },
      { status: 400 }
    );
  }

  let gramsMeasured: number | null = null;
  if (
    body.gramsMeasured !== undefined &&
    body.gramsMeasured !== null &&
    String(body.gramsMeasured).trim() !== ""
  ) {
    const g = Number(body.gramsMeasured);
    if (!Number.isFinite(g) || g <= 0 || g > 10_000) {
      return NextResponse.json(
        { error: "gramsMeasured must be a positive number." },
        { status: 400 }
      );
    }
    gramsMeasured = Math.round(g * 100) / 100;
  }

  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 120)
      : null;

  const { data, error } = await supabase.rpc("refill_hopper", {
    p_portions_after: portionsAfter,
    p_grams_measured: gramsMeasured,
    p_note: note
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    refill: data
  });
}

