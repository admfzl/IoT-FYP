import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const source = searchParams.get("source");
    const label = searchParams.get("label");
    const includeDemo = searchParams.get("includeDemo") === "true";
    const limit = Math.min(
      500,
      Math.max(1, Number(searchParams.get("limit") || 100))
    );
    const cursor = searchParams.get("cursor");

    let query = supabase
      .from("feed_events")
      .select("*")
      .neq("result", "PENDING")
      .order("id", { ascending: false })
      .limit(limit);

    if (!includeDemo) {
      query = query.eq("data_origin", "LIVE");
    }
    if (from) {
      query = query.gte("created_at", from);
    }
    if (to) {
      query = query.lte("created_at", to);
    }
    if (source && source !== "ALL") {
      query = query.eq("source", source);
    }
    if (label && label.trim().length > 0) {
      query = query.ilike("test_label", `%${label.trim()}%`);
    }
    if (cursor && Number.isInteger(Number(cursor))) {
      query = query.lt("id", Number(cursor));
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const events = data ?? [];
    const nextCursor =
      events.length === limit ? events[events.length - 1]?.id ?? null : null;

    return NextResponse.json({
      events,
      nextCursor
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to fetch feed events."
      },
      { status: 500 }
    );
  }
}

