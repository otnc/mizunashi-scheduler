import type { DaySchedule, ResolvedSession } from '@mizunashi/api-types';
import { formatMinutes } from '../../lib/format';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

export interface SessionListProps {
  day: DaySchedule;
  /** 今日の場合のみ渡す。各セッションの進行状況を出す */
  resolved?: ResolvedSession[];
}

const STATUS_LABEL: Record<string, string> = {
  ongoing: '進行中',
  upcoming: 'この後',
  ended: '終了',
};

/**
 * その日のセッションを必ず全件、番号付きで並べる。
 * 1 日に複数回あるのが常態なので、先頭だけを見せる要約はしない（DESIGN.md §13.5）。
 */
export function SessionList({ day, resolved }: SessionListProps) {
  if (day.sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">この日の入浴可能時間はありません</p>;
  }

  return (
    <ul className="space-y-1">
      {day.sessions.map((s, i) => {
        const status = resolved?.find((r) => r.index === s.index)?.status;
        return (
          <li key={s.index} className="flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground" aria-hidden="true">
              {CIRCLED[i] ?? `(${String(i + 1)})`}
            </span>
            <span className="font-medium tabular-nums">
              {s.start} – {s.end}
            </span>
            <span className="text-muted-foreground tabular-nums">{formatMinutes(s.minutes)}</span>
            {status != null && (
              <span
                className={
                  status === 'ongoing'
                    ? 'rounded bg-state-open-subtle px-1.5 py-0.5 text-xs text-state-open'
                    : status === 'ended'
                      ? 'rounded bg-state-closed-subtle px-1.5 py-0.5 text-xs text-muted-foreground'
                      : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                }
              >
                {STATUS_LABEL[status] ?? status}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
