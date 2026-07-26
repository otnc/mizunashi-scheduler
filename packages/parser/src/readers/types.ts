/**
 * 容器（xlsx / csv / …）を共通の表構造に落とすための型。
 * これ以降の処理は元がどの形式だったかを一切知らない（DESIGN.md §8.10.2）。
 */

export interface Cell {
  /** 正規化前の生の値 */
  readonly raw: string;
  /** NFKC 正規化 + ルビ除去 + 前後の空白除去 */
  readonly text: string;
  /** 数値として解釈できる場合のみ */
  readonly numeric: number | null;
}

export interface Table {
  /** シート名 / ファイル名。月の推定に使うことがある */
  readonly name: string;
  readonly rows: readonly (readonly Cell[])[];
}

export interface SourceArtifact {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly contentType: string | null;
  /** 公式ページのリンクテキスト。年の推定の弱いヒントになる */
  readonly linkLabel: string | null;
}

export interface Reader {
  readonly id: string;
  /** この入力を扱えるかを 0..1 で返す。副作用なし・例外を投げない */
  sniff(artifact: SourceArtifact): number;
  read(artifact: SourceArtifact): Table[];
}

export const EMPTY_CELL: Cell = { raw: '', text: '', numeric: null };

export function makeCell(raw: string): Cell {
  const text = raw.normalize('NFKC').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  const numeric = text !== '' && /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  return { raw, text, numeric };
}

export function cellAt(rows: readonly (readonly Cell[])[], r: number, c: number): Cell {
  return rows[r]?.[c] ?? EMPTY_CELL;
}

/**
 * セル内の行を個別のセルとして取り出す。
 * CSV では日英併記が 1 セル 2 行で入っており、xlsx では 2 行に分かれている（§4.4.3）。
 * 認識器はこれを通すことで両方の持ち方を区別せずに扱える。
 */
export function cellLines(cell: Cell): Cell[] {
  if (cell.text === '') return [];
  if (!cell.text.includes('\n')) return [cell];
  return cell.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(makeCell);
}
