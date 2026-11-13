import { NextRequest, NextResponse } from "next/server";
import { verifyCronOrFeedToken } from "@/lib/auth";
import { runCronTick } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyCronOrFeedToken(req);
  if (authError) return authError;

  try {
    const summary = await runCronTick(true);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Cron tick failed."
      },
      { status: 500 }
    );
  }
}

