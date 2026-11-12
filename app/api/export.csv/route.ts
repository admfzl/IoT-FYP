import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Database configuration error on server."
      },
      { status: 500 }
    );
  }

  // §8: GET /api/export.csv — LIVE feed_logs as CSV for report appendix
  const { data, error } = await supabase
    .from("feed_logs")
    .select("*")
    .eq("data_origin", "LIVE")
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: `Failed to export LIVE feed_logs: ${error.message}` },
      { status: 500 }
    );
  }

  const columns = [
    "id",
    "created_at",
    "source",
    "data_origin",
    "run_label",
    "vibration_g",
    "tuya_endpoint",
    "token_refreshed",
    "tuya_api_ms",
    "server_total_ms",
    "client_rtt_ms",
    "network_ms",
    "tuya_success",
    "tuya_error",
    "remaining_grams",
    "remaining_percent"
  ];

  const lines = [columns.join(",")];
  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    lines.push(columns.map((col) => escapeCsvCell(record[col])).join(","));
  }

  const csvContent = lines.join("\n") + "\n";

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="feed_logs_live.csv"',
      "Cache-Control": "no-store"
    }
  });
}

