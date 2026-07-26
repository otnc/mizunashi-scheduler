import { makeCell, type Cell, type Reader, type SourceArtifact, type Table } from './types.js';

/**
 * RFC 4180 準拠の CSV 読み取り。引用フィールド内の改行を保持する
 * （日英併記が 1 セル 2 行で入っているため。§4.4.3）。
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i] ?? '';
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      i++;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * 文字コードの判定。UTF-8 として厳密に妥当なら UTF-8、そうでなければ Shift_JIS とみなす。
 * Shift_JIS のバイト列は UTF-8 検証にほぼ確実に失敗するため、この順序で判別できる。
 */
function decode(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // 実行環境が shift_jis を持たない場合は置換文字混じりの utf-8 で続行する。
    // 読めた範囲でパースを試み、破綻すればバリデーションゲートが止める。
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

const TEXT_LIKE = /^[\t\r\n\x20-\x7e\u00a0-\uffff]*$/;

export const csvReader: Reader = {
  id: 'csv',

  sniff(artifact: SourceArtifact): number {
    const b = artifact.bytes;
    if (b.length === 0) return 0;
    // 制御文字が多いバイナリを除外する
    let control = 0;
    const limit = Math.min(b.length, 4096);
    for (let i = 0; i < limit; i++) {
      const v = b[i] ?? 0;
      if (v < 0x09 || (v > 0x0d && v < 0x20)) control++;
    }
    if (control / limit > 0.02) return 0;

    const sample = decode(b.subarray(0, Math.min(b.length, 8192)));
    if (!TEXT_LIKE.test(sample)) return 0;
    const commas = (sample.match(/,/g) ?? []).length;
    return commas >= 5 ? 0.8 : 0.3;
  },

  read(artifact: SourceArtifact): Table[] {
    const rows = parseCsv(decode(artifact.bytes));
    const maxCol = rows.reduce((max, r) => Math.max(max, r.length), 0);
    const cells: Cell[][] = rows.map((r) => {
      const out: Cell[] = [];
      for (let c = 0; c < maxCol; c++) out.push(makeCell(r[c] ?? ''));
      return out;
    });
    return [{ name: artifact.fileName, rows: cells }];
  },
};
