import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryCache,
  MemoryStorage,
  ImmutablePrefixError,
  activeYears,
  derivedKey,
  extractDocuments,
  pickForYear,
  readIndex,
  readManifest,
  readYear,
  runIngest,
  type Http,
  type HttpResponse,
} from '../src/index.js';

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');
const PAGE_URL = 'https://www.city.hakodate.hokkaido.jp/docs/2014041800107/';

function fixture(name: string): Uint8Array | null {
  const path = join(FIXTURE_DIR, name);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

const has2026 = fixture('mizunashi2026.xlsx') != null;

/** 公式ページを模したフェイク。外部ネットワークには一切出ない（AGENTS.md §3） */
class FakeHttp implements Http {
  readonly calls: string[] = [];
  constructor(private readonly routes: Record<string, () => HttpResponse>) {}

  get(url: string): Promise<HttpResponse> {
    this.calls.push(url);
    const route = this.routes[url];
    if (!route) return Promise.resolve({ status: 404, headers: {}, bytes: new Uint8Array() });
    return Promise.resolve(route());
  }
}

function html(links: { href: string; text: string; heading?: string }[]): string {
  return links
    .map(
      (l) => `${l.heading ? `<h3>${l.heading}</h3>` : ''}<p><a href="${l.href}">${l.text}</a></p>`,
    )
    .join('\n');
}

function textResponse(body: string): HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    bytes: new TextEncoder().encode(body),
  };
}

function fileResponse(bytes: Uint8Array, contentType: string): HttpResponse {
  return { status: 200, headers: { 'content-type': contentType }, bytes };
}

describe('extractDocuments', () => {
  it('ディレクトリや命名規則によらずドキュメントリンクを拾う', () => {
    const page = html([
      {
        href: 'files/h28mizunashi.csv',
        text: '平成28年 入浴可能時間表',
        heading: '入浴可能時間表【平成28年】',
      },
      {
        href: 'file_contents/mizunashi2026.xlsx',
        text: '2026年 入浴可能時間表',
        heading: '入浴可能時間表【令和8年(2026年)】',
      },
      { href: 'file_contents/mizunashi2026.pdf', text: '2026年 入浴可能時間表' },
      { href: 'https://example.com/other.xlsx', text: '別オリジン' },
      { href: 'index.html', text: 'ドキュメントではない' },
    ]);

    const docs = extractDocuments(page, PAGE_URL);
    expect(docs.map((d) => d.fileName)).toEqual([
      'h28mizunashi.csv',
      'mizunashi2026.xlsx',
      'mizunashi2026.pdf',
    ]);
    expect(docs[1]?.format).toBe('xlsx');
    expect(docs[1]?.yearHints).toContain(2026);
    expect(docs[0]?.yearHints).toContain(2016);
  });

  it('年のヒントが無いリンクも候補に残す', () => {
    // R2.xlsx の中身が 2021 年だった前例があるため、名前で切り捨てない
    const page = html([{ href: 'files/R2.xlsx', text: '入浴可能時間表' }]);
    const docs = extractDocuments(page, PAGE_URL);
    const picked = pickForYear(docs, 2021);
    expect(picked).toHaveLength(1);
  });

  it('機械可読な形式を PDF より優先する', () => {
    const page = html([
      { href: 'f/a2026.pdf', text: '2026年' },
      { href: 'f/a2026.xlsx', text: '2026年' },
    ]);
    const picked = pickForYear(extractDocuments(page, PAGE_URL), 2026);
    expect(picked[0]?.format).toBe('xlsx');
  });
});

describe('MemoryStorage の削除ガード', () => {
  it('raw/ 配下は削除できない', async () => {
    const storage = new MemoryStorage();
    await storage.put('raw/objects/abc.xlsx', new Uint8Array([1]));
    await expect(storage.delete('raw/objects/abc.xlsx')).rejects.toBeInstanceOf(
      ImmutablePrefixError,
    );
    expect(await storage.has('raw/objects/abc.xlsx')).toBe(true);
  });

  it('derived/ は削除できる', async () => {
    const storage = new MemoryStorage();
    await storage.put('derived/v1/2020.json', '{}');
    await storage.delete('derived/v1/2020.json');
    expect(await storage.has('derived/v1/2020.json')).toBe(false);
  });
});

describe('activeYears', () => {
  it('JST の年に基づく', () => {
    // UTC 2026-12-31T15:00Z = JST 2027-01-01T00:00
    expect(activeYears(new Date('2026-12-31T15:00:00Z'))).toEqual([2027, 2028]);
    expect(activeYears(new Date('2026-12-31T14:59:59Z'))).toEqual([2026, 2027]);
  });
});

