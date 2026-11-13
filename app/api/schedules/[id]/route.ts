import { NextRequest, NextResponse } from "next/server";
import { verifyFeedToken } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const { id } = await context.params;
  const scheduleId = Number(id);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
    return NextResponse.json({ error: "Invalid schedule ID." }, { status: 400 });
  }

  let body: {
    time_of_day?: unknown;
    days_of_week?: unknown;
    portions?: unknown;
    label?: unknown;
    enabled?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (body.time_of_day !== undefined) {
    const t = typeof body.time_of_day === "string" ? body.time_of_day.trim() : "";
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(t)) {
      return NextResponse.json(
        { error: "time_of_day must be in HH:MM format." },
        { status: 400 }
      );
    }
    updates.time_of_day = t.slice(0, 5);
  }

  if (body.days_of_week !== undefined) {
    if (!Array.isArray(body.days_of_week)) {
      return NextResponse.json(
        { error: "days_of_week must be an array of integers 0..6." },
        { status: 400 }
      );
    }
    const validDays = Array.from(
      new Set(
        body.days_of_week
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      )
    ).sort((a, b) => a - b);
    if (validDays.length === 0) {
      return NextResponse.json(
        { error: "Select at least one day of the week." },
        { status: 400 }
      );
    }
    updates.days_of_week = validDays;
  }

  if (body.portions !== undefined) {
    const p = Number(body.portions);
    if (!Number.isInteger(p) || p < 1 || p > 20) {
      return NextResponse.json(
        { error: "portions must be an integer between 1 and 20." },
        { status: 400 }
      );
    }
    updates.portions = p;
  }

  if (body.label !== undefined) {
    updates.label =
      typeof body.label === "string" && body.label.trim().length > 0
        ? body.label.trim().slice(0, 60)
        : null;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean." },
        { status: 400 }
      );
    }
    updates.enabled = body.enabled;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("feed_schedules")
    .update(updates)
    .eq("id", scheduleId)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update schedule." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, schedule: data });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = verifyFeedToken(req);
  if (authError) return authError;

  const { id } = await context.params;
  const scheduleId = Number(id);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
    return NextResponse.json({ error: "Invalid schedule ID." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("feed_schedules")
    .delete()
    .eq("id", scheduleId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

