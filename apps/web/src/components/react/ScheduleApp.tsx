import { useEffect, useMemo, useState } from 'react';
import type { DaySchedule } from '@mizunashi/api-types';
import {
  loadSchedule,
  statusAt,
  daysBetween,
  jstDateKey,
  type ScheduleData,
} from '../../lib/schedule';
import { dayTotalLabel, formatDate, formatDuration, headline } from '../../lib/format';
import { DayDetailPopover } from './DayDetailPopover';
import { DayTimeline } from './DayTimeline';
import { SessionList } from './SessionList';

type Tab = 'today' | 'week' | 'month';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: '今日・明日' },
  { id: 'week', label: '週間' },
  { id: 'month', label: '月間' },
];

/** 30 秒ごとに再計算する。1 秒ごとだと読み上げが洪水になる（NFR-06） */
const TICK_MS = 30_000;

/**
 * オフラインでも判定は端末側の時計と保存済みの年間データで正しく行える。
 * 古い判定結果を見せているわけではないので、その旨だけ伝えて機能は止めない。
 */
function useOnline(): boolean {
  // ビルド時のプリレンダリングでは navigator がない
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const update = (): void => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

export function ScheduleApp() {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>('today');
  const online = useOnline();

  useEffect(() => {
    const controller = new AbortController();
    loadSchedule(controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(String(err));
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      // 非表示のときは再計算しない
      if (document.visibilityState === 'visible') setNow(new Date());
    }, TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  const status = useMemo(() => (data == null ? null : statusAt(data, now)), [data, now]);

  if (error != null) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        {online
          ? 'データを取得できませんでした。時間をおいて再度お試しください。'
          : 'オフラインで、保存済みの時間表もありません。通信できる場所で一度開いてください。'}
      </p>
    );
  }
  if (data == null || status == null) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" aria-label="読み込み中" />;
  }

  const today = jstDateKey(now);
  const line = headline(status);
  const toneClass =
    line.tone === 'open'
      ? 'border-state-open bg-state-open-subtle'
      : line.tone === 'soon'
        ? 'border-state-soon bg-state-soon-subtle'
        : 'border-border bg-card';

  return (
    <div className="space-y-6">
      {!online && (
        <p className="rounded-lg border border-border bg-muted p-3 text-sm" role="status">
          オフラインです。保存済みの時間表をもとに、端末の時計で判定しています。
        </p>
      )}

      <section
        className={`rounded-lg border-2 p-5 sm:p-6 ${toneClass}`}
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden="true">{status.state === 'open' ? '●' : '○'}</span>
          {status.state === 'open' ? 'いま入れます' : 'いまは入れません'}
        </p>
        <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums sm:text-4xl">
          {line.title}
        </p>
        {status.current != null && (
          <p className="mt-1 text-lg tabular-nums">
            あと {formatDuration(status.current.endsInSeconds)}
          </p>
        )}
        {line.detail != null && line.detail !== '' && (
          <p className="mt-2 text-sm text-muted-foreground">{line.detail}</p>
        )}
      </section>

      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="表示の切替">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'today' && <TodayTomorrow data={data} today={today} now={now} status={status} />}
      {tab === 'week' && <WeekView data={data} from={today} now={now} />}
      {tab === 'month' && <MonthView data={data} today={today} now={now} />}
    </div>
  );
}

function nowMinutesFor(date: string, today: string, now: Date): number | null {
  if (date !== today) return null;
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

function TodayTomorrow({
  data,
  today,
  now,
  status,
}: {
  data: ScheduleData;
  today: string;
  now: Date;
  status: ReturnType<typeof statusAt>;
}) {
  const days = daysBetween(data, today, 2);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {days.map((day, i) => (
        <article key={day.date} className="rounded-lg border border-border bg-card p-4">
          <header className="mb-2 flex items-baseline justify-between">
            <h3 className="font-semibold">
              {i === 0 ? '今日' : '明日'} {formatDate(day.date)}
            </h3>
            <span className="text-xs text-muted-foreground">{dayTotalLabel(day)}</span>
          </header>
          <SessionList day={day} {...(i === 0 ? { resolved: status.todaySessions } : {})} />
          <div className="mt-3">
            <DayTimeline day={day} nowMinutes={nowMinutesFor(day.date, today, now)} showAxis />
          </div>
        </article>
      ))}
      {days.length === 0 && <p className="text-sm text-muted-foreground">データがありません</p>}
    </div>
  );
}

