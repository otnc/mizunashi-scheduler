import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/openapi/document.js';
import { MemoryCache, MemoryStorage } from '@mizunashi/core';
import { createApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';

const BASE_URL = 'https://mizunashi.example.test';

function collectRefs(node: unknown, refs: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return;
  }
  if (node != null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') refs.add(value);
      else collectRefs(value, refs);
    }
  }
}

/** JSON Pointer（"#/a/b/c"）を辿って解決できるか確かめる */
function resolves(doc: Record<string, unknown>, ref: string): boolean {
  if (!ref.startsWith('#/')) return false;
  let node: unknown = doc;
  for (const segment of ref.slice(2).split('/')) {
    if (node == null || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[segment];
  }
  return node != null;
}

describe('openapi document', () => {
  const doc = buildOpenApiDocument(BASE_URL) as Record<string, unknown>;

  it('JSON として往復できる', () => {
    expect(() => {
      JSON.parse(JSON.stringify(doc));
    }).not.toThrow();
  });

  it('すべての $ref が文書内で解決できる（自己参照ループが残っていないこと）', () => {
    const refs = new Set<string>();
    collectRefs(doc, refs);
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(resolves(doc, ref), `unresolved $ref: ${ref}`).toBe(true);
    }
  });

  it('components.schemas の各スキーマが実体を持つ（$ref だけの空殻でない）', () => {
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    for (const [name, schema] of Object.entries(schemas)) {
      const keys = Object.keys(schema as Record<string, unknown>);
      expect(keys, `${name} が $ref だけになっている`).not.toEqual(['$ref']);
    }
  });

  it('主要なレスポンス型がすべて components.schemas にある', () => {
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    for (const name of [
      'PeriodResponse',
      'StatusResponse',
      'YearsResponse',
      'MetaResponse',
      'ProblemDetails',
    ]) {
      expect(schemas).toHaveProperty(name);
    }
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('現在時刻に依存しないので静的にキャッシュ可能で、有効な文書を返す', async () => {
    const deps: Deps = {
      storage: new MemoryStorage(),
      cache: new MemoryCache(),
      now: () => new Date('2026-07-26T12:00:00+09:00'),
      pageUrl: 'https://www.city.hakodate.hokkaido.jp/docs/2014041800107/',
      baseUrl: BASE_URL,
      archivePublic: false,
    };
    const app = createApp(deps);
    const res = await app.request(`${BASE_URL}/api/v1/openapi.json`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).not.toBe('no-store');
    const body = (await res.json()) as { openapi: string; servers: { url: string }[] };
    expect(body.openapi).toBe('3.0.3');
    expect(body.servers[0]?.url).toBe(BASE_URL);
  });
});

describe('GET /api/v1/docs', () => {
  it('Swagger UI の HTML を返す', async () => {
    const deps: Deps = {
      storage: new MemoryStorage(),
      cache: new MemoryCache(),
      now: () => new Date('2026-07-26T12:00:00+09:00'),
      pageUrl: 'https://www.city.hakodate.hokkaido.jp/docs/2014041800107/',
      baseUrl: BASE_URL,
      archivePublic: false,
    };
    const app = createApp(deps);
    const res = await app.request(`${BASE_URL}/api/v1/docs`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).not.toBe('no-store');
  });
});
