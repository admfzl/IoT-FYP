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

export function verifyCronOrFeedToken(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const providedCron = req.headers.get("x-cron-secret")?.trim();
  if (cronSecret && providedCron && providedCron === cronSecret) {
    return null;
  }

  const feedToken = process.env.FEED_API_TOKEN?.trim();
  const providedFeed = req.headers.get("x-feed-token")?.trim();
  if (feedToken && providedFeed && providedFeed === feedToken) {
    return null;
  }

  if (!cronSecret && !feedToken) {
    return NextResponse.json(
      {
        error: "Server misconfiguration: neither CRON_SECRET nor FEED_API_TOKEN is set."
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: "Unauthorized: invalid or missing x-cron-secret or x-feed-token header." },
    { status: 401 }
  );
}
