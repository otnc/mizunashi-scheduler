import {
  MANIFEST_KEY,
  MemoryCache,
  MemoryStorage,
  type ArchiveManifest,
  type Http,
  type HttpResponse,
} from '@mizunashi/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';
import type { AdminDeps } from '../src/routes/admin.js';

const PAGE_URL = 'https://www.city.hakodate.hokkaido.jp/docs/2014041800107/';
const NOW = new Date('2026-07-26T12:00:00+09:00');
const TOKEN = 'test-admin-token';
const SHA = 'b'.repeat(64);

const manifest: ArchiveManifest = {
  schemaVersion: 1,
  entries: [
    {
      sha256: SHA,
      key: `raw/objects/${SHA}.xlsx`,
      fileName: 'mizunashi2026.xlsx',
      format: 'xlsx',
      bytes: 4,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sourceUrl: `${PAGE_URL}file_contents/mizunashi2026.xlsx`,
      label: null,
      firstSeenAt: '2026-07-01T00:00:00.000Z',
      lastSeenAt: '2026-07-20T00:00:00.000Z',
      years: [2026],
      parseStatus: 'ok',
    },
  ],
  lastRunAt: '2026-07-20T00:00:00.000Z',
};

const noopHttp: Http = {
  get(): Promise<HttpResponse> {
    return Promise.resolve({ status: 404, headers: {}, bytes: new Uint8Array() });
  },
};

let storage: MemoryStorage;
let deps: Deps;
let admin: AdminDeps;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  storage = new MemoryStorage();
  await storage.put(MANIFEST_KEY, JSON.stringify(manifest));
  await storage.put(`raw/objects/${SHA}.xlsx`, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  deps = {
    storage,
    cache: new MemoryCache(),
    now: () => NOW,
    pageUrl: PAGE_URL,
    baseUrl: 'https://mizunashi.example.test',
    archivePublic: true,
  };
  admin = { ...deps, http: noopHttp, adminToken: TOKEN };
  app = createApp(deps, admin);
});

const req = async (path: string, init?: RequestInit): Promise<Response> =>
  app.request(`http://localhost${path}`, init);

describe('/archive', () => {
  it('一覧を返す', async () => {
    const res = await req('/archive');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { fileName: string; url: string | null }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      fileName: 'mizunashi2026.xlsx',
      url: '/archive/2026/mizunashi2026.xlsx',
    });
  });

  it('原本を immutable で配信する', async () => {
    const res = await req('/archive/2026/mizunashi2026.xlsx');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('x-content-sha256')).toBe(SHA);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );
  });

  it('存在しない原本は 404', async () => {
    const res = await req('/archive/2020/nope.xlsx');
    expect(res.status).toBe(404);
  });

  it('パストラバーサルを弾く', async () => {
    const res = await req('/archive/2026/..%2F..%2Fderived%2Fv1%2F2026.json');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('/api/v1/admin/ingest', () => {
  it('トークンが無ければ 401', async () => {
    const res = await req('/api/v1/admin/ingest', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('誤ったトークンは 401', async () => {
    const res = await req('/api/v1/admin/ingest', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token-xx' },
    });
    expect(res.status).toBe(401);
  });

  it('管理エンドポイントが無効なら 401', async () => {
    const noAdmin = createApp(deps, { ...admin, adminToken: undefined });
    const res = await noAdmin.request('http://localhost/api/v1/admin/ingest', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it('正しいトークンなら取り込みを実行する', async () => {
    const page = '<h3>2026年</h3><p><a href="file_contents/mizunashi2026.xlsx">2026年</a></p>';
    const http: Http = {
      get(url: string): Promise<HttpResponse> {
        if (url === PAGE_URL) {
          return Promise.resolve({
            status: 200,
            headers: {},
            bytes: new TextEncoder().encode(page),
          });
        }
        // ファイルは壊れたバイト列。取り込みは却下されるが経路は通る
        return Promise.resolve({
          status: 200,
          headers: {},
          bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
        });
      },
    };
    const withPage = createApp(deps, { ...admin, http });
    const res = await withPage.request('http://localhost/api/v1/admin/ingest', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; years: { status: string }[] };
    expect(body.mode).toBe('ingest');
    expect(body.years.some((y) => y.status === 'rejected')).toBe(true);
  });

  it('公式ページを取得できない場合は 503 で内部エラーと区別する', async () => {
    const res = await req('/api/v1/admin/ingest', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { type: string };
    expect(body.type).toContain('data-unavailable');
  });

  it('fromArchive に未知の sha256 を渡すと 404', async () => {
    const res = await req('/api/v1/admin/ingest', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fromArchive: 'c'.repeat(64) }),
    });
    expect(res.status).toBe(404);
  });
});
