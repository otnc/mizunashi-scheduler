import type { DaySummary, Session } from '@mizunashi/schema';
import { fromTimeStr, MINUTES_PER_DAY } from '@mizunashi/schema';

/**
 * 1 日分のサマリ。totalMinutes はセッションの合計であり、
 * firstStart〜lastEnd の幅ではない（谷を含むため。DESIGN.md §9.4）。
 */
export function summarize(sessions: readonly Session[]): DaySummary {
  if (sessions.length === 0) {
    return {
      firstStart: null,
      lastEnd: null,
      totalMinutes: 0,
      sessionCount: 0,
      longestMinutes: 0,
      gaps: [],
    };
  }

  const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  const longestMinutes = sessions.reduce((max, s) => Math.max(max, s.minutes), 0);

  const gaps: number[] = [];
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1];
    const cur = sessions[i];
    if (!prev || !cur) continue;
    const prevEnd = fromTimeStr(prev.start) + prev.minutes;
    const curStart = fromTimeStr(cur.start) + (cur.crossesMidnight ? 0 : 0);
    gaps.push(Math.max(0, curStart - prevEnd));
  }

  const last = sessions[sessions.length - 1];
  const first = sessions[0];
  return {
    firstStart: first?.start ?? null,
    lastEnd: last?.end ?? null,
    totalMinutes,
    sessionCount: sessions.length,
    longestMinutes,
    gaps,
  };
}

export function maxSessionsPerDay(days: readonly { sessions: readonly Session[] }[]): number {
  return days.reduce((max, d) => Math.max(max, d.sessions.length), 0);
}

export const DAY_MINUTES = MINUTES_PER_DAY;
