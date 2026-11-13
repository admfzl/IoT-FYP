import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import {
  getEsp32TelemetryState,
  recordEsp32Telemetry
} from "@/lib/esp32-telemetry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getEsp32TelemetryState());
}

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const x = Number(body.x ?? 0);
  const y = Number(body.y ?? 0);
  const z = Number(body.z ?? 0);
  const dynamicG = Number(body.dynamicG ?? 0);
  const rawTotalG = Number(body.rawTotalG ?? 0);
  const thresholdG = Number(body.thresholdG ?? 0.3);
  const sequence = Number(body.sequence ?? 0);
  const sensorErrors = Number(body.sensorErrors ?? 0);
  const espIp = typeof body.espIp === "string" ? body.espIp.slice(0, 64) : "";
  const rssi = Number(body.rssi ?? 0);
  const autoTrigger = Boolean(body.autoTrigger ?? true);
  const runLabel =
    typeof body.runLabel === "string" ? body.runLabel.slice(0, 80) : "esp32-wifi";
  const lastTriggerStatus =
    typeof body.lastTriggerStatus === "string"
      ? body.lastTriggerStatus.slice(0, 120)
      : "Idle";
  const lastTriggerRttMs =
    body.lastTriggerRttMs !== null &&
    body.lastTriggerRttMs !== undefined &&
    Number.isFinite(Number(body.lastTriggerRttMs)) &&
    Number(body.lastTriggerRttMs) > 0
      ? Math.round(Number(body.lastTriggerRttMs))
      : null;

  const saved = recordEsp32Telemetry({
    x: Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0,
    y: Number.isFinite(y) ? Math.round(y * 10000) / 10000 : 0,
    z: Number.isFinite(z) ? Math.round(z * 10000) / 10000 : 0,
    dynamicG: Number.isFinite(dynamicG)
      ? Math.round(dynamicG * 1000) / 1000
      : 0,
    rawTotalG: Number.isFinite(rawTotalG)
      ? Math.round(rawTotalG * 1000) / 1000
      : 0,
    thresholdG: Number.isFinite(thresholdG)
      ? Math.round(thresholdG * 1000) / 1000
      : 0.3,
    sequence: Number.isFinite(sequence) ? Math.round(sequence) : 0,
    sensorErrors: Number.isFinite(sensorErrors) ? Math.round(sensorErrors) : 0,
    espIp,
    rssi: Number.isFinite(rssi) ? Math.round(rssi) : 0,
    autoTrigger,
    runLabel,
    lastTriggerStatus,
    lastTriggerRttMs
  });

  return NextResponse.json({
    ok: true,
    receivedAtMs: saved.receivedAtMs
  });
}

