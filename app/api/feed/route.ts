import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { executeFeed } from "@/lib/feed";
import type { TriggerSourceKey } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const SOURCE_ALIASES: Record<string, TriggerSourceKey> = {
  MANUAL: "MANUAL",
  MANUAL_APP: "MANUAL",
  SCHEDULE: "SCHEDULE",
  ESP32_SENSOR: "ESP32_SENSOR",
  PHONE_SENSOR: "PHONE_SENSOR"
};

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: {
    source?: unknown;
    portions?: unknown;
    vibrationG?: unknown;
    testLabel?: unknown;
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

  const rawSource = typeof body.source === "string" ? body.source.trim() : "";
  const source = SOURCE_ALIASES[rawSource];
  if (!source) {
    return NextResponse.json(
      {
        error:
          "Invalid source. Must be MANUAL, SCHEDULE, ESP32_SENSOR, or PHONE_SENSOR."
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
    vibrationG = parsedG;
  } else if (body.vibrationG !== undefined && body.vibrationG !== null) {
    const parsedG = Number(body.vibrationG);
    if (Number.isFinite(parsedG) && parsedG > 0) {
      vibrationG = parsedG;
    }
  }

  let portions: number | null = null;
  if (body.portions !== undefined && body.portions !== null) {
    const p = Number(body.portions);
    if (!Number.isInteger(p) || p < 1 || p > 20) {
      return NextResponse.json(
        { error: "portions must be an integer between 1 and 20." },
        { status: 400 }
      );
    }
    portions = p;
  }

  const labelRaw = body.testLabel ?? body.runLabel;
  const testLabel =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim().slice(0, 80)
      : null;

  const outcome = await executeFeed({
    source,
    portions,
    vibrationG,
    testLabel
  });

  return NextResponse.json(
    {
      ok: outcome.ok,
      success: outcome.ok,
      feedEventId: outcome.feedEventId,
      logId: outcome.feedEventId, // backwards compatibility alias
      result: outcome.result,
      dataOrigin: outcome.dataOrigin,
      portionsRequested: outcome.portionsRequested,
      portionsDispensed: outcome.portionsDispensed,
      remainingPortionsAfter: outcome.remainingPortionsAfter,
      capacityPortions: outcome.capacityPortions,
      serverTotalMs: outcome.serverTotalMs,
      tuyaApiMs: outcome.tuyaApiMs,
      tuyaEndpoint: outcome.tuyaEndpoint,
      fallbackReason: outcome.fallbackReason,
      tokenRefreshed: outcome.tokenRefreshed,
      retryAfterMs: outcome.retryAfterMs ?? null,
      error: outcome.error ?? null
    },
    { status: outcome.httpStatus }
  );
}
