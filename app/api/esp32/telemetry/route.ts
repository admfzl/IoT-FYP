import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveAlert } from "@/lib/notify";

export const dynamic = "force-dynamic";

interface TelemetrySampleInput {
  offsetMs?: unknown;
  ax?: unknown;
  ay?: unknown;
  az?: unknown;
  gMean?: unknown;
  gPeak?: unknown;
}

/**
 * POST /api/esp32/telemetry (requires x-feed-token)
 * Accepts batched telemetry from ESP32:
 *   { deviceId, rssi, firmware, ip?, samples: [{ offsetMs, ax, ay, az, gMean, gPeak }, ...] }
 * Also supports legacy single-sample payloads from older firmware so transitions are seamless.
 * NEVER stores state in Worker memory; inserts directly into Postgres via `ingest_telemetry` RPC.
 */
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

  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.trim().length > 0
      ? body.deviceId.trim().slice(0, 64)
      : "esp32-s3-1";

  const rssiRaw = Number(body.rssi ?? -60);
  const rssi = Number.isFinite(rssiRaw) ? Math.round(rssiRaw) : -60;

  const firmware =
    typeof body.firmware === "string" && body.firmware.trim().length > 0
      ? body.firmware.trim().slice(0, 32)
      : "2.0.0";

  const ipRaw = body.ip ?? body.espIp;
  const ip =
    typeof ipRaw === "string" && ipRaw.trim().length > 0
      ? ipRaw.trim().slice(0, 64)
      : null;

  let sanitizedSamples: Array<{
    offsetMs: number;
    ax: number;
    ay: number;
    az: number;
    gMean: number;
    gPeak: number;
  }> = [];

  if (Array.isArray(body.samples) && body.samples.length > 0) {
    sanitizedSamples = (body.samples as TelemetrySampleInput[])
      .slice(0, 60)
      .map((s, idx) => {
        const offsetMs = Number(s.offsetMs ?? idx * 1000);
        const ax = Number(s.ax ?? 0);
        const ay = Number(s.ay ?? 0);
        const az = Number(s.az ?? 0);
        const gMean = Number(s.gMean ?? 0);
        const gPeak = Number(s.gPeak ?? gMean);
        return {
          offsetMs: Number.isFinite(offsetMs) ? Math.max(0, Math.round(offsetMs)) : 0,
          ax: Number.isFinite(ax) ? Math.round(ax * 10000) / 10000 : 0,
          ay: Number.isFinite(ay) ? Math.round(ay * 10000) / 10000 : 0,
          az: Number.isFinite(az) ? Math.round(az * 10000) / 10000 : 0,
          gMean: Number.isFinite(gMean)
            ? Math.max(0, Math.round(gMean * 10000) / 10000)
            : 0,
          gPeak: Number.isFinite(gPeak)
            ? Math.max(0, Math.round(gPeak * 10000) / 10000)
            : 0
        };
      });
  } else {
    // Backwards compatibility with legacy single-reading payload (`x, y, z, dynamicG`)
    const ax = Number(body.x ?? body.ax ?? 0);
    const ay = Number(body.y ?? body.ay ?? 0);
    const az = Number(body.z ?? body.az ?? 0);
    const dynG = Number(body.dynamicG ?? body.gMean ?? 0);
    const peakG = Number(body.gPeak ?? dynG);
    sanitizedSamples = [
      {
        offsetMs: 0,
        ax: Number.isFinite(ax) ? Math.round(ax * 10000) / 10000 : 0,
        ay: Number.isFinite(ay) ? Math.round(ay * 10000) / 10000 : 0,
        az: Number.isFinite(az) ? Math.round(az * 10000) / 10000 : 0,
        gMean: Number.isFinite(dynG)
          ? Math.max(0, Math.round(dynG * 10000) / 10000)
          : 0,
        gPeak: Number.isFinite(peakG)
          ? Math.max(0, Math.round(peakG * 10000) / 10000)
          : 0
      }
    ];
  }

  const supabase = getSupabaseAdmin();

  // If the user explicitly saved new threshold/cooldown on the ESP32 local web UI (`configUpdated: true`),
  // push those updates into `trigger_sources` for `ESP32_SENSOR`.
  if (body.configUpdated === true) {
    const sourcePatch: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };
    if (body.thresholdG !== undefined) {
      const t = Number(body.thresholdG);
      if (Number.isFinite(t) && t >= 0.01 && t <= 16) {
        sourcePatch.threshold_g = Math.round(t * 1000) / 1000;
      }
    }
    if (body.cooldownMs !== undefined) {
      const cdSec = Math.round(Number(body.cooldownMs) / 1000);
      if (Number.isInteger(cdSec) && cdSec >= 0 && cdSec <= 86_400) {
        sourcePatch.cooldown_seconds = cdSec;
      }
    }
    if (typeof body.autoTrigger === "boolean") {
      sourcePatch.enabled = body.autoTrigger;
    }
    if (Object.keys(sourcePatch).length > 1) {
      await supabase
        .from("trigger_sources")
        .update(sourcePatch)
        .eq("source", "ESP32_SENSOR");
    }
  }

  const [{ data, error }, { data: espSource }] = await Promise.all([
    supabase.rpc("ingest_telemetry", {
      p_device_id: deviceId,
      p_rssi: rssi,
      p_firmware: firmware,
      p_ip: ip,
      p_samples: sanitizedSamples
    }),
    supabase
      .from("trigger_sources")
      .select("enabled, threshold_g, cooldown_seconds, portions_per_trigger")
      .eq("source", "ESP32_SENSOR")
      .maybeSingle()
  ]);

  if (error) {
    return NextResponse.json(
      { error: `Failed to ingest telemetry: ${error.message}` },
      { status: 500 }
    );
  }

  // Resolve any active esp32_offline alert since we just received a live batch
  await resolveAlert("esp32_offline");

  const serverThresholdG = Number(espSource?.threshold_g ?? 0.3);
  const serverCooldownSec = Number(espSource?.cooldown_seconds ?? 5);

  return NextResponse.json({
    ok: true,
    ...((data as Record<string, unknown>) ?? {}),
    enabled: Boolean(espSource?.enabled ?? false),
    thresholdG: serverThresholdG,
    cooldownSeconds: serverCooldownSec,
    cooldownMs: serverCooldownSec * 1000,
    portionsPerTrigger: Number(espSource?.portions_per_trigger ?? 1)
  });
}
