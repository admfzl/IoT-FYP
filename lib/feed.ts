import "server-only";
import {
  getSupabaseAdmin,
  type DataOrigin,
  type FeedResult,
  type ReserveFeedRpcResult,
  type TriggerSourceKey,
  type TuyaEndpoint
} from "./supabase-server";
import { feedPortions, isTuyaConfigured } from "./tuya";
import { evaluateHopperAlerts, raiseAlert } from "./notify";
import { isWithinQuietHours, safeTimezone } from "./time";

export interface ExecuteFeedParams {
  source: TriggerSourceKey;
  portions?: number | null;
  vibrationG?: number | null;
  testLabel?: string | null;
  scheduleId?: number | null;
  scheduledFor?: string | null;
  existingEventId?: number | null;
}

export interface ExecuteFeedResult {
  httpStatus: number;
  ok: boolean;
  feedEventId: number | null;
  result: FeedResult;
  dataOrigin: DataOrigin;
  portionsRequested: number;
  portionsDispensed: number;
  remainingPortionsAfter: number;
  capacityPortions: number;
  serverTotalMs: number;
  tuyaApiMs: number | null;
  tuyaEndpoint: TuyaEndpoint | null;
  fallbackReason: string | null;
  tokenRefreshed: boolean;
  retryAfterMs?: number | null;
  error?: string | null;
}

