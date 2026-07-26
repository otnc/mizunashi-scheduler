import type { DaySchedule, Session, YearSchedule } from '@mizunashi/schema';
import { describe, expect, it } from 'vitest';
import {
  CalendarView,
  activeYears,
  calendarGrid,
  computeStatus,
  daysInMonth,
  monthRange,
  summarize,
  weekRange,
} from '../src/index.js';

function session(index: number, start: string, end: string): Session {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return {
    index,
    start,
    end,
    minutes: eh! * 60 + em! - (sh! * 60 + sm!),
    crossesMidnight: false,
  };
}

function day(date: string, sessions: Session[], holiday: string | null = null): DaySchedule {
  const total = sessions.reduce((s, x) => s + x.minutes, 0);
  const gaps: number[] = [];
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1]!;
    const cur = sessions[i]!;
    const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    gaps.push(toMin(cur.start) - toMin(prev.end));
  }
  return {
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    holiday: holiday == null ? null : { ja: holiday, en: null },
    sessions,
    summary: {
      firstStart: sessions[0]?.start ?? null,
      lastEnd: sessions[sessions.length - 1]?.end ?? null,
      totalMinutes: total,
      sessionCount: sessions.length,
      longestMinutes: sessions.reduce((m, s) => Math.max(m, s.minutes), 0),
      gaps,
    },
  };
}

function year(y: number, days: DaySchedule[]): YearSchedule {
  return {
    schemaVersion: 1,
    year: y,
    timezone: 'Asia/Tokyo',
    generatedAt: '2026-01-01T00:00:00.000Z',
    coverage: { from: days[0]!.date, to: days[days.length - 1]!.date },
    complete: false,
    maxSessionsPerDay: days.reduce((m, d) => Math.max(m, d.sessions.length), 0),
    sources: [
      {
        pageUrl: 'https://example.test/',
        fileUrl: null,
        fileName: 'test.xlsx',
        label: null,
        sha256: null,
        bytes: 1,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        archiveKey: null,
      },
    ],
    notes: { ja: ['波の高い日は入浴できません'], en: [] },
    days,
  };
}

/** 2026-01-05 は 10:00-11:00 と 20:00-21:00 の 2 回（実データと同じ構成） */
const CAL = new CalendarView([
  year(2026, [
    day('2026-01-04', [session(1, '19:00', '21:00')]),
    day('2026-01-05', [session(1, '10:00', '11:00'), session(2, '20:00', '21:00')]),
    day('2026-01-06', [session(1, '10:00', '12:00'), session(2, '21:00', '22:00')]),
  ]),
]);

const at = (iso: string): Date => new Date(iso);

describe('computeStatus の境界', () => {
  it.each([
    ['2026-01-05T09:59:59+09:00', 'closed'],
    ['2026-01-05T10:00:00+09:00', 'open'],
    ['2026-01-05T10:59:59+09:00', 'open'],
    // 終了ちょうどは closed。区間は [start, end) （ADR-007）
    ['2026-01-05T11:00:00+09:00', 'closed'],
  ] as const)('%s は %s', (iso, state) => {
    expect(computeStatus(at(iso), CAL).state).toBe(state);
  });

  it('TZ に関わらず同じ結果になる', () => {
    const utc = computeStatus(new Date('2026-01-05T01:30:00Z'), CAL);
    expect(utc.state).toBe('open');
    expect(utc.current?.start).toBe('10:00');
  });
});

