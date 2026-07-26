import type { DaySchedule, ResolvedSession } from '@mizunashi/schema';
import { addDays, jstInstant } from './jst.js';

/**
 * CalendarView に必要な最小限。YearSchedule はこれを構造的に満たす。
 * API から取得した期間レスポンスからも組み立てられるようにするため、
 * 全体ではなく部分集合で受ける。
 */
export interface CalendarSource {
  year: number;
  days: readonly DaySchedule[];
  notes: { ja: readonly string[]; en: readonly string[] };
}

/**
 * 複数年をまたいで日付引きできるビュー。
 * セッションを平坦な時系列リストとして持つのが要点で、1 日に何回あっても
 * 同じ二分探索で扱える（DESIGN.md §10.3）。
 */
export class CalendarView {
  readonly #days = new Map<string, DaySchedule>();
  readonly #sessions: ResolvedSession[] = [];
  readonly #years: CalendarSource[];

  constructor(years: readonly CalendarSource[]) {
    this.#years = [...years].sort((a, b) => a.year - b.year);

    for (const year of this.#years) {
      for (const day of year.days) this.#days.set(day.date, day);
    }

    for (const date of [...this.#days.keys()].sort()) {
      const day = this.#days.get(date);
      if (!day) continue;
      const ofDay = day.sessions.length;
      for (const s of day.sessions) {
        const startAt = jstInstant(date, s.start);
        // 日跨ぎのセッションは終了時刻が翌日になる
        const endDate = s.crossesMidnight ? addDays(date, 1) : date;
        const endAt = jstInstant(endDate, s.end);
        this.#sessions.push({
          date,
          index: s.index,
          ofDay,
          start: s.start,
          end: s.end,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          startsInSeconds: 0,
          endsInSeconds: 0,
          durationMinutes: s.minutes,
        });
      }
    }

    this.#sessions.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  get years(): readonly CalendarSource[] {
    return this.#years;
  }

  get sessions(): readonly ResolvedSession[] {
    return this.#sessions;
  }

  day(date: string): DaySchedule | null {
    return this.#days.get(date) ?? null;
  }

  covers(date: string): boolean {
    const c = this.coverage();
    return c != null && date >= c.from && date <= c.to;
  }

  coverage(): { from: string; to: string } | null {
    const dates = [...this.#days.keys()].sort();
    const from = dates[0];
    const to = dates[dates.length - 1];
    return from != null && to != null ? { from, to } : null;
  }

  sessionsOn(date: string): ResolvedSession[] {
    return this.#sessions.filter((s) => s.date === date);
  }

  /** 注意書き。年をまたぐ場合は重複を除いて連結する */
  notes(lang: 'ja' | 'en'): string[] {
    const out: string[] = [];
    for (const year of this.#years) {
      for (const note of year.notes[lang]) if (!out.includes(note)) out.push(note);
    }
    return out;
  }
}

/** startAt が t 以下である最後の位置の次を返す（二分探索） */
export function upperBoundByStart(sessions: readonly ResolvedSession[], t: number): number {
  let lo = 0;
  let hi = sessions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const startAt = sessions[mid]?.startAt;
    if (startAt != null && Date.parse(startAt) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
