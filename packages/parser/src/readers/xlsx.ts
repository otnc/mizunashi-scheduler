import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { makeCell, type Cell, type Reader, type SourceArtifact, type Table } from './types.js';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ['sheet', 'row', 'c', 'r', 'rPh', 'Relationship'].includes(name),
});

/** ルビ (rPh) を除いた共有文字列。素朴に全 <t> を連結すると「元日ガンジツ」になる（§4.3） */
function sharedStringText(si: unknown): string {
  if (si == null || typeof si !== 'object') return '';
  const node = si as Record<string, unknown>;
  const parts: string[] = [];
  const push = (t: unknown): void => {
    if (typeof t === 'string') parts.push(t);
    else if (t != null && typeof t === 'object') {
      const text = (t as Record<string, unknown>)['#text'];
      if (typeof text === 'string') parts.push(text);
    }
  };
  push(node.t);
  const runs = node.r;
  if (Array.isArray(runs)) for (const run of runs) push((run as Record<string, unknown>).t);
  return parts.join('');
}

/** "AB12" → 27 (0 origin)。列参照が無いセルは呼び出し側で順送りにする */
function columnIndexOf(ref: string | undefined): number | null {
  if (!ref) return null;
  const m = /^([A-Z]+)/.exec(ref);
  if (!m?.[1]) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowIndexOf(ref: string | undefined): number | null {
  if (!ref) return null;
  const m = /(\d+)$/.exec(ref);
  return m?.[1] ? Number(m[1]) - 1 : null;
}

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v != null && typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    if (typeof t === 'string') return t;
  }
  return '';
}

function readSheetTable(name: string, sheetXml: string, shared: readonly string[]): Table {
  const doc = xml.parse(sheetXml) as Record<string, unknown>;
  const worksheet = doc.worksheet as Record<string, unknown> | undefined;
  const sheetData = worksheet?.sheetData as Record<string, unknown> | undefined;
  const rawRows = asArray(sheetData?.row);

  const grid = new Map<number, Map<number, Cell>>();
  let maxCol = -1;

  for (const rawRow of rawRows) {
    const row = rawRow as Record<string, unknown>;
    const rIdx = rowIndexOf(row['@_r'] as string | undefined) ?? grid.size;
    const cells = new Map<number, Cell>();
    let cursor = 0;

    for (const rawCell of asArray(row.c)) {
      const c = rawCell as Record<string, unknown>;
      const idx = columnIndexOf(c['@_r'] as string | undefined) ?? cursor;
      cursor = idx + 1;

      const type = c['@_t'] as string | undefined;
      let value = '';
      if (type === 'inlineStr') {
        const is = c.is as Record<string, unknown> | undefined;
        value = sharedStringText(is);
      } else {
        // 数式セルはキャッシュ値 <v> を使う。数式そのものは評価しない
        const v = textOf(c.v);
        value = type === 's' ? (shared[Number(v)] ?? '') : v;
      }

      if (value !== '') {
        cells.set(idx, makeCell(value));
        if (idx > maxCol) maxCol = idx;
      }
    }
    if (cells.size > 0) grid.set(rIdx, cells);
  }

  const maxRow = grid.size === 0 ? -1 : Math.max(...grid.keys());
  const rows: Cell[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const src = grid.get(r);
    const row: Cell[] = [];
    for (let c = 0; c <= maxCol; c++) row.push(src?.get(c) ?? makeCell(''));
    rows.push(row);
  }
  return { name, rows };
}

export const xlsxReader: Reader = {
  id: 'xlsx',

  sniff(artifact: SourceArtifact): number {
    const b = artifact.bytes;
    if (b.length < 4 || !ZIP_MAGIC.every((v, i) => b[i] === v)) return 0;
    // zip のセントラルディレクトリに OOXML 固有のパスが平文で現れる。
    // .ods など他の zip 系形式と取り違えないための判別。
    const head = strFromU8(b.subarray(0, Math.min(b.length, 8192)), true);
    const tail = strFromU8(b.subarray(Math.max(0, b.length - 65536)), true);
    return head.includes('xl/') || tail.includes('xl/workbook.xml') ? 0.95 : 0.2;
  },

  read(artifact: SourceArtifact): Table[] {
    const files = unzipSync(artifact.bytes);
    const get = (path: string): string | null => {
      const f = files[path];
      return f ? strFromU8(f) : null;
    };

    const workbookXml = get('xl/workbook.xml');
    if (workbookXml == null) throw new Error('xl/workbook.xml が見つかりません');

    const shared: string[] = [];
    const sharedXml = get('xl/sharedStrings.xml');
    if (sharedXml != null) {
      const parsed = xml.parse(sharedXml) as Record<string, unknown>;
      const sst = parsed.sst as Record<string, unknown> | undefined;
      for (const si of asArray(sst?.si)) shared.push(sharedStringText(si));
    }

    // r:id → ファイルパス。sheetN.xml の N を月番号とみなしてはいけない（§4.3）
    const relTargets = new Map<string, string>();
    const relsXml = get('xl/_rels/workbook.xml.rels');
    if (relsXml != null) {
      const parsed = xml.parse(relsXml) as Record<string, unknown>;
      const rels = (parsed.Relationships as Record<string, unknown> | undefined)?.Relationship;
      for (const rel of asArray(rels)) {
        const r = rel as Record<string, unknown>;
        const id = r['@_Id'];
        const target = r['@_Target'];
        if (typeof id === 'string' && typeof target === 'string') relTargets.set(id, target);
      }
    }

    const wb = xml.parse(workbookXml) as Record<string, unknown>;
    const workbook = wb.workbook as Record<string, unknown> | undefined;
    const sheetsNode = workbook?.sheets as Record<string, unknown> | undefined;

    const tables: Table[] = [];
    // workbook.xml の出現順が表示順。sheetId は順序と無関係
    for (const rawSheet of asArray(sheetsNode?.sheet)) {
      const sheet = rawSheet as Record<string, unknown>;
      const name =
        typeof sheet['@_name'] === 'string' ? sheet['@_name'] : `sheet${String(tables.length + 1)}`;
      const rid = sheet['@_r:id'];
      const target = typeof rid === 'string' ? relTargets.get(rid) : undefined;
      if (target == null) continue;

      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      const sheetXml = get(path);
      if (sheetXml == null) continue;

      tables.push(readSheetTable(name, sheetXml, shared));
    }

    if (tables.length === 0) throw new Error('シートを 1 つも読み取れませんでした');
    return tables;
  },
};

/** date1904 系のブックかどうか。日付シリアル値の解釈に使う */
export function usesDate1904(artifact: SourceArtifact): boolean {
  try {
    const files = unzipSync(artifact.bytes);
    const wb = files['xl/workbook.xml'];
    return wb ? /date1904="(1|true)"/.test(strFromU8(wb)) : false;
  } catch {
    return false;
  }
}