function WeekView({ data, from, now }: { data: ScheduleData; from: string; now: Date }) {
  const [anchor, setAnchor] = useState(from);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const days = daysBetween(data, anchor, 7);
  const shift = (delta: number): void => {
    setAnchor(
      new Date(Date.parse(`${anchor}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10),
    );
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="rounded-md px-3 py-1 text-sm hover:bg-muted"
          onClick={() => {
            shift(-7);
          }}
        >
          ◀ 前の7日
        </button>
        <span className="text-sm font-medium">{formatDate(anchor)} から7日間</span>
        <button
          type="button"
          className="rounded-md px-3 py-1 text-sm hover:bg-muted"
          onClick={() => {
            shift(7);
          }}
        >
          次の7日 ▶
        </button>
      </div>
      <ul className="space-y-2">
        {days.map((day) => (
          <li key={day.date}>
            <DayDetailPopover
              day={day}
              align="left"
              open={openDate === day.date}
              onOpenChange={(v) => {
                setOpenDate(v ? day.date : null);
              }}
            >
              <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3">
                <span className="text-sm tabular-nums">{formatDate(day.date)}</span>
                <DayTimeline day={day} nowMinutes={nowMinutesFor(day.date, from, now)} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {dayTotalLabel(day)}
                </span>
              </div>
            </DayDetailPopover>
          </li>
        ))}
      </ul>
      {days.length === 0 && (
        <p className="text-sm text-muted-foreground">この期間のデータはありません</p>
      )}
    </section>
  );
}

function MonthView({ data, today, now }: { data: ScheduleData; today: string; now: Date }) {
  const [ym, setYm] = useState(() => ({
    y: Number(today.slice(0, 4)),
    m: Number(today.slice(5, 7)),
  }));
  const [openDate, setOpenDate] = useState<string | null>(null);
  const first = `${String(ym.y)}-${String(ym.m).padStart(2, '0')}-01`;
  const total = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
  const days = daysBetween(data, first, total);
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay();

  const shift = (delta: number): void => {
    const m = ym.m + delta;
    setYm(m < 1 ? { y: ym.y - 1, m: 12 } : m > 12 ? { y: ym.y + 1, m: 1 } : { y: ym.y, m });
  };
  const canGo = (delta: number): boolean => {
    const m = ym.m + delta;
    const target = m < 1 ? { y: ym.y - 1, m: 12 } : m > 12 ? { y: ym.y + 1, m: 1 } : { y: ym.y, m };
    return data.calendar.covers(`${String(target.y)}-${String(target.m).padStart(2, '0')}-01`);
  };

  const byDate = new Map(days.map((d) => [d.date, d]));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          disabled={!canGo(-1)}
          className="rounded-md px-3 py-1 text-sm hover:bg-muted disabled:opacity-40"
          onClick={() => {
            shift(-1);
          }}
        >
          ◀
        </button>
        <span className="text-sm font-medium">
          {ym.y}年{ym.m}月
        </span>
        <button
          type="button"
          disabled={!canGo(1)}
          className="rounded-md px-3 py-1 text-sm hover:bg-muted disabled:opacity-40"
          onClick={() => {
            shift(1);
          }}
        >
          ▶
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {['日', '月', '火', '水', '木', '金', '土'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`pad-${String(i)}`} />
        ))}
        {Array.from({ length: total }, (_, i) => {
          const date = `${String(ym.y)}-${String(ym.m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
          const day: DaySchedule | undefined = byDate.get(date);
          const column = (offset + i) % 7;
          const cellContent = (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-xs tabular-nums">{i + 1}</span>
                {day != null && day.sessions.length > 1 && (
                  <span className="text-[10px] text-muted-foreground">{day.sessions.length}回</span>
                )}
              </div>
              {/* セル内に時刻文字列を入れない。狭い幅で必ず破綻する（DESIGN.md §12.4） */}
              {day != null && (
                <div className="mt-1">
                  <DayTimeline day={day} nowMinutes={nowMinutesFor(date, today, now)} />
                </div>
              )}
            </>
          );
          return (
            <div
              key={date}
              className={`rounded-md border p-1 ${date === today ? 'border-primary' : 'border-border'}`}
            >
              {day == null ? (
                cellContent
              ) : (
                <DayDetailPopover
                  day={day}
                  align={column === 0 ? 'left' : column === 6 ? 'right' : 'center'}
                  open={openDate === date}
                  onOpenChange={(v) => {
                    setOpenDate(v ? date : null);
                  }}
                >
                  {cellContent}
                </DayDetailPopover>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
