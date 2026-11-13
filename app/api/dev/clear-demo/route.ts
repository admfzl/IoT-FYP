import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const supabase = getSupabaseAdmin();

  const [{ data: deletedFeeds, error }, { data: deletedRefills }] =
    await Promise.all([
      supabase
        .from("feed_events")
        .delete()
        .eq("data_origin", "SEEDED")
        .select("id"),
      supabase
        .from("refill_events")
        .delete()
        .eq("data_origin", "SEEDED")
        .select("id")
    ]);

  if (error) {
    return NextResponse.json(
      { error: `Failed to clear demo data: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    deletedFeeds: deletedFeeds?.length ?? 0,
    deletedRefills: deletedRefills?.length ?? 0
  });
}

