import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

export type NotificationType =
  | "LOW_FOOD"
  | "HOPPER_EMPTY"
  | "FEED_FAILED"
  | "FEEDER_OFFLINE"
  | "ESP32_OFFLINE"
  | "SCHEDULE_SKIPPED"
  | "DAILY_LIMIT_REACHED"
  | "TEST";

export type NotificationSeverity = "info" | "warning" | "critical";

/**
 * Raises an in-app alert if no active alert with the same `dedupeKey` exists.
 */
export async function raiseAlert(
  type: NotificationType,
  message: string,
  dedupeKey: string | null = null,
  severity: NotificationSeverity = "warning"
): Promise<{ raised: boolean; id: number | null }> {
  const supabase = getSupabaseAdmin();

  const { data: rpcId, error } = await supabase.rpc("raise_notification", {
    p_type: type,
    p_severity: severity,
    p_message: message,
    p_dedupe_key: dedupeKey
  });

  if (error || !rpcId) {
    return { raised: false, id: null };
  }

  const notifId = Number(rpcId);

  await supabase
    .from("notifications")
    .update({ channels_sent: ["in_app"] })
    .eq("id", notifId);

  return { raised: true, id: notifId };
}

/**
 * Resolves any active alert matching `dedupeKey`.
 */
export async function resolveAlert(dedupeKey: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("notifications")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString()
    })
    .eq("status", "active")
    .eq("dedupe_key", dedupeKey)
    .select("id");

  return Array.isArray(data) ? data.length : 0;
}

/**
 * Evaluates hopper level & Tuya low-food sensor and raises/resolves `low_food` and `hopper_empty` alerts.
 */
export async function evaluateHopperAlerts(params: {
  remainingPortions: number;
  capacityPortions: number;
  lowFoodThresholdPercent: number;
  tuyaLowFood?: boolean | null;
}): Promise<void> {
  const {
    remainingPortions,
    capacityPortions,
    lowFoodThresholdPercent,
    tuyaLowFood
  } = params;

  const cap = Math.max(1, capacityPortions);
  const pct = Math.round((remainingPortions / cap) * 100);

  if (remainingPortions <= 0) {
    await raiseAlert(
      "HOPPER_EMPTY",
      "Hopper empty: 0 portions left. Refill now.",
      "hopper_empty",
      "critical"
    );
  } else {
    await resolveAlert("hopper_empty");
  }

  const isLowByPortions = pct <= lowFoodThresholdPercent;
  const isLowByHardware = tuyaLowFood === true;

  if (isLowByPortions || isLowByHardware) {
    const reasonText =
      isLowByHardware && !isLowByPortions
        ? `Feeder low-food sensor triggered (${remainingPortions} portions tracked, ${pct}%). Refill soon.`
        : `Hopper low: ${remainingPortions} portions left (${pct}%). Refill soon.`;
    await raiseAlert("LOW_FOOD", reasonText, "low_food", "critical");
  } else {
    await resolveAlert("low_food");
  }
}

