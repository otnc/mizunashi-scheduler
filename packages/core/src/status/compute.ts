import type { DaySchedule, ResolvedSession, UnavailableReason } from '@mizunashi/schema';
import { upperBoundByStart, type CalendarView } from './calendar.js';
import { jstDateKey, jstYear, toIsoJst } from './jst.js';

/** 終了まで何分を切ったら「まもなく終了」とみなすか */
export const CLOSING_SOON_MINUTES = 60;

export interface StatusResult {
  now: string;
  state: 'open' | 'closed' | 'unknown';
  closingSoon: boolean;
  current: ResolvedSession | null;
  next: ResolvedSession | null;
  nextUnavailableReason: UnavailableReason | null;
  today: DaySchedule | null;
  todaySessions: ResolvedSession[];
  nextToday: ResolvedSession | null;
  remainingToday: ResolvedSession[];
  remainingCountToday: number;
  endedCountToday: number;
  totalCountToday: number;
  upcoming: ResolvedSession[];
  coverage: { from: string; to: string } | null;
}

function withRelative(s: ResolvedSession, t: number): ResolvedSession {
  const start = Date.parse(s.startAt);
  const end = Date.parse(s.endAt);
  return {
    ...s,
    startsInSeconds: Math.round((start - t) / 1000),
    endsInSeconds: Math.round((end - t) / 1000),
    status: t < start ? 'upcoming' : t < end ? 'ongoing' : 'ended',
  };
}

/**
 * ある時刻における入浴可否を求める。
 *
 * 「日 → セッション」の二重ループではなく、平坦化した時系列リストへの
 * 二分探索で解く。1 日に 1 回でも 3 回でも同じコードで正しく動く（DESIGN.md §10.3）。
 */
export function computeStatus(
  now: Date,
  calendar: CalendarView,
  opts: { upcomingLimit?: number } = {},
): StatusResult {
  const t = now.getTime();
  const todayKey = jstDateKey(now);
  const all = calendar.sessions;
  const i = upperBoundByStart(all, t);

  // now が [start, end) に入るセッション。同日内の重複は検証で弾いているが、
  // 日跨ぎの可能性があるので数件だけ遡って確認する
  let current: ResolvedSession | null = null;
  for (let k = i - 1; k >= 0 && k >= i - 4; k--) {
    const s = all[k];
    if (!s) continue;
    if (Date.parse(s.startAt) <= t && t < Date.parse(s.endAt)) {
      current = withRelative(s, t);
      break;
    }
  }

  const upcoming = all.slice(i, i + (opts.upcomingLimit ?? 10)).map((s) => withRelative(s, t));
  const todaySessions = calendar.sessionsOn(todayKey).map((s) => withRelative(s, t));

  const remainingToday = todaySessions.filter((s) => s.status === 'upcoming');
  const endedCountToday = todaySessions.filter((s) => s.status === 'ended').length;

  const covered = calendar.covers(todayKey);
  const next = upcoming[0] ?? null;

  return {
    now: toIsoJst(now),
    state: current ? 'open' : covered ? 'closed' : 'unknown',
    closingSoon: current != null && current.endsInSeconds <= CLOSING_SOON_MINUTES * 60,
    current,
    next,
    nextUnavailableReason: next ? null : inferReason(now, calendar),
    today: calendar.day(todayKey),
    todaySessions,
    nextToday: remainingToday[0] ?? null,
    remainingToday,
    remainingCountToday: remainingToday.length,
    endedCountToday,
    totalCountToday: todaySessions.length,
    upcoming,
    coverage: calendar.coverage(),
  };
}

/**
 * 「次」が無い理由を返す。
 * 年末に翌年データが未公開だと答えられなくなるため、その旨を区別する。
 */
function inferReason(now: Date, calendar: CalendarView): UnavailableReason | null {
  const coverage = calendar.coverage();
  if (coverage == null) return 'out_of_coverage';
  const todayKey = jstDateKey(now);
  if (todayKey > coverage.to) return 'out_of_coverage';
  // 収録範囲の末尾に達しており、翌年のデータがあれば答えられたはず
  const hasNextYear = calendar.years.some((y) => y.year > jstYear(now));
  return hasNextYear ? 'out_of_coverage' : 'no_data_for_next_year';
}
