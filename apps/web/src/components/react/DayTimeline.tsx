import type { DaySchedule } from '@mizunashi/api-types';
import { toMinutes } from '../../lib/format';

const DAY_MINUTES = 1440;

export interface DayTimelineProps {
  day: DaySchedule;
  /** 現在時刻（分）。今日の行にだけ渡す */
  nowMinutes?: number | null;
  showAxis?: boolean;
}

/**
 * 24 時間軸に全セッションを帯で描く。
 * 1440 分割のグリッドで全ての帯を同じ行に載せるため、
 * 回数が増えても高さが変わらない（DESIGN.md §13.5）。
 */
export function DayTimeline({ day, nowMinutes = null, showAxis = false }: DayTimelineProps) {
  return (
    <div className="w-full">
      <div
        className="relative grid h-3 w-full overflow-hidden rounded-full bg-muted"
        style={{ gridTemplateColumns: `repeat(${String(DAY_MINUTES)}, 1fr)` }}
        role="img"
        aria-label={
          day.sessions.length === 0
            ? '入浴可能時間なし'
            : day.sessions.map((s) => `${s.start}から${s.end}`).join('、')
        }
      >
        {day.sessions.map((s) => {
          const start = toMinutes(s.start);
          const end = start + s.minutes;
          const tone =
            nowMinutes == null
              ? 'bg-sea'
              : nowMinutes >= end
                ? 'bg-state-closed/40'
                : nowMinutes >= start
                  ? 'bg-state-open'
                  : 'bg-sea';
          return (
            <span
              key={`${day.date}-${String(s.index)}`}
              className={`h-full rounded-full ${tone}`}
              style={{
                gridColumn: `${String(start + 1)} / ${String(Math.min(end, DAY_MINUTES) + 1)}`,
              }}
            />
          );
        })}
        {nowMinutes != null && (
          <span
            className="absolute top-0 h-full w-0.5 bg-foreground"
            style={{ left: `${String((nowMinutes / DAY_MINUTES) * 100)}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {showAxis && (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      )}
    </div>
  );
}
