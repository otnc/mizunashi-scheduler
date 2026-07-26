import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { MetaResponse, YearsResponse } from '@mizunashi/api-types';
import {
  activeYears,
  addDays,
  buildIcs,
  calendarGrid,
  daysInMonth,
  jstDateKey,
  monthRange,
  weekRange,
  yearRange,
  type PeriodRange,
} from '@mizunashi/core';
import { loadData, type Deps, type LoadedData } from './deps.js';
import { ApiProblem } from './errors.js';
import { buildMeta } from './meta.js';
import { buildPeriodResponse, buildStatusResponse } from './responses.js';
import { FACILITY } from './facility.js';
import { archiveRoutes } from './routes/archive.js';
import { adminRoutes, type AdminDeps } from './routes/admin.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MAX_RANGE_DAYS = 400;

/**
 * 現在時刻に依存する値を含むレスポンスは共有キャッシュに載せない。
 * servedAt だけでなく endsInSeconds のような相対値まで古くなるため（ADR-021）。
 */
const NO_STORE = 'no-store';
const STATIC_CACHE = 'public, max-age=3600, s-maxage=86400';

function parseAt(raw: string | undefined, now: Date): Date | null {
  if (raw === 'none') return null;
  if (raw == null || raw === '') return now;
  // タイムゾーン省略時は JST とみなす
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}+09:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiProblem('invalid-parameter', `at を日時として解釈できません: ${raw}`, [
      { path: 'at', message: 'invalid datetime' },
    ]);
  }
  return parsed;
}

function parseLang(raw: string | undefined): 'ja' | 'en' {
  return raw === 'en' ? 'en' : 'ja';
}

/** "today" / "tomorrow" / "YYYY-MM-DD" を解決する */
function resolveDate(raw: string, now: Date): string {
  if (raw === 'today') return jstDateKey(now);
  if (raw === 'tomorrow') return addDays(jstDateKey(now), 1);
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new ApiProblem('invalid-parameter', `日付として解釈できません: ${raw}`, [
      { path: 'date', message: 'expected YYYY-MM-DD, today or tomorrow' },
    ]);
  }
  return raw;
}

/** 提供範囲を超える移動先は null にする。フロントの前後ボタンの活性判定に使える */
function navTarget(path: string, available: boolean): string | null {
  return available ? path : null;
}

function coversAny(data: LoadedData, range: PeriodRange): boolean {
  const c = data.calendar.coverage();
  return c != null && range.from <= c.to && range.to >= c.from;
}

