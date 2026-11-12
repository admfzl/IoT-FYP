import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import {
  getSupabaseAdmin,
  type DataOrigin,
  type FeedSource,
  type ReservePortionResult,
  type FeederState
} from "@/lib/supabase";
import { feedOnce, isTuyaConfigured } from "@/lib/tuya";

const VALID_SOURCES: FeedSource[] = [
  "MANUAL_APP",
  "PHONE_SENSOR",
  "ESP32_SENSOR"
];

export async function POST(req: NextRequest) {
  const start = Date.now();

  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: {
    source?: unknown;
    vibrationG?: unknown;
    runLabel?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const source = body.source as FeedSource;
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      {
        error:
          "Invalid source. Must be MANUAL_APP, PHONE_SENSOR, or ESP32_SENSOR."
      },
      { status: 400 }
    );
  }

  let vibrationG: number | null = null;
  if (source === "PHONE_SENSOR" || source === "ESP32_SENSOR") {
    const parsedG = Number(body.vibrationG);
    if (!Number.isFinite(parsedG) || parsedG <= 0) {
      return NextResponse.json(
        {
          error:
            "vibrationG (positive number) is required for PHONE_SENSOR and ESP32_SENSOR triggers."
        },
        { status: 400 }
      );
    }
    vibrationG = Math.round(parsedG * 1000) / 1000;
  } else if (body.vibrationG !== undefined && body.vibrationG !== null) {
    const parsedG = Number(body.vibrationG);
    if (Number.isFinite(parsedG) && parsedG > 0) {
      vibrationG = Math.round(parsedG * 1000) / 1000;
    }
  }

  const runLabel =
    typeof body.runLabel === "string" && body.runLabel.trim().length > 0
      ? body.runLabel.trim().slice(0, 80)
      : null;

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

  // 1. Atomic reserve_portion() with row lock & server-side cooldown check
  const { data: reserveData, error: reserveError } = await supabase.rpc(
    "reserve_portion"
  );

  if (reserveError || !reserveData) {
    return NextResponse.json(
      {
        error: `Database reserve_portion failed: ${reserveError?.message ?? "No data returned"}`
      },
      { status: 500 }
    );
  }

  const reserved: ReservePortionResult = Array.isArray(reserveData)
    ? reserveData[0]
    : reserveData;

  if (reserved.cooldown) {
    return NextResponse.json(
      {
        error: "cooldown",
        message: `Feeder is in cooldown. Try again in ${reserved.retry_after_ms} ms.`,
        retryAfterMs: Number(reserved.retry_after_ms)
      },
      { status: 429 }
    );
  }

  const simulationMode = Boolean(reserved.simulation_mode);
  let remainingGrams = Number(reserved.remaining_grams);
  const maxCapacityGrams = Number(reserved.max_capacity_grams) || 60.0;
  let remainingPercent =
    Math.round((remainingGrams / maxCapacityGrams) * 1000) / 10;

  let dataOrigin: DataOrigin = simulationMode ? "SIMULATED" : "LIVE";
  let tuyaEndpoint: string | null = null;
  let tokenRefreshed = false;
  let tuyaApiMs: number | null = null;
  let tuyaSuccess = true;
  let tuyaError: string | null = null;

  if (simulationMode) {
    // §8: If simulation_mode -> skip Tuya, data_origin='SIMULATED', tuya_api_ms = null
    dataOrigin = "SIMULATED";
    tuyaApiMs = null;
    tuyaEndpoint = null;
    tokenRefreshed = false;
    tuyaSuccess = true;
    tuyaError = null;
  } else {
    // LIVE mode
    if (!isTuyaConfigured()) {
      await supabase.rpc("refund_portion");
      return NextResponse.json(
        {
          error:
            "Tuya Cloud credentials are not configured on the server and simulation_mode is OFF."
        },
        { status: 503 }
      );
    }

    const tuyaResult = await feedOnce();
    tuyaEndpoint = tuyaResult.endpoint;
    tuyaApiMs = tuyaResult.tuyaApiMs;
    tokenRefreshed = tuyaResult.tokenRefreshed;
    tuyaSuccess = tuyaResult.success;
    tuyaError = tuyaResult.error ?? null;

    if (!tuyaResult.success) {
      // Refund the reserved portion on failure
      const { data: refundedData } = await supabase.rpc("refund_portion");
      const refunded = (
        Array.isArray(refundedData) ? refundedData[0] : refundedData
      ) as FeederState | null;
      if (refunded && refunded.remaining_grams !== undefined) {
        remainingGrams = Number(refunded.remaining_grams);
        remainingPercent =
          Math.round((remainingGrams / maxCapacityGrams) * 1000) / 10;
      }
    }
  }

  // Insert feed_logs row
  const { data: insertedLog, error: insertError } = await supabase
    .from("feed_logs")
    .insert({
      source,
      data_origin: dataOrigin,
      run_label: runLabel,
      vibration_g: vibrationG,
      tuya_endpoint: tuyaEndpoint,
      token_refreshed: tokenRefreshed,
      tuya_api_ms: tuyaApiMs,
      tuya_success: tuyaSuccess,
      tuya_error: tuyaError,
      remaining_grams: remainingGrams,
      remaining_percent: remainingPercent
    })
    .select("id")
    .single();

  if (insertError || !insertedLog) {
    return NextResponse.json(
      {
        error: `Failed to insert feed_logs row: ${insertError?.message ?? "unknown"}`
      },
      { status: 500 }
    );
  }

  const logId = Number(insertedLog.id);
  const serverTotalMs = Date.now() - start;

  // Record server_total_ms just before responding
  await supabase
    .from("feed_logs")
    .update({ server_total_ms: serverTotalMs })
    .eq("id", logId);

  if (!tuyaSuccess) {
    return NextResponse.json(
      {
        logId,
        success: false,
        error: tuyaError ?? "Tuya Cloud command failed",
        dataOrigin,
        serverTotalMs,
        tuyaApiMs,
        tokenRefreshed,
        remainingGrams,
        remainingPercent
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    logId,
    success: true,
    dataOrigin,
    serverTotalMs,
    tuyaApiMs,
    tokenRefreshed,
    remainingGrams,
    remainingPercent
  });
}

