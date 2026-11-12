import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: { logId?: unknown; clientRttMs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const logId = Number(body.logId);
  const rawRtt = Number(body.clientRttMs);

  if (!Number.isInteger(logId) || logId <= 0) {
    return NextResponse.json(
      { error: "logId must be a positive integer." },
      { status: 400 }
    );
  }

  if (!Number.isFinite(rawRtt) || rawRtt <= 0 || rawRtt >= 60000) {
    return NextResponse.json(
      { error: "clientRttMs must satisfy 0 < clientRttMs < 60000." },
      { status: 400 }
    );
  }

  const clientRttMs = Math.round(rawRtt);

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

  // Fetch row to verify client_rtt_ms is currently null and get server_total_ms
  const { data: existing, error: fetchError } = await supabase
    .from("feed_logs")
    .select("id, server_total_ms, client_rtt_ms")
    .eq("id", logId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: `Feed log ${logId} not found.` },
      { status: 404 }
    );
  }

  if (existing.client_rtt_ms !== null) {
    return NextResponse.json(
      { error: `client_rtt_ms was already recorded for logId ${logId}.` },
      { status: 409 }
    );
  }

  const networkMs =
    typeof existing.server_total_ms === "number"
      ? clientRttMs - existing.server_total_ms
      : null;

  const { data: updated, error: updateError } = await supabase
    .from("feed_logs")
    .update({
      client_rtt_ms: clientRttMs,
      network_ms: networkMs
    })
    .eq("id", logId)
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
    logId: updated.id,
    clientRttMs: updated.client_rtt_ms,
    serverTotalMs: updated.server_total_ms,
    networkMs: updated.network_ms
  });
}

