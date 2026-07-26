import { MemoryCache, MemoryStorage, derivedKey, INDEX_KEY, type Storage } from '@mizunashi/core';
import {
  PeriodResponse,
  ProblemDetails,
  StatusResponse,
  YearsResponse,
  MetaResponse,
} from '@mizunashi/schema';
import type { DaySchedule, Session, YearSchedule } from '@mizunashi/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';

const PAGE_URL = 'https://www.city.hakodate.hokkaido.jp/docs/2014041800107/';
const BASE_URL = 'https://mizunashi.example.test';
const NOW = new Date('2026-01-05T12:30:00+09:00');

function session(index: number, start: string, end: string): Session {
  const min = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return { index, start, end, minutes: min(end) - min(start), crossesMidnight: false };
}

function day(date: string, sessions: Session[]): DaySchedule {
  const gaps: number[] = [];
  const min = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  for (let i = 1; i < sessions.length; i++) {
    gaps.push(min(sessions[i]!.start) - min(sessions[i - 1]!.end));
  }
  return {
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    holiday: null,
    sessions,
    summary: {
      firstStart: sessions[0]?.start ?? null,
      lastEnd: sessions.at(-1)?.end ?? null,
      totalMinutes: sessions.reduce((s, x) => s + x.minutes, 0),
      sessionCount: sessions.length,
      longestMinutes: sessions.reduce((m, s) => Math.max(m, s.minutes), 0),
      gaps,
    },
  };
}

