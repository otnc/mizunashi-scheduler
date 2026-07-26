import { describe, expect, it } from 'vitest';
import { MizunashiApiError, MizunashiClient } from '../src/index.js';

const BASE = 'https://example.test';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function fakeFetch(handler: (url: string) => Response): typeof fetch {
  return (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url));
  };
}

describe('MizunashiClient', () => {
  it('エンドポイントごとに正しい URL を組み立てる', async () => {
    const seen: string[] = [];
    const client = new MizunashiClient({
      baseUrl: BASE,
      fetch: fakeFetch((url) => {
        seen.push(url);
        return jsonResponse({});
      }),
    });

    await client.status();
    await client.day('2026-07-26');
    await client.day('today');
    await client.week('today');
    await client.month(2026, 7);
    await client.year('current');
    await client.range('2026-07-26', '2026-08-01');
    await client.years();

    expect(seen).toEqual([
      `${BASE}/api/v1/status`,
      `${BASE}/api/v1/days/2026-07-26`,
      `${BASE}/api/v1/days/today`,
      `${BASE}/api/v1/weeks/today`,
      `${BASE}/api/v1/months/2026-07`,
      `${BASE}/api/v1/years/current`,
      `${BASE}/api/v1/days?from=2026-07-26&to=2026-08-01`,
      `${BASE}/api/v1/years`,
    ]);
  });

  it('at=none を渡すと静的バリアントを要求する', async () => {
    let seen = '';
    const client = new MizunashiClient({
      baseUrl: BASE,
      fetch: fakeFetch((url) => {
        seen = url;
        return jsonResponse({});
      }),
    });
    await client.month(2026, 7, { at: 'none', lang: 'en' });
    expect(seen).toBe(`${BASE}/api/v1/months/2026-07?at=none&lang=en`);
  });

  it('受信時刻と Age を添えて返す', async () => {
    const client = new MizunashiClient({
      baseUrl: BASE,
      fetch: fakeFetch(() => jsonResponse({ state: 'open' }, { headers: { age: '42' } })),
    });
    const res = await client.status();
    expect(res.data).toEqual({ state: 'open' });
    expect(res.ageSeconds).toBe(42);
    expect(Date.parse(res.receivedAt)).not.toBeNaN();
  });

  it('Age が無ければ null', async () => {
    const client = new MizunashiClient({
      baseUrl: BASE,
      fetch: fakeFetch(() => jsonResponse({})),
    });
    expect((await client.status()).ageSeconds).toBeNull();
  });

  it('problem+json を型付きエラーとして投げる', async () => {
    const problem = {
      type: 'https://example.test/errors/invalid-parameter',
      title: 'Invalid parameter',
      status: 400,
      detail: '`to` must be within 400 days of `from`.',
    };
    const client = new MizunashiClient({
      baseUrl: BASE,
      fetch: fakeFetch(() => jsonResponse(problem, { status: 400 })),
    });

    await expect(client.range('2026-01-01', '2028-01-01')).rejects.toThrowError(MizunashiApiError);
    await client.range('2026-01-01', '2028-01-01').catch((err: unknown) => {
      expect(err).toBeInstanceOf(MizunashiApiError);
      const e = err as MizunashiApiError;
      expect(e.status).toBe(400);
      expect(e.type).toBe(problem.type);
      expect(e.detail).toBe(problem.detail);
    });
  });

  it('JSON でないエラー本文でも落ちない', async () => {
    const client = new MizunashiClient({
      baseUrl: BASE,
      fetch: fakeFetch(() => new Response('<html>502</html>', { status: 502 })),
    });
    await expect(client.status()).rejects.toBeInstanceOf(MizunashiApiError);
  });

  it('末尾スラッシュ付きの baseUrl を正規化する', async () => {
    let seen = '';
    const client = new MizunashiClient({
      baseUrl: `${BASE}/`,
      fetch: fakeFetch((url) => {
        seen = url;
        return jsonResponse({});
      }),
    });
    await client.status();
    expect(seen).toBe(`${BASE}/api/v1/status`);
  });
});
