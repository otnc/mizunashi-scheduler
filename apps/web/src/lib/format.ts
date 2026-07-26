import type { DaySchedule, ResolvedSession } from '@mizunashi/api-types';

const JST = 'Asia/Tokyo';

/** タイムゾーンは必ず明示する。実行環境に依存させない（DESIGN.md §10.1） */
const dateFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

export function formatDate(date: string): string {
  return dateFmt.format(new Date(`${date}T00:00:00+09:00`));
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${String(m)}分`;
  if (m === 0) return `${String(h)}時間`;
  return `${String(h)}時間${String(m)}分`;
}

export function formatMinutes(minutes: number): string {
  return formatDuration(minutes * 60);
}

export const toMinutes = (time: string): number =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export interface DayHeadline {
  /** 見出しに出す一言 */
  title: string;
  detail: string | null;
  tone: 'open' | 'soon' | 'closed';
}

/**
 * 「今」の状態を文言にする。
 * state と「今日の残り回数」は独立した 2 軸で、
 * 「入浴不可」＝「今日はもう無理」ではない（DESIGN.md §10.3）。
 */
export function headline(input: {
  state: 'open' | 'closed' | 'unknown';
  closingSoon: boolean;
  current: ResolvedSession | null;
  nextToday: ResolvedSession | null;
  next: ResolvedSession | null;
  endedCountToday: number;
  totalCountToday: number;
}): DayHeadline {
  const { state, current, nextToday, next, endedCountToday, totalCountToday } = input;

  if (state === 'unknown') {
    return { title: 'この日のデータはありません', detail: null, tone: 'closed' };
  }

  if (state === 'open' && current != null) {
    const ordinal =
      totalCountToday > 1 ? `${String(totalCountToday)}回中${String(current.index)}回目` : null;
    const after =
      nextToday != null
        ? `この後 ${nextToday.start} にもう一度`
        : totalCountToday > 1
          ? '本日はこれが最後'
          : null;
    return {
      title: `${current.end} まで入浴できます`,
      detail: [ordinal, after].filter((v) => v != null).join(' ・ '),
      tone: input.closingSoon ? 'soon' : 'open',
    };
  }

  if (nextToday != null) {
    // 谷の時間帯、または初回前
    const prefix = endedCountToday === 0 ? '本日は' : '次は今日';
    return {
      title: `${prefix} ${nextToday.start} から`,
      detail: `あと ${formatDuration(nextToday.startsInSeconds)} ・ ${formatMinutes(nextToday.durationMinutes)}入浴できます`,
      tone: 'closed',
    };
  }

  if (next != null) {
    return {
      title: '本日は終了しました',
      detail: `次は ${formatDate(next.date)} ${next.start} から（約 ${formatDuration(next.startsInSeconds)}後）`,
      tone: 'closed',
    };
  }

  return {
    title: '本日は終了しました',
    detail: '翌年の時間表がまだ公開されていません',
    tone: 'closed',
  };
}

/** 1 日の合計は「セッションの合計」であって firstStart〜lastEnd の幅ではない */
export function dayTotalLabel(day: DaySchedule): string {
  if (day.sessions.length === 0) return '入浴可能時間なし';
  return `${String(day.sessions.length)}回 ・ 計${formatMinutes(day.summary.totalMinutes)}`;
}