export function createApp(deps: Deps, admin?: AdminDeps): Hono {
  const app = new Hono();

  app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));

  // 管理系は CORS を許可しない。認証を通す経路をブラウザから叩かせる必要がない
  if (admin != null) app.route('/', adminRoutes(admin));
  // 原本配信は既定でオフ。無効時は経路自体を生やさず 404 にする
  if (deps.archivePublic) app.route('/', archiveRoutes(deps));

  app.onError((err, c) => {
    const now = deps.now();
    const problem =
      err instanceof ApiProblem
        ? err
        : new ApiProblem('internal-error', '予期しないエラーが発生しました');
    // データを読めていない場合でも meta の骨格は返す
    const meta = buildMeta([], deps.pageUrl, now);
    c.header('cache-control', NO_STORE);
    return c.json(
      problem.toResponse(deps.baseUrl, new URL(c.req.url).pathname, meta),
      problem.status as 400,
      { 'content-type': 'application/problem+json; charset=utf-8' },
    );
  });

  app.notFound((c) => {
    const problem = new ApiProblem('not-found', 'エンドポイントが見つかりません');
    const meta = buildMeta([], deps.pageUrl, deps.now());
    c.header('cache-control', NO_STORE);
    return c.json(problem.toResponse(deps.baseUrl, new URL(c.req.url).pathname, meta), 404, {
      'content-type': 'application/problem+json; charset=utf-8',
    });
  });

  app.get('/api/v1/healthz', async (c) => {
    const now = deps.now();
    const data = await loadData(deps);
    const [current] = activeYears(now);
    const hasCurrent = data.years.some((y) => y.year === current);
    c.header('cache-control', NO_STORE);
    return c.json({
      status: hasCurrent ? 'ok' : 'degraded',
      checks: {
        currentYearData: hasCurrent ? 'ok' : 'missing',
        activeYears: data.years.map((y) => y.year),
        lastRunAt: data.index.lastRun?.at ?? null,
        archivePublic: deps.archivePublic,
      },
    });
  });

  app.get('/api/v1/status', async (c) => {
    const now = deps.now();
    const at = parseAt(c.req.query('at'), now) ?? now;
    const upcoming = Number(c.req.query('upcoming') ?? '5');
    if (!Number.isInteger(upcoming) || upcoming < 0 || upcoming > 30) {
      throw new ApiProblem('invalid-parameter', 'upcoming は 0〜30 の整数で指定してください');
    }
    const data = await loadData(deps);
    c.header('cache-control', NO_STORE);
    return c.json(
      buildStatusResponse(data, at, parseLang(c.req.query('lang')), deps.pageUrl, now, upcoming),
    );
  });

  app.get('/api/v1/days/:date', async (c) => {
    const now = deps.now();
    const date = resolveDate(c.req.param('date'), now);
    const at = parseAt(c.req.query('at'), now);
    const data = await loadData(deps);
    const range = { from: date, to: date };

    return respondPeriod(c, data, {
      scope: 'day',
      range,
      navigation: {
        prev: navTarget(`/api/v1/days/${addDays(date, -1)}`, coversAny(data, dayRangeOf(date, -1))),
        next: navTarget(`/api/v1/days/${addDays(date, 1)}`, coversAny(data, dayRangeOf(date, 1))),
        current: '/api/v1/days/today',
      },
      at,
      lang: parseLang(c.req.query('lang')),
    });
  });

  app.get('/api/v1/weeks/:date', async (c) => {
    const now = deps.now();
    const date = resolveDate(c.req.param('date'), now);
    const align = c.req.query('align') === 'calendar' ? 'calendar' : 'anchor';
    const range = weekRange(date, align);
    const at = parseAt(c.req.query('at'), now);
    const data = await loadData(deps);

    return respondPeriod(c, data, {
      scope: 'week',
      range,
      navigation: {
        prev: navTarget(
          `/api/v1/weeks/${addDays(date, -7)}`,
          coversAny(data, weekRange(addDays(date, -7), align)),
        ),
        next: navTarget(
          `/api/v1/weeks/${addDays(date, 7)}`,
          coversAny(data, weekRange(addDays(date, 7), align)),
        ),
        current: '/api/v1/weeks/today',
      },
      at,
      lang: parseLang(c.req.query('lang')),
    });
  });

  app.get('/api/v1/months/:month', async (c) => {
    const now = deps.now();
    const raw = c.req.param('month');
    const key = raw === 'current' ? jstDateKey(now).slice(0, 7) : raw;
    const m = MONTH_RE.exec(key);
    if (!m?.[1] || !m[2] || Number(m[2]) < 1 || Number(m[2]) > 12) {
      throw new ApiProblem('invalid-parameter', `月として解釈できません: ${raw}`, [
        { path: 'month', message: 'expected YYYY-MM or current' },
      ]);
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const range = monthRange(year, month);
    const at = parseAt(c.req.query('at'), now);
    const data = await loadData(deps);

    const prevYm = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const nextYm = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    const fmt = (v: { y: number; m: number }): string =>
      `${String(v.y)}-${String(v.m).padStart(2, '0')}`;

    const body = buildPeriodResponse(
      data,
      {
        scope: 'month',
        range,
        navigation: {
          prev: navTarget(
            `/api/v1/months/${fmt(prevYm)}`,
            coversAny(data, monthRange(prevYm.y, prevYm.m)),
          ),
          next: navTarget(
            `/api/v1/months/${fmt(nextYm)}`,
            coversAny(data, monthRange(nextYm.y, nextYm.m)),
          ),
          current: '/api/v1/months/current',
        },
        at,
        lang: parseLang(c.req.query('lang')),
      },
      deps.pageUrl,
      now,
    );

    c.header('cache-control', at == null ? STATIC_CACHE : NO_STORE);
    if (c.req.query('grid') === '1') {
      const weekStart = c.req.query('weekStart') === '1' ? 1 : 0;
      return c.json({ ...body, calendarGrid: calendarGrid(year, month, weekStart) });
    }
    return c.json(body);
  });

  app.get('/api/v1/years', async (c) => {
    const now = deps.now();
    const data = await loadData(deps);
    const [current] = activeYears(now);

    const body: YearsResponse = {
      activeYears: data.years.map((y) => y.year),
      current,
      years: data.years.map((y) => ({
        year: y.year,
        coverage: y.coverage,
        dayCount: y.days.length,
        complete: y.complete,
        fetchedAt: y.sources.at(-1)?.fetchedAt ?? y.generatedAt,
      })),
      archivedOnly: [],
      meta: buildMeta(data.years, deps.pageUrl, now),
    };
    c.header('cache-control', 'public, max-age=300, s-maxage=3600');
    return c.json(body);
  });

  app.get('/api/v1/years/:year', async (c) => {
    const now = deps.now();
    const raw = c.req.param('year');
    const year = raw === 'current' ? activeYears(now)[0] : Number(raw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new ApiProblem('invalid-parameter', `年として解釈できません: ${raw}`);
    }
    const data = await loadData(deps);
    if (!data.years.some((y) => y.year === year)) {
      // 提供対象は今年と来年のみ（§3.4）
      const served = data.years.map((y) => String(y.year)).join(', ');
      const hint = deps.archivePublic ? ' 原本は /archive から取得できます。' : '';
      throw new ApiProblem(
        'year-not-available',
        `${String(year)} 年は提供対象外です。提供しているのは ${served} です。${hint}`,
      );
    }

    const at = parseAt(c.req.query('at'), now);
    return respondPeriod(c, data, {
      scope: 'year',
      range: yearRange(year),
      navigation: {
        prev: navTarget(
          `/api/v1/years/${String(year - 1)}`,
          data.years.some((y) => y.year === year - 1),
        ),
        next: navTarget(
          `/api/v1/years/${String(year + 1)}`,
          data.years.some((y) => y.year === year + 1),
        ),
        current: '/api/v1/years/current',
      },
      at,
      lang: parseLang(c.req.query('lang')),
    });
  });

  app.get('/api/v1/days', async (c) => {
    const now = deps.now();
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (from == null || to == null || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new ApiProblem('invalid-parameter', 'from と to を YYYY-MM-DD で指定してください');
    }
    const span = Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    );
    if (span < 0) throw new ApiProblem('invalid-parameter', 'to は from 以降にしてください');
    if (span + 1 > MAX_RANGE_DAYS) {
      throw new ApiProblem(
        'invalid-parameter',
        `期間が長すぎます。${String(MAX_RANGE_DAYS)} 日以内にしてください`,
        [{ path: 'to', message: 'range too large' }],
      );
    }

    const at = parseAt(c.req.query('at'), now);
    const data = await loadData(deps);
    return respondPeriod(c, data, {
      scope: 'range',
      range: { from, to },
      navigation: { prev: null, next: null, current: '/api/v1/days' },
      at,
      lang: parseLang(c.req.query('lang')),
    });
  });

  app.get('/api/v1/calendar.ics', async (c) => {
    const now = deps.now();
    const data = await loadData(deps);

    const yearParam = c.req.query('year');
    const years = yearParam == null ? data.years.map((y) => y.year) : [Number(yearParam)];
    if (years.some((y) => !Number.isInteger(y))) {
      throw new ApiProblem('invalid-parameter', `年として解釈できません: ${String(yearParam)}`);
    }

    const alarmRaw = c.req.query('alarm');
    const alarm = alarmRaw == null ? null : Number(alarmRaw);
    if (alarm != null && (!Number.isInteger(alarm) || alarm < 0 || alarm > 1440)) {
      throw new ApiProblem('invalid-parameter', 'alarm は 0〜1440 の整数で指定してください');
    }

    const days = data.years.filter((y) => years.includes(y.year)).flatMap((y) => y.days);
    if (days.length === 0) {
      throw new ApiProblem('year-not-available', '該当する年のデータがありません');
    }

    const lang = parseLang(c.req.query('lang'));
    const body = buildIcs(days, {
      calendarName: lang === 'en' ? 'Mizunashi Kaihin Onsen' : '水無海浜温泉 入浴可能時間',
      domain: new URL(deps.baseUrl).host,
      alarmMinutes: alarm,
      lang,
      location: '北海道函館市恵山岬町',
      url: deps.baseUrl,
      now,
    });

    c.header('content-type', 'text/calendar; charset=utf-8');
    c.header('content-disposition', 'inline; filename="mizunashi.ics"');
    c.header('cache-control', 'public, max-age=3600, s-maxage=21600');
    return c.body(body);
  });

  app.get('/api/v1/meta', async (c) => {
    const now = deps.now();
    const data = await loadData(deps);
    const [current] = activeYears(now);
    const coverage = data.calendar.coverage();

    const body: MetaResponse = {
      facility: FACILITY,
      data: {
        activeYears: data.years.map((y) => y.year),
        nextYearPublished: data.years.some((y) => y.year > current),
        coverage,
        lastCheckedAt: data.index.lastRun?.at ?? null,
        retentionPolicy: deps.archivePublic
          ? '今年と来年の時間表のみ提供します。原本ファイルは /archive で永続的に公開しています。'
          : '今年と来年の時間表のみ提供します。原本ファイルは保管していますが公開していません。',
      },
      attribution: {
        source: '函館市公式ホームページ',
        sourceUrl: deps.pageUrl,
        disclaimer:
          '本サイトは函館市が公開している資料をもとに作成した非公式の情報提供サービスです。入浴可能時間は潮位表に基づく目安であり、荒天や高波などにより入浴できない場合があります。',
      },
      notes: { ja: data.calendar.notes('ja'), en: data.calendar.notes('en') },
      meta: buildMeta(data.years, deps.pageUrl, now),
    };
    c.header('cache-control', 'public, max-age=300, s-maxage=3600');
    return c.json(body);
  });

  function respondPeriod(
    c: Context,
    data: LoadedData,
    options: Parameters<typeof buildPeriodResponse>[1],
  ): Response {
    const now = deps.now();
    c.header('cache-control', options.at == null ? STATIC_CACHE : NO_STORE);
    return c.json(buildPeriodResponse(data, options, deps.pageUrl, now));
  }

  return app;
}

function dayRangeOf(date: string, offset: number): PeriodRange {
  const d = addDays(date, offset);
  return { from: d, to: d };
}

export { daysInMonth };
