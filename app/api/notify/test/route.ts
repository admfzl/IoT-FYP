import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import {
  raiseAlert,
  sendEmailAlert,
  sendTelegramAlert
} from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: { channel?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const channel =
    typeof body.channel === "string"
      ? body.channel.trim().toLowerCase()
      : "telegram";

  const testMsg =
    "Test notification from Fish Feeder dashboard. Alert delivery is working.";

  if (channel === "telegram") {
    const res = await sendTelegramAlert(testMsg);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.error ?? "Failed to send Telegram message." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, channel: "telegram" });
  }

  if (channel === "email") {
    const res = await sendEmailAlert("Test notification", testMsg);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.error ?? "Failed to send email." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, channel: "email" });
  }

  await raiseAlert("TEST", testMsg, null, "info");
  return NextResponse.json({ ok: true, channel: "in_app" });
}

