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

export function isTelegramConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_CHAT_ID?.trim()
  );
}

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.ALERT_EMAIL_TO?.trim()
  );
}

export async function sendTelegramAlert(
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    return {
      ok: false,
      error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured."
    };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `[Fish Feeder] ${message}`
        }),
        cache: "no-store"
      }
    );
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error: json.description ?? `Telegram HTTP ${res.status}`
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Telegram send failed"
    };
  }
}

export async function sendEmailAlert(
  subject: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.ALERT_EMAIL_TO?.trim();
  if (!apiKey || !to) {
    return {
      ok: false,
      error: "RESEND_API_KEY or ALERT_EMAIL_TO is not configured."
    };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: "Fish Feeder <onboarding@resend.dev>",
        to: [to],
        subject: `[Fish Feeder] ${subject}`,
        text: message
      }),
      cache: "no-store"
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Resend HTTP ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Email send failed"
    };
  }
}

/**
 * Raises an alert if no active alert with the same `dedupeKey` exists.
 * If newly inserted, delivers to enabled external channels (Telegram, Email).
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
  const channelsSent: string[] = ["in_app"];

  const { data: settings } = await supabase
    .from("feeder_settings")
    .select("notify_telegram, notify_email")
    .eq("id", 1)
    .single();

  if (settings?.notify_telegram !== false && isTelegramConfigured()) {
    const tg = await sendTelegramAlert(message);
    if (tg.ok) channelsSent.push("telegram");
  }

  if (settings?.notify_email && isEmailConfigured()) {
    const em = await sendEmailAlert(type.replace(/_/g, " "), message);
    if (em.ok) channelsSent.push("email");
  }

  await supabase
    .from("notifications")
    .update({ channels_sent: channelsSent })
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

