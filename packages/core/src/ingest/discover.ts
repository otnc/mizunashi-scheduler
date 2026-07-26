import { readYearCandidates } from '@mizunashi/parser';
import type { Http } from '../storage.js';

export type DocumentFormat = 'xlsx' | 'xls' | 'csv' | 'pdf' | 'other';

export interface DiscoveredDocument {
  url: string;
  fileName: string;
  format: DocumentFormat;
  /** リンクテキスト */
  label: string;
  /** 直前の見出し。年の弱いヒントになる */
  heading: string | null;
  /** 年の候補。あくまで優先順位付けに使い、対象年はパース結果で確定する */
  yearHints: number[];
}

const DOC_EXT = /\.(xlsx|xlsm|xls|csv|pdf)$/i;

/** 機械可読な形式を優先する。PDF は保存するがパースしない（DESIGN.md §8.8） */
const FORMAT_PRIORITY: Record<DocumentFormat, number> = {
  xlsx: 4,
  csv: 3,
  xls: 2,
  pdf: 1,
  other: 0,
};

export class PageStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageStructureError';
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function formatOf(pathname: string): DocumentFormat {
  const m = DOC_EXT.exec(pathname);
  const ext = m?.[1]?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'xls') return 'xls';
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

/**
 * ページ内のドキュメントリンクをすべて抽出する。
 * ディレクトリ（files/ → file_contents/）も命名規則も年ごとに変わるため、
 * 場所や名前で絞り込まず、拡張子と同一オリジンだけで判定する（DESIGN.md §4.4.2）。
 */
export function extractDocuments(html: string, pageUrl: string): DiscoveredDocument[] {
  const origin = new URL(pageUrl).origin;
  const headings = [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => ({
    index: m.index,
    text: stripTags(m[1] ?? ''),
  }));

  const docs: DiscoveredDocument[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1] ?? '');
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!DOC_EXT.test(url.pathname)) continue;
    if (seen.has(url.toString())) continue;
    seen.add(url.toString());

    const label = stripTags(m[2] ?? '');
    const heading = headings.filter((h) => h.index < m.index).at(-1)?.text ?? null;
    const fileName = decodeURIComponent(url.pathname.split('/').pop() ?? '');

    docs.push({
      url: url.toString(),
      fileName,
      format: formatOf(url.pathname),
      label,
      heading,
      yearHints: [
        ...new Set([
          ...readYearCandidates(label),
          ...readYearCandidates(heading ?? ''),
          ...readYearCandidates(fileName),
        ]),
      ].sort(),
    });
  }

  return docs;
}

export interface DiscoverResult {
  documents: DiscoveredDocument[];
  html: string;
}

export async function discoverDocuments(http: Http, pageUrl: string): Promise<DiscoverResult> {
  const res = await http.get(pageUrl);
  if (res.status !== 200) {
    throw new PageStructureError(`公式ページの取得に失敗しました: HTTP ${String(res.status)}`);
  }
  const html = new TextDecoder().decode(res.bytes);
  return { documents: extractDocuments(html, pageUrl), html };
}

/**
 * その年の候補として最も適したものを選ぶ。
 * 年のヒントが無いリンクも候補に残す。名前と中身が一致しない前例があるため、
 * ヒントだけで切り捨てず、機械可読な形式を優先して順に試す。
 */
export function pickForYear(
  documents: readonly DiscoveredDocument[],
  year: number,
): DiscoveredDocument[] {
  const scored = documents
    .filter((d) => d.format !== 'other')
    .map((d) => ({
      doc: d,
      matches: d.yearHints.includes(year),
      hasHint: d.yearHints.length > 0,
    }))
    .filter((s) => s.matches || !s.hasHint);

  return scored
    .sort((a, b) => {
      if (a.matches !== b.matches) return a.matches ? -1 : 1;
      return FORMAT_PRIORITY[b.doc.format] - FORMAT_PRIORITY[a.doc.format];
    })
    .map((s) => s.doc);
}
