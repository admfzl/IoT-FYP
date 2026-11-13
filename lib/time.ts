export const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const WEEKDAYS_Map: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

export interface ZonedDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
  dayOfWeek: number; // 0=Sunday .. 6=Saturday
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:MM:SS
  hmStr: string; // HH:MM
}

export function getZonedParts(
  input: Date | string | number,
  tz: string = DEFAULT_TIMEZONE
): ZonedDateParts {
  const d = input instanceof Date ? input : new Date(input);
  const safeTz = safeTimezone(tz);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  });
  const parts = fmt.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }
  const year = Number(map.year || 2026);
  const month = Number(map.month || 1);
  const day = Number(map.day || 1);
  const hour = Number(map.hour === "24" ? "00" : map.hour || 0);
  const minute = Number(map.minute || 0);
  const second = Number(map.second || 0);
  const dayOfWeek = WEEKDAYS_Map[map.weekday ?? "Sun"] ?? 0;

  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mi = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek,
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${mi}:${ss}`,
    hmStr: `${hh}:${mi}`
  };
}

export function safeTimezone(tz?: string | null): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Formats time in 24-hour format: `14:05:32`
 */
export function formatTimeMYT(
  input: Date | string | number | null | undefined,
  tz: string = DEFAULT_TIMEZONE
): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return getZonedParts(d, tz).timeStr;
}

/**
 * Formats date as `13 Nov 2026`
 */
export function formatDateMYT(
  input: Date | string | number | null | undefined,
  tz: string = DEFAULT_TIMEZONE
): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const p = getZonedParts(d, tz);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/**
 * Formats date + time as `13 Nov 2026, 14:05:32`
 */
export function formatDateTimeMYT(
  input: Date | string | number | null | undefined,
  tz: string = DEFAULT_TIMEZONE
): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const p = getZonedParts(d, tz);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${p.timeStr}`;
}

/**
 * Formats ISO-like local timestamp for CSV exports: `2026-11-13 14:05:32`
 */
export function formatLocalIsoTimestamp(
  input: Date | string | number | null | undefined,
  tz: string = DEFAULT_TIMEZONE
): string {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const p = getZonedParts(d, tz);
  return `${p.dateStr} ${p.timeStr}`;
}

/**
 * Relative seconds/minutes/hours string, e.g. `3 s ago`, `4 min ago`.
 */
export function formatRelativeAgo(
  input: Date | string | number | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!input) return "Never";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "Never";
  const diffSec = Math.max(0, Math.round((nowMs - d.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec} s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} d ago`;
}

/**
 * Checks if current time in `tz` falls within `[startStr, endStr)`.
 * Handles overnight spans like `22:00` to `06:00`.
 */
export function isWithinQuietHours(
  now: Date,
  startStr: string | null | undefined,
  endStr: string | null | undefined,
  tz: string = DEFAULT_TIMEZONE
): boolean {
  if (!startStr || !endStr) return false;
  const s = startStr.slice(0, 5);
  const e = endStr.slice(0, 5);
  if (s === e) return false;
  const cur = getZonedParts(now, tz).hmStr;
  if (s < e) {
    return cur >= s && cur < e;
  }
  return cur >= s || cur < e;
}

/**
 * Converts a local date `YYYY-MM-DD` and `HH:MM(:SS)` in `tz` into a UTC `Date`.
 */
export function zonedDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  tz: string = DEFAULT_TIMEZONE
): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm, ss = 0] = timeStr.split(":").map(Number);
  // First guess: treat components as UTC
  const guessMs = Date.UTC(y, m - 1, d, hh, mm, ss);
  const guessParts = getZonedParts(new Date(guessMs), tz);
  const asIfUtcMs = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    guessParts.hour,
    guessParts.minute,
    guessParts.second
  );
  const offsetMs = asIfUtcMs - guessMs;
  return new Date(guessMs - offsetMs);
}

/**
 * Returns start of today in `tz` as a UTC Date.
 */
export function getStartOfDayInTz(
  now: Date = new Date(),
  tz: string = DEFAULT_TIMEZONE
): Date {
  const p = getZonedParts(now, tz);
  return zonedDateTimeToUtc(p.dateStr, "00:00:00", tz);
}

