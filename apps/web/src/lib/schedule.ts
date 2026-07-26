import type { DaySchedule, PeriodResponse, YearsResponse } from '@mizunashi/api-types';
import { CalendarView, computeStatus, jstDateKey, type StatusResult } from '@mizunashi/core/status';

export interface YearData {
  year: number;
  days: DaySchedule[];
  notes: { ja: string[]; en: string[] };
}

export interface ScheduleData {
  calendar: CalendarView;
  years: number[];
  notes: string[];
  fetchedAt: string | null;
}

/** API のオリジン。同一オリジン配信が既定なので通常は空文字（DESIGN.md ADR-002） */
const API_BASE: string =
  typeof import.meta.env.PUBLIC_API_BASE === 'string' ? import.meta.env.PUBLIC_API_BASE : '';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

/**
 * 年次データを一括で取得し、以降の計算はクライアント側で行う。
 * タブ切替・月送り・年切替でネットワークアクセスを発生させないため（DESIGN.md §12.6）。
 * 判定ロジックはサーバと同じ computeStatus を使うので結果がずれない（ADR-005）。
 */
export async function loadSchedule(signal?: AbortSignal): Promise<ScheduleData> {
  const index = await getJson<YearsResponse>('/api/v1/years', signal);
  const sources: YearData[] = [];

  for (const year of index.activeYears) {
    // at=none で現在時刻に依存しない静的バリアントを取る
    const period = await getJson<PeriodResponse>(`/api/v1/years/${String(year)}?at=none`, signal);
    sources.push({ year, days: period.days, notes: { ja: period.notes, en: [] } });
  }

  return {
    calendar: new CalendarView(sources),
    years: index.activeYears,
    notes: sources[0]?.notes.ja ?? [],
    fetchedAt: index.meta.fetchedAt,
  };
}

export function statusAt(data: ScheduleData, at: Date): StatusResult {
  return computeStatus(at, data.calendar, { upcomingLimit: 10 });
}

export function daysBetween(data: ScheduleData, from: string, count: number): DaySchedule[] {
  const out: DaySchedule[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const day = data.calendar.day(cursor);
    if (day != null) out.push(day);
    cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

export { jstDateKey };
