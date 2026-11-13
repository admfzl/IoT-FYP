import "server-only";
import {
  getSupabaseAdmin,
  type FeedScheduleRow,
  type FeederSettingsRow
} from "./supabase-server";
import { getDueScheduleSlots } from "./schedule";
import { executeFeed } from "./feed";
import { fetchTuyaDeviceStatusAndSpec, isTuyaConfigured } from "./tuya";
import { evaluateHopperAlerts, raiseAlert, resolveAlert } from "./notify";

export interface CronTickSummary {
  ok: boolean;
  ranAt: string;
  schedulesChecked: number;
  schedulesTriggered: Array<{
    scheduleId: number;
    scheduledFor: string;
    result: string;
  }>;
  tuyaChecked: boolean;
  tuyaOnline: boolean | null;
  tuyaLowFood: boolean | null;
  esp32OfflineAlert: "raised" | "resolved" | "unchanged";
  cleanedSensorRows: number;
}

/**
 * Shared background job runner invoked every minute by the Cloudflare Worker `scheduled()` handler
 * and by `POST /api/cron/tick` (or the "Run scheduler now" button in Developer tools).
 */
export async function runCronTick(
  forceTuyaCheck = false
): Promise<CronTickSummary> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: settingsData } = await supabase
    .from("feeder_settings")
    .select("*")
    .eq("id", 1)
    .single();

  const settings = settingsData as FeederSettingsRow | null;
  const tz = settings?.timezone ?? "Asia/Kuala_Lumpur";

  // 1. Schedules: find enabled schedules due now or missed within the last 5 minutes
  const { data: schedulesData } = await supabase
    .from("feed_schedules")
    .select("*")
    .eq("enabled", true);

  const schedules = (schedulesData ?? []) as FeedScheduleRow[];
  const dueSlots = getDueScheduleSlots(schedules, now, tz, 5);
  const schedulesTriggered: Array<{
    scheduleId: number;
    scheduledFor: string;
    result: string;
  }> = [];

  for (const slot of dueSlots) {
    // Claim the run atomically via the unique index on (schedule_id, scheduled_for)
    const { data: claimed, error: claimErr } = await supabase
      .from("feed_events")
      .insert({
        source: "SCHEDULE",
        data_origin: settings?.simulation_mode ? "SIMULATED" : "LIVE",
        result: "PENDING",
        portions_requested: slot.portions,
        portions_dispensed: 0,
        remaining_portions_after: settings?.remaining_portions ?? 0,
        calibration_id: settings?.active_calibration_id ?? null,
        schedule_id: slot.scheduleId,
        scheduled_for: slot.scheduledForIso,
        test_label: slot.label
      })
      .select("id")
      .single();

    if (claimErr || !claimed?.id) {
      // Already claimed/executed by a previous tick
      continue;
    }

    const res = await executeFeed({
      source: "SCHEDULE",
      portions: slot.portions,
      testLabel: slot.label,
      scheduleId: slot.scheduleId,
      scheduledFor: slot.scheduledForIso,
      existingEventId: Number(claimed.id)
    });

    schedulesTriggered.push({
      scheduleId: slot.scheduleId,
      scheduledFor: slot.scheduledForIso,
      result: res.result
    });
  }

  // 2. Feeder status (every 5 minutes, or when forced) — NEVER sends a feed command
  let tuyaChecked = false;
  let tuyaOnline: boolean | null = settings?.tuya_online ?? null;
  let tuyaLowFood: boolean | null = settings?.tuya_low_food ?? null;

  const lastCheckedMs = settings?.tuya_status_checked_at
    ? new Date(settings.tuya_status_checked_at).getTime()
    : 0;

  if (
    isTuyaConfigured() &&
    (forceTuyaCheck || now.getTime() - lastCheckedMs >= 5 * 60_000)
  ) {
    tuyaChecked = true;
    const status = await fetchTuyaDeviceStatusAndSpec();
    tuyaOnline = status.online;
    tuyaLowFood = status.lowFood;

    await supabase
      .from("feeder_settings")
      .update({
        tuya_online: status.online,
        tuya_low_food: status.lowFood,
        tuya_status_checked_at: status.checkedAtIso,
        tuya_manual_feed_min: status.manualFeedMin,
        tuya_manual_feed_max: status.manualFeedMax
      })
      .eq("id", 1);

    if (status.online === false) {
      await raiseAlert(
        "FEEDER_OFFLINE",
        "Feeder is offline according to Tuya Cloud. Check feeder power and Wi-Fi.",
        "feeder_offline",
        "critical"
      );
    } else if (status.online === true) {
      await resolveAlert("feeder_offline");
    }
  }

  // 3. Sensor heartbeat: raise or resolve "ESP32 offline" alert if ESP32 source is enabled
  //    or if a heartbeat row exists and has been silent for > esp32_offline_minutes
  let esp32OfflineAlert: "raised" | "resolved" | "unchanged" = "unchanged";
  const [{ data: espSource }, { data: heartbeats }] = await Promise.all([
    supabase
      .from("trigger_sources")
      .select("enabled")
      .eq("source", "ESP32_SENSOR")
      .single(),
    supabase
      .from("device_heartbeats")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(1)
  ]);

  const latestHb = heartbeats?.[0];
  const offlineThresholdMin = settings?.esp32_offline_minutes ?? 5;

  if (latestHb) {
    const ageMs = now.getTime() - new Date(latestHb.last_seen_at).getTime();
    if (ageMs <= 30_000) {
      const resolvedCount = await resolveAlert("esp32_offline");
      if (resolvedCount > 0) esp32OfflineAlert = "resolved";
    } else if (
      espSource?.enabled &&
      ageMs > offlineThresholdMin * 60_000
    ) {
      const r = await raiseAlert(
        "ESP32_OFFLINE",
        `ESP32 vibration sensor has been offline for more than ${offlineThresholdMin} minutes.`,
        "esp32_offline",
        "warning"
      );
      if (r.raised) esp32OfflineAlert = "raised";
    }
  }

  // 4. Low food evaluation
  const { data: latestSettings } = await supabase
    .from("feeder_settings")
    .select(
      "remaining_portions, capacity_portions, low_food_threshold_percent, tuya_low_food, last_cleanup_at, sensor_retention_days"
    )
    .eq("id", 1)
    .single();

  if (latestSettings) {
    await evaluateHopperAlerts({
      remainingPortions: latestSettings.remaining_portions,
      capacityPortions: latestSettings.capacity_portions,
      lowFoodThresholdPercent: latestSettings.low_food_threshold_percent,
      tuyaLowFood: latestSettings.tuya_low_food
    });
  }

  // 5. Cleanup: sensor retention (once per hour)
  let cleanedSensorRows = 0;
  const lastCleanupMs = latestSettings?.last_cleanup_at
    ? new Date(latestSettings.last_cleanup_at).getTime()
    : 0;

  if (now.getTime() - lastCleanupMs >= 60 * 60_000) {
    const retentionDays = latestSettings?.sensor_retention_days ?? 30;
    const { data: delCount } = await supabase.rpc("cleanup_sensor_readings", {
      p_days: retentionDays
    });
    if (typeof delCount === "number") {
      cleanedSensorRows = delCount;
    }
    await supabase
      .from("feeder_settings")
      .update({ last_cleanup_at: nowIso, last_tick_at: nowIso })
      .eq("id", 1);
  } else {
    await supabase
      .from("feeder_settings")
      .update({ last_tick_at: nowIso })
      .eq("id", 1);
  }

  return {
    ok: true,
    ranAt: nowIso,
    schedulesChecked: schedules.length,
    schedulesTriggered,
    tuyaChecked,
    tuyaOnline,
    tuyaLowFood,
    esp32OfflineAlert,
    cleanedSensorRows
  };
}