/** 2026-01-01 〜 01-31。1/5 は 10:00-11:00 と 20:00-21:00 の 2 回 */
function makeYear(): YearSchedule {
  const days: DaySchedule[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-01-${String(d).padStart(2, '0')}`;
    days.push(
      d === 5
        ? day(date, [session(1, '10:00', '11:00'), session(2, '20:00', '21:00')])
        : day(date, [session(1, '09:00', '12:00')]),
    );
  }
  return {
    schemaVersion: 1,
    year: 2026,
    timezone: 'Asia/Tokyo',
    generatedAt: '2026-01-01T00:00:00.000Z',
    coverage: { from: '2026-01-01', to: '2026-01-31' },
    complete: false,
    maxSessionsPerDay: 2,
    sources: [
      {
        pageUrl: PAGE_URL,
        fileUrl: `${PAGE_URL}file_contents/mizunashi2026.xlsx`,
        fileName: 'mizunashi2026.xlsx',
        label: null,
        sha256: 'a'.repeat(64),
        bytes: 157084,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        archiveKey: 'raw/objects/aaa.xlsx',
      },
    ],
    notes: { ja: ['波の高い日は入浴できません'], en: ['Do not bathe when waves are high.'] },
    days,
  };
}

async function seed(storage: Storage): Promise<void> {
  await storage.put(derivedKey(2026), JSON.stringify(makeYear()));
  await storage.put(
    INDEX_KEY,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeYears: [2026],
      years: {},
      lastRun: { at: '2026-01-01T00:00:00.000Z', outcome: 'ok', pruned: [], notPublished: [2027] },
    }),
  );
}

let deps: Deps;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const storage = new MemoryStorage();
  await seed(storage);
  deps = {
    storage,
    cache: new MemoryCache(),
    now: () => NOW,
    pageUrl: PAGE_URL,
    baseUrl: BASE_URL,
    archivePublic: false,
  };
  app = createApp(deps);
});

const get = async (path: string): Promise<Response> => app.request(`http://localhost${path}`);

describe('meta', () => {
  it('すべての成功レスポンスに meta が付く', async () => {
    for (const path of [
      '/api/v1/status',
      '/api/v1/days/2026-01-05',
      '/api/v1/weeks/2026-01-05',
      '/api/v1/months/2026-01',
      '/api/v1/years/2026',
      '/api/v1/years',
      '/api/v1/meta',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as { meta?: unknown };
      expect(body.meta, path).toBeDefined();
    }
  });

  it('取得日と配信日、経過秒を返す', async () => {
    const body = (await (await get('/api/v1/status')).json()) as StatusResponse;
    expect(body.meta.servedAt).toBe(NOW.toISOString());
    expect(body.meta.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
    // 2026-01-01T00:00Z から 2026-01-05T03:30Z までの秒数
    expect(body.meta.dataAgeSeconds).toBe(4 * 86400 + 3 * 3600 + 30 * 60);
    expect(body.meta.source.years).toEqual([
      { year: 2026, fetchedAt: '2026-01-01T00:00:00.000Z', sha256: 'a'.repeat(64) },
    ]);
  });

  it('エラーレスポンスにも meta が付く', async () => {
    const res = await get('/api/v1/days/not-a-date');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = (await res.json()) as ProblemDetails;
    expect(body.meta).toBeDefined();
    expect(ProblemDetails.safeParse(body).success).toBe(true);
  });
});

describe('契約（実レスポンスが Zod 定義を満たす）', () => {
  it.each([
    ['/api/v1/status', StatusResponse],
    ['/api/v1/days/2026-01-05', PeriodResponse],
    ['/api/v1/weeks/2026-01-05', PeriodResponse],
    ['/api/v1/months/2026-01', PeriodResponse],
    ['/api/v1/years/2026', PeriodResponse],
    ['/api/v1/years', YearsResponse],
    ['/api/v1/meta', MetaResponse],
  ] as const)('%s', async (path, schema) => {
    const body: unknown = await (await get(path)).json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) console.error(path, parsed.error.issues.slice(0, 5));
    expect(parsed.success).toBe(true);
  });
});

describe('/status', () => {
  it('谷の時間帯では今日まだ入れると分かる', async () => {
    const body = (await (await get('/api/v1/status')).json()) as StatusResponse;
    expect(body.state).toBe('closed');
    expect(body.remainingCountToday).toBe(1);
    expect(body.endedCountToday).toBe(1);
    expect(body.nextToday?.start).toBe('20:00');
    expect(body.next?.date).toBe('2026-01-05');
  });

  it('at で任意の時刻を指定できる', async () => {
    const body = (await (
      await get('/api/v1/status?at=2026-01-05T10:30:00%2B09:00')
    ).json()) as StatusResponse;
    expect(body.state).toBe('open');
    expect(body.current).toMatchObject({ index: 1, ofDay: 2, status: 'ongoing' });
  });

  it('現在時刻に依存するので共有キャッシュしない', async () => {
    expect((await get('/api/v1/status')).headers.get('cache-control')).toBe('no-store');
  });
});

describe('期間ビュー', () => {
  it('week は指定日を起点とする 7 日間', async () => {
    const body = (await (await get('/api/v1/weeks/2026-01-05')).json()) as PeriodResponse;
    expect(body.range).toEqual({ from: '2026-01-05', to: '2026-01-11' });
    expect(body.days).toHaveLength(7);
    expect(body.scope).toBe('week');
  });

  it('month は 1 日から最終日まで', async () => {
    const body = (await (await get('/api/v1/months/2026-01')).json()) as PeriodResponse;
    expect(body.range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(body.days).toHaveLength(31);
    expect(body.summary.sessionCountDistribution).toEqual({ '1': 30, '2': 1 });
  });

  it('提供範囲の端では navigation が null になる', async () => {
    const body = (await (await get('/api/v1/months/2026-01')).json()) as PeriodResponse;
    expect(body.navigation.prev).toBeNull();
    expect(body.navigation.next).toBeNull();
  });

  it('grid=1 で月グリッドを返す', async () => {
    const body = (await (await get('/api/v1/months/2026-01?grid=1')).json()) as PeriodResponse & {
      calendarGrid: { firstWeekday: number };
    };
    // 2026-01-01 は木曜
    expect(body.calendarGrid.firstWeekday).toBe(4);
  });

  it('at=none なら relative を省き、共有キャッシュ可能になる', async () => {
    const res = await get('/api/v1/months/2026-01?at=none');
    expect(res.headers.get('cache-control')).toContain('s-maxage');
    const body = (await res.json()) as PeriodResponse;
    expect(body.relative).toBeNull();
  });

  it('at 指定時は relative が付き、共有キャッシュしない', async () => {
    const res = await get('/api/v1/days/2026-01-05');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as PeriodResponse;
    expect(body.relative?.nextToday?.start).toBe('20:00');
    // openFrom は日をまたいで探すが、この時刻では同日に残りがある
    expect(body.relative?.openFrom?.date).toBe('2026-01-05');
  });

  it('today / tomorrow を解決できる', async () => {
    const today = (await (await get('/api/v1/days/today')).json()) as PeriodResponse;
    expect(today.range.from).toBe('2026-01-05');
    const tomorrow = (await (await get('/api/v1/days/tomorrow')).json()) as PeriodResponse;
    expect(tomorrow.range.from).toBe('2026-01-06');
  });

  it('収録範囲を外れる分は partial として示す', async () => {
    const body = (await (await get('/api/v1/weeks/2026-01-29')).json()) as PeriodResponse;
    expect(body.partial).toBe(true);
    expect(body.days).toHaveLength(3);
    expect(body.summary.missingDays).toBe(4);
  });
});

describe('エラー', () => {
  it('提供対象外の年は year-not-available', async () => {
    const res = await get('/api/v1/years/2020');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ProblemDetails;
    expect(body.type).toContain('year-not-available');
    expect(body.detail).toContain('2026');
  });

  it('原本配信が無効なら /archive は 404', async () => {
    for (const path of ['/archive', '/archive/2026/mizunashi2026.xlsx']) {
      const res = await get(path);
      expect(res.status).toBe(404);
      const body = (await res.json()) as ProblemDetails;
      expect(body.type).toContain('not-found');
    }
  });

  it('期間が長すぎる場合は 400', async () => {
    const res = await get('/api/v1/days?from=2026-01-01&to=2028-01-01');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ProblemDetails;
    expect(body.errors?.[0]?.path).toBe('to');
  });

  it('未知のパスは 404 で problem+json', async () => {
    const res = await get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('problem+json');
  });
});

describe('/calendar.ics', () => {
  it('iCalendar を返す', async () => {
    const res = await get('/api/v1/calendar.ics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('TZID:Asia/Tokyo');
    // 1/5 は 2 回あるので VEVENT は 32 件（30日×1 + 1日×2）
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(32);
  });

  it('alarm を指定すると VALARM が付く', async () => {
    const body = await (await get('/api/v1/calendar.ics?alarm=30')).text();
    expect(body).toContain('TRIGGER:-PT30M');
  });

  it('提供対象外の年は 404', async () => {
    expect((await get('/api/v1/calendar.ics?year=2020')).status).toBe(404);
  });

  it('alarm が範囲外なら 400', async () => {
    expect((await get('/api/v1/calendar.ics?alarm=9999')).status).toBe(400);
  });
});

describe('/healthz', () => {
  it('当年データがあれば ok', async () => {
    const body = (await (await get('/api/v1/healthz')).json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('当年データが無ければ degraded', async () => {
    const empty = createApp({ ...deps, storage: new MemoryStorage() });
    const res = await empty.request('http://localhost/api/v1/healthz');
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('degraded');
  });
});