describe('1 日複数セッション', () => {
  it('谷の時間帯では今日まだ入れると分かる', () => {
    const r = computeStatus(at('2026-01-05T12:30:00+09:00'), CAL);
    expect(r.state).toBe('closed');
    expect(r.remainingCountToday).toBe(1);
    expect(r.endedCountToday).toBe(1);
    expect(r.nextToday?.start).toBe('20:00');
    // 日をまたがない
    expect(r.next?.date).toBe('2026-01-05');
  });

  it('本日終了後は nextToday が null で、next は翌日', () => {
    const r = computeStatus(at('2026-01-05T22:00:00+09:00'), CAL);
    expect(r.remainingCountToday).toBe(0);
    expect(r.endedCountToday).toBe(2);
    expect(r.nextToday).toBeNull();
    expect(r.next?.date).toBe('2026-01-06');
  });

  it('初回前は endedCountToday が 0 で「本日終了」と区別できる', () => {
    const r = computeStatus(at('2026-01-05T06:00:00+09:00'), CAL);
    expect(r.endedCountToday).toBe(0);
    expect(r.remainingCountToday).toBe(2);
    expect(r.nextToday?.start).toBe('10:00');
  });

  it('進行中のセッションに index / ofDay が付く', () => {
    const r = computeStatus(at('2026-01-05T10:30:00+09:00'), CAL);
    expect(r.current).toMatchObject({ index: 1, ofDay: 2, status: 'ongoing' });
    expect(r.nextToday).toMatchObject({ index: 2, ofDay: 2, status: 'upcoming' });
  });

  it('残り時間と開始までの秒数が正しい', () => {
    const r = computeStatus(at('2026-01-05T10:30:00+09:00'), CAL);
    expect(r.current?.endsInSeconds).toBe(30 * 60);
    expect(r.current?.startsInSeconds).toBe(-30 * 60);
    expect(r.nextToday?.startsInSeconds).toBe(9 * 3600 + 30 * 60);
  });

  it('終了 60 分以内で closingSoon になる', () => {
    expect(computeStatus(at('2026-01-05T10:30:00+09:00'), CAL).closingSoon).toBe(true);
    expect(computeStatus(at('2026-01-06T10:30:00+09:00'), CAL).closingSoon).toBe(false);
  });
});

describe('境界ケース', () => {
  it('収録範囲外は unknown', () => {
    const r = computeStatus(at('2026-03-01T12:00:00+09:00'), CAL);
    expect(r.state).toBe('unknown');
  });

  it('翌年データが無ければ理由コードが付く', () => {
    const r = computeStatus(at('2026-01-06T23:00:00+09:00'), CAL);
    expect(r.next).toBeNull();
    expect(r.nextUnavailableReason).toBe('no_data_for_next_year');
  });

  it('翌年データがあれば年をまたいで次を返す', () => {
    const cal = new CalendarView([
      year(2026, [day('2026-12-31', [session(1, '10:00', '11:00')])]),
      year(2027, [day('2027-01-01', [session(1, '17:00', '19:00')])]),
    ]);
    const r = computeStatus(at('2026-12-31T23:00:00+09:00'), cal);
    expect(r.next?.date).toBe('2027-01-01');
    expect(r.nextUnavailableReason).toBeNull();
  });
});

describe('期間の範囲計算', () => {
  it('week は指定日を起点とする 7 日間（暦週に丸めない）', () => {
    expect(weekRange('2026-07-26')).toEqual({ from: '2026-07-26', to: '2026-08-01' });
    expect(weekRange('2026-07-29')).toEqual({ from: '2026-07-29', to: '2026-08-04' });
  });

  it('align=calendar なら月曜始まりに丸める', () => {
    // 2026-07-26 は日曜
    expect(weekRange('2026-07-26', 'calendar')).toEqual({ from: '2026-07-20', to: '2026-07-26' });
  });

  it('month は 1 日から最終日まで（うるう年対応）', () => {
    expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(daysInMonth(2028, 2)).toBe(29);
  });

  it('月グリッドの先頭が空セルで埋まる', () => {
    // 2026-07-01 は水曜 (3)
    const grid = calendarGrid(2026, 7);
    expect(grid.firstWeekday).toBe(3);
    expect(grid.weeks[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(grid.weeks[0]?.[3]).toBe('2026-07-01');
    expect(grid.weeks.flat().filter((d) => d != null)).toHaveLength(31);
  });
});

describe('期間サマリ', () => {
  it('合計はセッションの合計であって firstStart〜lastEnd の幅ではない', () => {
    const days = [day('2026-01-05', [session(1, '10:00', '11:00'), session(2, '20:00', '21:00')])];
    const s = summarize(days, { from: '2026-01-05', to: '2026-01-05' });
    expect(s.totalMinutes).toBe(120);
    expect(s.earliestStart).toBe('10:00');
    expect(s.latestEnd).toBe('21:00');
    expect(s.sessionCountDistribution).toEqual({ '2': 1 });
    expect(s.maxSessionsPerDay).toBe(2);
  });

  it('欠けている日を missingDays として数える', () => {
    const s = summarize([day('2026-01-05', [session(1, '10:00', '11:00')])], {
      from: '2026-01-05',
      to: '2026-01-11',
    });
    expect(s.missingDays).toBe(6);
  });
});

describe('activeYears', () => {
  it('JST の年に基づく', () => {
    expect(activeYears(new Date('2026-12-31T15:00:00Z'))).toEqual([2027, 2028]);
  });
});