describe.skipIf(!has2026)('runIngest', () => {
  const bytes2026 = fixture('mizunashi2026.xlsx');
  const NOW = new Date('2026-07-26T17:15:00Z');
  const XLSX_URL = `${PAGE_URL}file_contents/mizunashi2026.xlsx`;
  const PDF_URL = `${PAGE_URL}file_contents/mizunashi2026.pdf`;

  let storage: MemoryStorage;
  let cache: MemoryCache;

  const page = html([
    {
      href: 'file_contents/mizunashi2026.pdf',
      text: '2026年 入浴可能時間表',
      heading: '入浴可能時間表【令和8年(2026年)】',
    },
    { href: 'file_contents/mizunashi2026.xlsx', text: '2026年 入浴可能時間表' },
  ]);

  const makeHttp = (): FakeHttp =>
    new FakeHttp({
      [PAGE_URL]: () => textResponse(page),
      [XLSX_URL]: () =>
        fileResponse(
          bytes2026!,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      [PDF_URL]: () => fileResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'application/pdf'),
    });

  beforeEach(() => {
    storage = new MemoryStorage();
    cache = new MemoryCache();
  });

  it('公式ページから発見して取り込み、派生データを書く', async () => {
    const http = makeHttp();
    const result = await runIngest({ pageUrl: PAGE_URL, storage, cache, http }, NOW);

    // 2027 が未公開なのは 7 月時点では正常。失敗として扱わない
    expect(result.outcome).toBe('ok');
    const y2026 = result.years.find((y) => y.year === 2026);
    expect(y2026).toMatchObject({ status: 'ok', dayCount: 365, complete: true });
    expect(result.years.find((y) => y.year === 2027)).toMatchObject({ status: 'not_published' });

    const schedule = await readYear(storage, 2026);
    expect(schedule?.days).toHaveLength(365);
    expect(schedule?.sources[0]?.sha256).toHaveLength(64);
    expect(schedule?.notes.ja.join('')).toContain('波の高い日');

    // PDF はダウンロードしない。機械可読な候補が先に成功するため
    expect(http.calls).not.toContain(PDF_URL);
  });

  it('原本を内容アドレスで保存し、再実行しても重複しない', async () => {
    await runIngest({ pageUrl: PAGE_URL, storage, cache, http: makeHttp() }, NOW);
    const afterFirst = storage.keys().filter((k) => k.startsWith('raw/objects/'));
    expect(afterFirst).toHaveLength(1);

    const second = await runIngest({ pageUrl: PAGE_URL, storage, cache, http: makeHttp() }, NOW);
    expect(second.years.find((y) => y.year === 2026)?.status).toBe('unchanged');
    expect(storage.keys().filter((k) => k.startsWith('raw/objects/'))).toEqual(afterFirst);

    const manifest = await readManifest(storage);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({ parseStatus: 'ok', years: [2026] });
  });

  it('毎回作り直すので、派生データを消しても次の実行で回復する', async () => {
    await runIngest({ pageUrl: PAGE_URL, storage, cache, http: makeHttp() }, NOW);
    await storage.delete(derivedKey(2026));
    expect(await readYear(storage, 2026)).toBeNull();

    await runIngest({ pageUrl: PAGE_URL, storage, cache, http: makeHttp() }, NOW);
    expect((await readYear(storage, 2026))?.days).toHaveLength(365);
  });

  it('年が変わると前年の派生データだけが消え、原本は残る', async () => {
    await runIngest({ pageUrl: PAGE_URL, storage, cache, http: makeHttp() }, NOW);
    const rawKeys = storage.keys().filter((k) => k.startsWith('raw/'));

    // 2028 年になったとみなす。2026 は activeYears から外れる
    const later = new Date('2028-03-01T00:00:00Z');
    const result = await runIngest({ pageUrl: PAGE_URL, storage, cache, http: makeHttp() }, later);

    expect(result.pruned).toContain(2026);
    expect(await readYear(storage, 2026)).toBeNull();
    expect(storage.keys().filter((k) => k.startsWith('raw/'))).toEqual(rawKeys);

    const index = await readIndex(storage);
    expect(index.years['2026']).toBeUndefined();
  });

  it('機械可読ファイルが無ければ pdf_only として報告する', async () => {
    const pdfOnlyPage = html([
      { href: 'file_contents/mizunashi2026.pdf', text: '2026年 入浴可能時間表' },
    ]);
    const http = new FakeHttp({
      [PAGE_URL]: () => textResponse(pdfOnlyPage),
      [PDF_URL]: () => fileResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'application/pdf'),
    });
    const result = await runIngest({ pageUrl: PAGE_URL, storage, cache, http }, NOW);
    expect(result.years.find((y) => y.year === 2026)).toMatchObject({ status: 'pdf_only' });
    expect(await readYear(storage, 2026)).toBeNull();
  });

  it('壊れたファイルを掴んでも既存データを壊さない', async () => {
    await runIngest({ pageUrl: PAGE_URL, storage, cache, http: makeHttp() }, NOW);
    const before = await readYear(storage, 2026);

    const brokenHttp = new FakeHttp({
      [PAGE_URL]: () => textResponse(page),
      [XLSX_URL]: () =>
        fileResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'application/zip'),
      [PDF_URL]: () => fileResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'application/pdf'),
    });
    const result = await runIngest({ pageUrl: PAGE_URL, storage, cache, http: brokenHttp }, NOW);

    expect(result.years.find((y) => y.year === 2026)?.status).toBe('rejected');
    // 既存の派生データは据え置き
    expect(await readYear(storage, 2026)).toEqual(before);
    // 壊れた原本も保存されている。あとで調査できる
    expect(storage.keys().filter((k) => k.startsWith('raw/objects/'))).toHaveLength(2);
  });
});
