import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { feedOnce, isTuyaConfigured } from "@/lib/tuya";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  if (!isTuyaConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Tuya credentials (TUYA_CLIENT_ID / TUYA_CLIENT_SECRET) are not configured."
      },
      { status: 503 }
    );
  }

  const result = await feedOnce();
  return NextResponse.json(result, { status: result.success ? 200 : 502 });
}

