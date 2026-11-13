import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const { id } = await context.params;
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  if (id === "all") {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: nowIso })
      .is("read_at", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const notifId = Number(id);
  if (!Number.isInteger(notifId) || notifId <= 0) {
    return NextResponse.json(
      { error: "Invalid notification ID." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("id", notifId)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to mark notification as read." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, notification: data });
}

