import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { fetchTuyaDeviceStatusAndSpec } from "@/lib/tuya";
import { evaluateHopperAlerts, raiseAlert, resolveAlert } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * POST /api/settings/test-connection (requires x-feed-token)
 * Fetches device online status, DP `status` low-food sensor, and `manual_feed` range from Tuya.
 * NEVER sends a feed command.
 */
export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const status = await fetchTuyaDeviceStatusAndSpec();
  const supabase = getSupabaseAdmin();

  if (status.configured) {
    const { data: updatedSettings } = await supabase
      .from("feeder_settings")
      .update({
        tuya_online: status.online,
        tuya_low_food: status.lowFood,
        tuya_status_checked_at: status.checkedAtIso,
        tuya_manual_feed_min: status.manualFeedMin,
        tuya_manual_feed_max: status.manualFeedMax
      })
      .eq("id", 1)
      .select("*")
      .single();

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

    if (updatedSettings) {
      await evaluateHopperAlerts({
        remainingPortions: updatedSettings.remaining_portions,
        capacityPortions: updatedSettings.capacity_portions,
        lowFoodThresholdPercent: updatedSettings.low_food_threshold_percent,
        tuyaLowFood: status.lowFood
      });
    }
  }

  return NextResponse.json({
    ok: !status.error,
    ...status
  });
}

