import type { FeedScheduleRow } from "./supabase-server";
import {
  DEFAULT_TIMEZONE,
  getZonedParts,
  safeTimezone,
  zonedDateTimeToUtc
} from "./time";

export interface UpcomingScheduleRun {
  scheduleId: number;
  label: string | null;
  portions: number;
  timeOfDay: string; // HH:MM
  scheduledForIso: string; // UTC ISO
  localDateStr: string; // YYYY-MM-DD
  localTimeStr: string; // HH:MM
}

/**
 * Computes the next `count` upcoming scheduled runs across all enabled schedules.
 */
export function getUpcomingScheduleRuns(
  schedules: FeedScheduleRow[],
  now: Date = new Date(),
  tz: string = DEFAULT_TIMEZONE,
  count: number = 5
): UpcomingScheduleRun[] {
  const safeTz = safeTimezone(tz);
  const enabled = schedules.filter((s) => s.enabled);
  if (enabled.length === 0) return [];

  const candidates: UpcomingScheduleRun[] = [];
  const nowMs = now.getTime();

  // Inspect today and the next 7 days in the target timezone
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const probe = new Date(nowMs + dayOffset * 86_400_000);
    const parts = getZonedParts(probe, safeTz);

    for (const sched of enabled) {
      const days = Array.isArray(sched.days_of_week) ? sched.days_of_week : [];
      if (!days.includes(parts.dayOfWeek)) continue;

      const hm = sched.time_of_day.slice(0, 5);
      const targetUtc = zonedDateTimeToUtc(parts.dateStr, `${hm}:00`, safeTz);
      if (targetUtc.getTime() > nowMs) {
        candidates.push({
          scheduleId: sched.id,
          label: sched.label,
          portions: sched.portions,
          timeOfDay: hm,
          scheduledForIso: targetUtc.toISOString(),
          localDateStr: parts.dateStr,
          localTimeStr: hm
        });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      new Date(a.scheduledForIso).getTime() -
      new Date(b.scheduledForIso).getTime()
  );

  // Deduplicate in case daylight-saving/offset probing hits same dateStr twice
  const seen = new Set<string>();
  const unique: UpcomingScheduleRun[] = [];
  for (const c of candidates) {
    const key = `${c.scheduleId}::${c.scheduledForIso}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
      if (unique.length >= count) break;
    }
  }

  return unique;
}

/**
 * Finds enabled schedules that are due in the current minute OR missed within the last `lookbackMinutes` (default 5).
 */
export function getDueScheduleSlots(
  schedules: FeedScheduleRow[],
  now: Date = new Date(),
  tz: string = DEFAULT_TIMEZONE,
  lookbackMinutes: number = 5
): UpcomingScheduleRun[] {
  const safeTz = safeTimezone(tz);
  const enabled = schedules.filter((s) => s.enabled);
  if (enabled.length === 0) return [];

  const due: UpcomingScheduleRun[] = [];
  const seen = new Set<string>();
  const baseMinuteMs = Math.floor(now.getTime() / 60_000) * 60_000;

  for (let m = lookbackMinutes; m >= 0; m--) {
    const slotUtc = new Date(baseMinuteMs - m * 60_000);
    const parts = getZonedParts(slotUtc, safeTz);

    for (const sched of enabled) {
      const days = Array.isArray(sched.days_of_week) ? sched.days_of_week : [];
      if (!days.includes(parts.dayOfWeek)) continue;

      const hm = sched.time_of_day.slice(0, 5);
      if (hm !== parts.hmStr) continue;

      const canonicalUtc = zonedDateTimeToUtc(
        parts.dateStr,
        `${hm}:00`,
        safeTz
      );
      const key = `${sched.id}::${canonicalUtc.toISOString()}`;
      if (!seen.has(key)) {
        seen.add(key);
        due.push({
          scheduleId: sched.id,
          label: sched.label,
          portions: sched.portions,
          timeOfDay: hm,
          scheduledForIso: canonicalUtc.toISOString(),
          localDateStr: parts.dateStr,
          localTimeStr: hm
        });
      }
    }
  }

  return due;
}

