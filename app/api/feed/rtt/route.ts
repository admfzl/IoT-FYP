import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: {
    feedEventId?: unknown;
    logId?: unknown;
    clientRttMs?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const eventId = Number(body.feedEventId ?? body.logId);
  const rawRtt = Number(body.clientRttMs);

  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json(
      { error: "feedEventId must be a positive integer." },
      { status: 400 }
    );
  }

  if (!Number.isFinite(rawRtt) || rawRtt <= 0 || rawRtt >= 60_000) {
    return NextResponse.json(
      { error: "clientRttMs must satisfy 0 < clientRttMs < 60000." },
      { status: 400 }
    );
  }

  const clientRttMs = Math.round(rawRtt);
  const supabase = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await supabase
    .from("feed_events")
    .select("id, server_total_ms, client_rtt_ms")
    .eq("id", eventId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: `Feed event ${eventId} not found.` },
      { status: 404 }
    );
  }

  if (existing.client_rtt_ms !== null) {
    return NextResponse.json(
      { error: `client_rtt_ms was already recorded for feedEventId ${eventId}.` },
      { status: 409 }
    );
  }

  const networkMs =
    typeof existing.server_total_ms === "number"
      ? Math.max(0, clientRttMs - existing.server_total_ms)
      : null;

  const { data: updated, error: updateError } = await supabase
    .from("feed_events")
    .update({
      client_rtt_ms: clientRttMs,
      network_ms: networkMs
    })
    .eq("id", eventId)
    .is("client_rtt_ms", null)
    .select("id, client_rtt_ms, server_total_ms, network_ms")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      {
        error: `Failed to record RTT: ${updateError?.message ?? "Row already updated"}`
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    feedEventId: updated.id,
    logId: updated.id,
    clientRttMs: updated.client_rtt_ms,
    serverTotalMs: updated.server_total_ms,
    networkMs: updated.network_ms
  });
}
