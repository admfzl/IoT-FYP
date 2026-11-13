import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isEmailConfigured, isTelegramConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");

    let query = supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (statusFilter === "active" || statusFilter === "resolved") {
      query = query.eq("status", statusFilter);
    }

    const [{ data: notifications, error }, { data: settings }] =
      await Promise.all([
        query,
        supabase.from("feeder_settings").select("*").eq("id", 1).single()
      ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      notifications: notifications ?? [],
      settings: settings ?? null,
      channelsConfigured: {
        telegram: isTelegramConfigured(),
        email: isEmailConfigured()
      }
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load notifications."
      },
      { status: 500 }
    );
  }
}

