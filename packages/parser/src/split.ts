import type { DaySchedule } from '@mizunashi/schema';

export interface CalendarYearBucket {
  year: number;
  days: DaySchedule[];
  coverage: { from: string; to: string };
  complete: boolean;
  maxSessionsPerDay: number;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * 暦年ごとに分割する。会計年度ファイルや部分年ファイルが来ても、
 * 下流は常に「暦年ごとの日程」だけを見ればよくなる（DESIGN.md §8.6）。
 */
export function splitByCalendarYear(days: readonly DaySchedule[]): CalendarYearBucket[] {
  const buckets = new Map<number, DaySchedule[]>();
  for (const day of days) {
    const year = Number(day.date.slice(0, 4));
    const list = buckets.get(year) ?? [];
    list.push(day);
    buckets.set(year, list);
  }

  return [...buckets]
    .map(([year, list]) => {
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      const from = sorted[0]?.date ?? `${String(year)}-01-01`;
      const to = sorted[sorted.length - 1]?.date ?? from;
      const expected = isLeap(year) ? 366 : 365;
      return {
        year,
        days: sorted,
        coverage: { from, to },
        complete: sorted.length === expected && from.endsWith('-01-01') && to.endsWith('-12-31'),
        maxSessionsPerDay: sorted.reduce((max, d) => Math.max(max, d.sessions.length), 0),
      };
    })
    .sort((a, b) => a.year - b.year);
}