export async function executeFeed(
  params: ExecuteFeedParams
): Promise<ExecuteFeedResult> {
  const start = Date.now();
  const supabase = getSupabaseAdmin();

  const source = params.source;
  const requestedOverride =
    typeof params.portions === "number" &&
    Number.isFinite(params.portions) &&
    params.portions >= 1
      ? Math.min(20, Math.round(params.portions))
      : null;

  const vibrationG =
    typeof params.vibrationG === "number" &&
    Number.isFinite(params.vibrationG) &&
    params.vibrationG > 0
      ? Math.round(params.vibrationG * 1000) / 1000
      : null;

  const testLabel =
    typeof params.testLabel === "string" && params.testLabel.trim().length > 0
      ? params.testLabel.trim().slice(0, 80)
      : null;

  // Read settings first so we can check quiet hours in TypeScript in the configured timezone,
  // and know the Tuya manual_feed max value and low-food threshold.
  const { data: settings } = await supabase
    .from("feeder_settings")
    .select("*")
    .eq("id", 1)
    .single();

  const tz = safeTimezone(settings?.timezone);
  const now = new Date();

  // TypeScript quiet-hours check before reserve_feed (reserve_feed also enforces it atomically)
  if (
    (source === "ESP32_SENSOR" || source === "PHONE_SENSOR") &&
    settings &&
    isWithinQuietHours(now, settings.quiet_hours_start, settings.quiet_hours_end, tz)
  ) {
    // Delegate to reserve_feed so skip throttling and row locking are handled identically
  }

  const { data: reserveRaw, error: reserveErr } = await supabase.rpc(
    "reserve_feed",
    {
      p_source: source,
      p_portions: requestedOverride,
      p_now: now.toISOString()
    }
  );

  if (reserveErr || !reserveRaw) {
    const elapsed = Date.now() - start;
    return {
      httpStatus: 500,
      ok: false,
      feedEventId: params.existingEventId ?? null,
      result: "FAILED",
      dataOrigin: settings?.simulation_mode ? "SIMULATED" : "LIVE",
      portionsRequested: requestedOverride ?? 1,
      portionsDispensed: 0,
      remainingPortionsAfter: settings?.remaining_portions ?? 0,
      capacityPortions: settings?.capacity_portions ?? 40,
      serverTotalMs: elapsed,
      tuyaApiMs: null,
      tuyaEndpoint: null,
      fallbackReason: null,
      tokenRefreshed: false,
      error: `Database reserve_feed failed: ${reserveErr?.message ?? "No response"}`
    };
  }

  const reserved = reserveRaw as ReserveFeedRpcResult;
  const dataOrigin: DataOrigin = reserved.simulation_mode
    ? "SIMULATED"
    : "LIVE";

  // Handle skipped attempts (disabled, quiet hours, cooldown, daily limit, empty hopper)
  if (!reserved.ok) {
    const skipResult = (reserved.reason ?? "FAILED") as FeedResult;
    let eventId: number | null = params.existingEventId ?? null;
    const serverTotalMs = Date.now() - start;

    const skipReasonMsg = formatSkipMessage(skipResult, reserved);

    if (eventId) {
      await supabase
        .from("feed_events")
        .update({
          data_origin: dataOrigin,
          result: skipResult,
          portions_requested: reserved.portions_requested,
          portions_dispensed: 0,
          remaining_portions_after: reserved.remaining_after,
          calibration_id: reserved.calibration_id,
          test_label: testLabel,
          vibration_g: vibrationG,
          server_total_ms: serverTotalMs,
          error: skipReasonMsg
        })
        .eq("id", eventId);
    } else if (reserved.log_skip) {
      const { data: ins } = await supabase
        .from("feed_events")
        .insert({
          source,
          data_origin: dataOrigin,
          result: skipResult,
          portions_requested: reserved.portions_requested,
          portions_dispensed: 0,
          remaining_portions_after: reserved.remaining_after,
          calibration_id: reserved.calibration_id,
          schedule_id: params.scheduleId ?? null,
          scheduled_for: params.scheduledFor ?? null,
          test_label: testLabel,
          vibration_g: vibrationG,
          server_total_ms: serverTotalMs,
          error: skipReasonMsg
        })
        .select("id")
        .single();
      if (ins?.id) eventId = Number(ins.id);
    }

    // Alerts for daily limit or scheduled skip
    if (skipResult === "SKIPPED_DAILY_LIMIT") {
      await raiseAlert(
        "DAILY_LIMIT_REACHED",
        `Daily feeding limit reached (${reserved.daily_used_portions}/${reserved.daily_max_portions} portions today).`,
        `daily_limit_${now.toISOString().slice(0, 10)}`,
        "warning"
      );
    }
    if (source === "SCHEDULE") {
      await raiseAlert(
        "SCHEDULE_SKIPPED",
        `Scheduled feed skipped: ${skipReasonMsg}`,
        null,
        "warning"
      );
    }

    const httpStatus =
      skipResult === "SKIPPED_COOLDOWN"
        ? 429
        : skipResult === "SKIPPED_DISABLED"
          ? 409
          : 422;

    return {
      httpStatus,
      ok: false,
      feedEventId: eventId,
      result: skipResult,
      dataOrigin,
      portionsRequested: reserved.portions_requested,
      portionsDispensed: 0,
      remainingPortionsAfter: reserved.remaining_after,
      capacityPortions: reserved.capacity_portions,
      serverTotalMs,
      tuyaApiMs: null,
      tuyaEndpoint: null,
      fallbackReason: null,
      tokenRefreshed: false,
      retryAfterMs: reserved.retry_after_ms,
      error: skipReasonMsg
    };
  }

  // Reservation succeeded: execute Tuya (or simulation)
  const portionsToDispense = reserved.portions_reserved;
  let tuyaEndpoint: TuyaEndpoint | null = null;
  let fallbackReason: string | null = null;
  let tokenRefreshed = false;
  let tuyaApiMs: number | null = null;
  let tuyaSuccess = true;
  let tuyaError: string | null = null;
  let portionsDispensed = portionsToDispense;
  let remainingAfter = reserved.remaining_after;

  if (!reserved.simulation_mode) {
    if (!isTuyaConfigured()) {
      await supabase.rpc("refund_feed", {
        p_source: source,
        p_portions: reserved.portions_decremented,
        p_dispensed: portionsToDispense
      });
      const elapsed = Date.now() - start;
      return {
        httpStatus: 503,
        ok: false,
        feedEventId: params.existingEventId ?? null,
        result: "FAILED",
        dataOrigin: "LIVE",
        portionsRequested: reserved.portions_requested,
        portionsDispensed: 0,
        remainingPortionsAfter:
          reserved.remaining_after + reserved.portions_decremented,
        capacityPortions: reserved.capacity_portions,
        serverTotalMs: elapsed,
        tuyaApiMs: null,
        tuyaEndpoint: null,
        fallbackReason: null,
        tokenRefreshed: false,
        error:
          "Feeder Cloud credentials are not configured on the server and simulation mode is off."
      };
    }

    const maxPerCmd = settings?.tuya_manual_feed_max ?? 31;
    const tuyaRes = await feedPortions(portionsToDispense, maxPerCmd);
    tuyaEndpoint = tuyaRes.endpoint;
    fallbackReason = tuyaRes.fallbackReason;
    tuyaApiMs = tuyaRes.tuyaApiMs;
    tokenRefreshed = tuyaRes.tokenRefreshed;
    tuyaSuccess = tuyaRes.success;
    tuyaError = tuyaRes.error ?? null;
    portionsDispensed = tuyaRes.portionsSent;

    if (!tuyaRes.success) {
      const undispensed = Math.max(0, portionsToDispense - portionsDispensed);
      const refundHopper = Math.min(reserved.portions_decremented, undispensed);
      const { data: refData } = await supabase.rpc("refund_feed", {
        p_source: source,
        p_portions: refundHopper,
        p_dispensed: undispensed
      });
      if (refData && typeof refData.remaining_after === "number") {
        remainingAfter = refData.remaining_after;
      }
    }
  }

  const finalResult: FeedResult = tuyaSuccess ? "FED" : "FAILED";
  let feedEventId: number | null = params.existingEventId ?? null;

  if (feedEventId) {
    const serverTotalMs = Date.now() - start;
    await supabase
      .from("feed_events")
      .update({
        data_origin: dataOrigin,
        result: finalResult,
        portions_requested: reserved.portions_requested,
        portions_dispensed: portionsDispensed,
        remaining_portions_after: remainingAfter,
        calibration_id: reserved.calibration_id,
        test_label: testLabel,
        vibration_g: vibrationG,
        tuya_endpoint: tuyaEndpoint,
        fallback_reason: fallbackReason,
        token_refreshed: tokenRefreshed,
        tuya_api_ms: tuyaApiMs,
        server_total_ms: serverTotalMs,
        error: tuyaError
      })
      .eq("id", feedEventId);
  } else {
    const { data: inserted } = await supabase
      .from("feed_events")
      .insert({
        source,
        data_origin: dataOrigin,
        result: finalResult,
        portions_requested: reserved.portions_requested,
        portions_dispensed: portionsDispensed,
        remaining_portions_after: remainingAfter,
        calibration_id: reserved.calibration_id,
        schedule_id: params.scheduleId ?? null,
        scheduled_for: params.scheduledFor ?? null,
        test_label: testLabel,
        vibration_g: vibrationG,
        tuya_endpoint: tuyaEndpoint,
        fallback_reason: fallbackReason,
        token_refreshed: tokenRefreshed,
        tuya_api_ms: tuyaApiMs,
        error: tuyaError
      })
      .select("id")
      .single();

    if (inserted?.id) {
      feedEventId = Number(inserted.id);
    }
  }

  const serverTotalMs = Date.now() - start;
  if (feedEventId) {
    await supabase
      .from("feed_events")
      .update({ server_total_ms: serverTotalMs })
      .eq("id", feedEventId);
  }

  // Evaluate alerts
  if (!tuyaSuccess) {
    await raiseAlert(
      "FEED_FAILED",
      `Feed failed (${sourceLabel(source)}): ${tuyaError ?? "Feeder API error"}`,
      null,
      "critical"
    );
  } else {
    await evaluateHopperAlerts({
      remainingPortions: remainingAfter,
      capacityPortions: reserved.capacity_portions,
      lowFoodThresholdPercent: settings?.low_food_threshold_percent ?? 20,
      tuyaLowFood: settings?.tuya_low_food
    });
  }

  return {
    httpStatus: tuyaSuccess ? 200 : 502,
    ok: tuyaSuccess,
    feedEventId,
    result: finalResult,
    dataOrigin,
    portionsRequested: reserved.portions_requested,
    portionsDispensed,
    remainingPortionsAfter: remainingAfter,
    capacityPortions: reserved.capacity_portions,
    serverTotalMs,
    tuyaApiMs,
    tuyaEndpoint,
    fallbackReason,
    tokenRefreshed,
    error: tuyaError
  };
}

function sourceLabel(s: TriggerSourceKey): string {
  switch (s) {
    case "MANUAL":
      return "Manual";
    case "SCHEDULE":
      return "Schedule";
    case "ESP32_SENSOR":
      return "ESP32 sensor";
    case "PHONE_SENSOR":
      return "Phone sensor";
  }
}

function formatSkipMessage(
  reason: FeedResult,
  r: ReserveFeedRpcResult
): string {
  switch (reason) {
    case "SKIPPED_DISABLED":
      return "Trigger source is turned off in Feeding settings.";
    case "SKIPPED_COOLDOWN":
      return `Cooldown active. Try again in ${Math.ceil((r.retry_after_ms ?? 1000) / 1000)} s.`;
    case "SKIPPED_DAILY_LIMIT":
      return `Daily limit of ${r.daily_max_portions} portions reached (${r.daily_used_portions} fed today).`;
    case "SKIPPED_EMPTY":
      return `Hopper does not have enough portions (${r.remaining_after} left, ${r.portions_requested} requested).`;
    case "SKIPPED_QUIET_HOURS":
      return "Skipped during quiet hours.";
    default:
      return "Feed skipped.";
  }
}

