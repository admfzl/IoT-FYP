import "server-only";
import { NextRequest, NextResponse } from "next/server";

export function verifyFeedToken(_req: NextRequest): NextResponse | null {
  return null;
}

export function verifyCronOrFeedToken(_req: NextRequest): NextResponse | null {
  return null;
}

