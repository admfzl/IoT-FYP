import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: sources, error }, { data: settings }] = await Promise.all([
      supabase.from("trigger_sources").select("*").order("source"),
      supabase.from("feeder_settings").select("*").eq("id", 1).single()
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      sources: sources ?? [],
      settings: settings ?? null
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch trigger sources."
      },
      { status: 500 }
    );
  }
}

