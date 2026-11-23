import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { raiseAlert } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const testMsg =
    "Test notification from Fish Feeder dashboard. Alert delivery is working.";

  await raiseAlert("TEST", testMsg, null, "info");
  return NextResponse.json({ ok: true, channel: "in_app" });
}

