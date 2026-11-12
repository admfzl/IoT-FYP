import "server-only";
import { NextRequest, NextResponse } from "next/server";

export function verifyFeedToken(req: NextRequest): NextResponse | null {
  const expectedToken = process.env.FEED_API_TOKEN?.trim();
  if (!expectedToken) {
    return NextResponse.json(
      {
        error: "Server misconfiguration: FEED_API_TOKEN is not set on the server."
      },
      { status: 500 }
    );
  }

  const providedToken = req.headers.get("x-feed-token")?.trim();
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json(
      { error: "Unauthorized: invalid or missing x-feed-token header." },
      { status: 401 }
    );
  }

  return null;
}

