import type { DaySchedule, PeriodScope, PeriodSummary } from '@mizunashi/schema';
import { addDays, diffDays } from '../status/jst.js';

export interface PeriodRange {
  from: string;
  to: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 単日 */
export function dayRange(date: string): PeriodRange {
  return { from: date, to: date };
}

/**
 * 指定日を起点とする 7 日間。暦週に丸めない。
 * 「今日から 7 日間」が要件のため（DESIGN.md FR-05）。
 */
export function weekRange(date: string, align: 'anchor' | 'calendar' = 'anchor'): PeriodRange {
  if (align === 'calendar') {
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    // 月曜始まりに丸める
    const monday = addDays(date, wd === 0 ? -6 : 1 - wd);
    return { from: monday, to: addDays(monday, 6) };
  }
  return { from: date, to: addDays(date, 6) };
}

/** 1 日から最終日まで。うるう年も正しく扱う */
export function monthRange(year: number, month: number): PeriodRange {
  return {
    from: `${String(year)}-${pad2(month)}-01`,
    to: `${String(year)}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
}

export function yearRange(year: number): PeriodRange {
  return { from: `${String(year)}-01-01`, to: `${String(year)}-12-31` };
}

export function rangeOf(
  scope: PeriodScope,
  anchor: string,
  year?: number,
  month?: number,
): PeriodRange {
  switch (scope) {
    case 'day':
      return dayRange(anchor);
    case 'week':
      return weekRange(anchor);
    case 'month':
      return monthRange(year ?? Number(anchor.slice(0, 4)), month ?? Number(anchor.slice(5, 7)));
    case 'year':
      return yearRange(year ?? Number(anchor.slice(0, 4)));
    case 'range':
      return dayRange(anchor);
  }
}

export function summarize(days: readonly DaySchedule[], range: PeriodRange): PeriodSummary {
  const distribution: Record<string, number> = {};
  let sessionCount = 0;
  let totalMinutes = 0;
  let holidayCount = 0;
  let earliestStart: string | null = null;
  let latestEnd: string | null = null;
  let longestSession: PeriodSummary['longestSession'] = null;

  for (const day of days) {
    const key = String(day.sessions.length);
    distribution[key] = (distribution[key] ?? 0) + 1;
    sessionCount += day.sessions.length;
    totalMinutes += day.summary.totalMinutes;
    if (day.holiday != null) holidayCount++;

    const { firstStart, lastEnd } = day.summary;
    if (firstStart != null && (earliestStart == null || firstStart < earliestStart)) {
      earliestStart = firstStart;
    }
    if (lastEnd != null && (latestEnd == null || lastEnd > latestEnd)) latestEnd = lastEnd;

    for (const s of day.sessions) {
      if (longestSession == null || s.minutes > longestSession.minutes) {
        longestSession = { date: day.date, start: s.start, end: s.end, minutes: s.minutes };
      }
    }
  }

  const expected = diffDays(range.from, range.to) + 1;

  return {
    dayCount: days.length,
    daysWithSessions: days.filter((d) => d.sessions.length > 0).length,
    sessionCount,
    totalMinutes,
    earliestStart,
    latestEnd,
    longestSession,
    holidayCount,
    sessionCountDistribution: distribution,
    maxSessionsPerDay: days.reduce((max, d) => Math.max(max, d.sessions.length), 0),
    missingDays: Math.max(0, expected - days.length),
  };
}

/**
 * 月グリッド。月初の曜日計算をクライアント各実装で間違える事故を防ぐため、
 * サーバ側で組んで返す（DESIGN.md §11.4）。
 */
export function calendarGrid(
  year: number,
  month: number,
  weekStart: 0 | 1 = 0,
): { firstWeekday: number; weeks: (string | null)[][] } {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (first - weekStart + 7) % 7;
  const total = daysInMonth(year, month);

  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= total; d++) cells.push(`${String(year)}-${pad2(month)}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { firstWeekday: first, weeks };
}
