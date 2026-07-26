import type {
  MetaResponse,
  PeriodResponse,
  ProblemDetails,
  StatusResponse,
  YearsResponse,
} from '@mizunashi/api-types';

export type * from '@mizunashi/api-types';

export const DEFAULT_BASE_URL = 'https://mizunashi.otnc.dev';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ClientOptions {
  baseUrl?: string;
  /** 差し替え可能。Workers / Deno / テストのフェイクをそのまま渡せる */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 出典を辿れるようにするため、利用側の連絡先を入れることを推奨する */
  userAgent?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** 'none' を渡すと現在時刻に依存する relative を省いた静的レスポンスになる */
  at?: Date | 'none';
  lang?: 'ja' | 'en';
}

/** 受信時刻を添えて返す。meta.servedAt がキャッシュ由来で古い場合の基準になる */
export interface Received<T> {
  data: T;
  /** クライアントの時計で記録した受信時刻 */
  receivedAt: string;
  /** HTTP の Age ヘッダ。共有キャッシュを経由していなければ null */
  ageSeconds: number | null;
}

export class MizunashiApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly detail: string | undefined;
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null, fallback: string) {
    super(problem?.detail ?? problem?.title ?? fallback);
    this.name = 'MizunashiApiError';
    this.status = status;
    this.type = problem?.type ?? 'about:blank';
    this.detail = problem?.detail;
    this.problem = problem;
  }
}

/**
 * 薄い fetch ラッパー。状態管理・リトライ戦略・永続キャッシュ・日時整形は持たない。
 * 利用者ごとに要件が違い、薄さという価値を壊すため（DESIGN.md §11.8）。
 */
export class MizunashiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #userAgent: string | undefined;

  constructor(options: ClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#userAgent = options.userAgent;
  }

  status(options: RequestOptions & { upcoming?: number } = {}): Promise<Received<StatusResponse>> {
    const query = toQuery(options);
    if (options.upcoming != null) query.set('upcoming', String(options.upcoming));
    return this.#request<StatusResponse>('/api/v1/status', query, options.signal);
  }

  /** date は "YYYY-MM-DD" / "today" / "tomorrow" */
  day(date: string, options: RequestOptions = {}): Promise<Received<PeriodResponse>> {
    return this.#period(`/api/v1/days/${encodeURIComponent(date)}`, options);
  }

  /** 指定日を起点とする 7 日間。暦週に丸めない */
  week(date: string, options: RequestOptions = {}): Promise<Received<PeriodResponse>> {
    return this.#period(`/api/v1/weeks/${encodeURIComponent(date)}`, options);
  }

  /** 1 日から最終日まで */
  month(
    year: number,
    month: number,
    options: RequestOptions = {},
  ): Promise<Received<PeriodResponse>> {
    const key = `${String(year)}-${String(month).padStart(2, '0')}`;
    return this.#period(`/api/v1/months/${key}`, options);
  }

  year(year: number | 'current', options: RequestOptions = {}): Promise<Received<PeriodResponse>> {
    return this.#period(`/api/v1/years/${String(year)}`, options);
  }

  range(from: string, to: string, options: RequestOptions = {}): Promise<Received<PeriodResponse>> {
    const query = toQuery(options);
    query.set('from', from);
    query.set('to', to);
    return this.#request<PeriodResponse>('/api/v1/days', query, options.signal);
  }

  years(options: RequestOptions = {}): Promise<Received<YearsResponse>> {
    return this.#request<YearsResponse>('/api/v1/years', toQuery(options), options.signal);
  }

  meta(options: RequestOptions = {}): Promise<Received<MetaResponse>> {
    return this.#request<MetaResponse>('/api/v1/meta', toQuery(options), options.signal);
  }

  #period(path: string, options: RequestOptions): Promise<Received<PeriodResponse>> {
    return this.#request<PeriodResponse>(path, toQuery(options), options.signal);
  }

  async #request<T>(
    path: string,
    query: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<Received<T>> {
    const qs = query.toString();
    const url = `${this.#baseUrl}${path}${qs === '' ? '' : `?${qs}`}`;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    signal?.addEventListener('abort', () => {
      controller.abort();
    });

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.#userAgent != null) headers['user-agent'] = this.#userAgent;

    try {
      const res = await this.#fetch(url, { headers, signal: controller.signal });
      const receivedAt = new Date().toISOString();
      const ageHeader = res.headers.get('age');
      const ageSeconds = ageHeader == null ? null : Number(ageHeader);

      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new MizunashiApiError(res.status, body as ProblemDetails | null, res.statusText);
      }
      return {
        data: body as T,
        receivedAt,
        ageSeconds: ageSeconds != null && Number.isFinite(ageSeconds) ? ageSeconds : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function toQuery(options: RequestOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.at === 'none') query.set('at', 'none');
  else if (options.at instanceof Date) query.set('at', options.at.toISOString());
  if (options.lang != null) query.set('lang', options.lang);
  return query;
}
