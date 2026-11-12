import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

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

  const { data, error } = await supabase.rpc("refill_hopper");

  if (error || !data) {
    return NextResponse.json(
      { error: `Failed to refill hopper: ${error?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  const state = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    feederState: state
  });
}

