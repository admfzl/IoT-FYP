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

  // Strictly delete ONLY rows where data_origin = 'SEEDED' (never touches LIVE rows or feeder_state)
  const { data, error } = await supabase
    .from("feed_logs")
    .delete()
    .eq("data_origin", "SEEDED")
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: `Failed to clear SEEDED rows: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    deletedCount: data?.length ?? 0
  });
}

