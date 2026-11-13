import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  let body: { confirmation?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.confirmation !== "RESET") {
    return NextResponse.json(
      {
        error:
          'Typed confirmation required. Send { "confirmation": "RESET" } to reset the v2 database.'
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("dev_reset");

  if (error) {
    return NextResponse.json(
      { error: `Reset failed: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    result: data
  });
}

