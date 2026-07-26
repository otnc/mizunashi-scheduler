import { cellAt, cellLines, type Cell, type Table } from './readers/types.js';
import type { Structure } from './locate/index.js';
import { readDate, readWeekday, type DateReading } from './recognize/date.js';

export interface RawSlot {
  ordinal: number;
  start: Cell;
  end: Cell;
}

export interface RawEntry {
  /** 表の中での位置。診断メッセージに使う */
  rowIndex: number;
  date: DateReading | null;
  /** 原本が持つ曜日。年の交差検証に使う（DESIGN.md §8.4） */
  weekday: number | null;
  slots: RawSlot[];
  noteJa: string | null;
  noteEn: string | null;
}

/** ブロック内の各行から、指定列のセルを取り出す */
function blockCells(table: Table, top: number, stride: number, col: number): Cell[] {
  const out: Cell[] = [];
  for (let r = top; r < top + stride; r++) out.push(cellAt(table.rows, r, col));
  return out;
}

/**
 * ブロック内の該当列にある文言を、行とセル内改行の両方から平坦に集める。
 * xlsx は日本語と英語が別の行、CSV は 1 セル 2 行という違いをここで吸収する。
 */
function textLines(cells: Cell[]): string[] {
  const out: string[] = [];
  for (const cell of cells) for (const line of cellLines(cell)) out.push(line.text);
  return out;
}

export function extractEntries(table: Table, structure: Structure): RawEntry[] {
  const { dataStart, stride, dateCol, weekdayCol, noteCol, sessions } = structure;
  const entries: RawEntry[] = [];

  for (let top = dataStart; top < table.rows.length; top += stride) {
    const dateCells = blockCells(table, top, stride, dateCol);
    const merged = mergeDateReadings(dateCells);
    if (!merged) continue;

    const weekday =
      weekdayCol == null
        ? null
        : firstNonNull(blockCells(table, top, stride, weekdayCol).map(readWeekday));

    const slots: RawSlot[] = [];
    for (const s of sessions) {
      const start = firstNonEmpty(blockCells(table, top, stride, s.start));
      const end = firstNonEmpty(blockCells(table, top, stride, s.end));
      slots.push({ ordinal: s.ordinal, start, end });
    }

    let noteJa: string | null = null;
    let noteEn: string | null = null;
    if (noteCol != null) {
      const lines = textLines(blockCells(table, top, stride, noteCol));
      noteJa = lines[0] ?? null;
      noteEn = lines[1] ?? null;
    }

    entries.push({ rowIndex: top, date: merged, weekday, slots, noteJa, noteEn });
  }

  return entries;
}

function mergeDateReadings(cells: Cell[]): DateReading | null {
  const merged: DateReading = {};
  let found = false;
  for (const cell of cells) {
    const r = readDate(cell);
    if (!r) continue;
    found = true;
    if (merged.month == null && r.month != null) merged.month = r.month;
    if (merged.day == null && r.day != null) merged.day = r.day;
    if (merged.year == null && r.year != null) merged.year = r.year;
    if (merged.serial == null && r.serial != null) merged.serial = r.serial;
  }
  return found ? merged : null;
}

function firstNonEmpty(cells: Cell[]): Cell {
  return cells.find((c) => c.text !== '') ?? cells[0] ?? { raw: '', text: '', numeric: null };
}

function firstNonNull<T>(values: (T | null)[]): T | null {
  return values.find((v) => v != null) ?? null;
}
