import { cellAt, type Cell, type Table } from '../readers/types.js';
import { isDateLike, isWeekdayLike } from '../recognize/date.js';
import { isTimeLike } from '../recognize/time.js';
import { TOLERANCE } from '../tolerance.js';
import { VOCAB, matchesAny, sessionOrdinalOf, vocabKey } from '../vocabulary.js';

export interface SessionColumns {
  ordinal: number;
  start: number;
  end: number;
}

export interface Structure {
  /** データ行の開始位置 */
  dataStart: number;
  /** 1 日あたりの行数。格子形式は 2、フラット形式は 1 */
  stride: number;
  dateCol: number;
  weekdayCol: number | null;
  noteCol: number | null;
  /** 備考 / 祝日 など、原本の見出し文字列をそのまま保持する */
  noteLabel: string | null;
  sessions: SessionColumns[];
  /** ヘッダを見つけられず形状推論に落ちたか */
  inferredByShape: boolean;
}

function columnCount(table: Table): number {
  return table.rows.reduce((max, r) => Math.max(max, r.length), 0);
}

/** 行を語彙と突き合わせ、ヘッダらしさを点数化する */
function headerScore(row: readonly Cell[]): number {
  let score = 0;
  for (const cell of row) {
    if (cell.text === '') continue;
    if (matchesAny(cell.text, VOCAB.date)) score++;
    else if (matchesAny(cell.text, VOCAB.note)) score++;
    else if (sessionOrdinalOf(cell.text) != null) score++;
    else if (matchesAny(cell.text, VOCAB.weekday)) score++;
  }
  return score;
}

/**
 * ヘッダ行を探す。日本語行と英語行が続く場合は連結して 1 つのヘッダとして扱う。
 * 位置ではなく語彙で見つけるため、列がずれても行が増えても追随する（DESIGN.md §8.10.3）。
 */
function findHeader(table: Table): { rows: number[]; merged: string[] } | null {
  const limit = Math.min(table.rows.length, 40);
  let best = { index: -1, score: 0 };
  for (let r = 0; r < limit; r++) {
    const score = headerScore(table.rows[r] ?? []);
    if (score > best.score) best = { index: r, score };
  }
  if (best.index < 0 || best.score < TOLERANCE.headerMinMatches) return null;

  const rows = [best.index];
  const next = table.rows[best.index + 1];
  if (next && headerScore(next) >= 1) rows.push(best.index + 1);

  const cols = columnCount(table);
  const merged: string[] = [];
  for (let c = 0; c < cols; c++) {
    merged.push(
      rows
        .map((r) => cellAt(table.rows, r, c).text)
        .filter((t) => t !== '')
        .join(' '),
    );
  }
  return { rows, merged };
}

/**
 * 列ごとに「値が入っているセルのうち、述語を満たす割合」を出す。
 * 全行に対する割合にすると、1 日 2 行の格子形式では空行に薄められて閾値を割ってしまう。
 */
function ratioByColumn(
  table: Table,
  from: number,
  to: number,
  predicate: (cell: Cell) => boolean,
): number[] {
  const cols = columnCount(table);
  const matched = new Array<number>(cols).fill(0);
  const filled = new Array<number>(cols).fill(0);

  for (let r = from; r < to; r++) {
    const row = table.rows[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      const cell = row[c];
      if (!cell || cell.text === '') continue;
      filled[c] = (filled[c] ?? 0) + 1;
      if (predicate(cell)) matched[c] = (matched[c] ?? 0) + 1;
    }
  }

  return matched.map((n, i) => {
    const total = filled[i] ?? 0;
    // 数件しか値がない列はたまたま一致しただけの可能性があるため採用しない
    return total < TOLERANCE.minColumnSamples ? 0 : n / total;
  });
}

/** 見出しセルの位置で列を区切り、各区画に役割を与える */
function regionsOf(merged: string[]): { start: number; end: number; label: string }[] {
  const marks: number[] = [];
  merged.forEach((text, i) => {
    if (text !== '') marks.push(i);
  });
  return marks.map((start, i) => ({
    start,
    end: (marks[i + 1] ?? merged.length) - 1,
    label: merged[start] ?? '',
  }));
}

/** 区画の中から、時刻らしい値が多い列を 2 つ選んで開始・終了とする */
function sessionColumnsIn(
  region: { start: number; end: number },
  timeRatio: number[],
): { start: number; end: number } | null {
  const candidates: number[] = [];
  for (let c = region.start; c <= region.end; c++) {
    if ((timeRatio[c] ?? 0) >= TOLERANCE.timeColumnRatio) candidates.push(c);
  }
  if (candidates.length < 2) return null;
  return {
    start: candidates[0] ?? region.start,
    end: candidates[candidates.length - 1] ?? region.end,
  };
}

/**
 * 1 日あたりの行数を求める。
 * 日付列は格子形式だと日本語行と英語行の両方が日付らしく見えるため使えない。
 * 時刻はブロックの先頭行にしか現れないので、そちらを手掛かりにする。
 */
function inferStride(table: Table, sessionStartCols: readonly number[], dataStart: number): number {
  const hits = primaryRows(table, sessionStartCols, dataStart);
  if (hits.length < 3) return 1;
  const gaps = new Map<number, number>();
  for (let i = 1; i < hits.length; i++) {
    const d = (hits[i] ?? 0) - (hits[i - 1] ?? 0);
    if (d > 0 && d <= 6) gaps.set(d, (gaps.get(d) ?? 0) + 1);
  }
  let mode = 1;
  let bestCount = 0;
  for (const [gap, count] of gaps) {
    if (count > bestCount) {
      mode = gap;
      bestCount = count;
    }
  }
  return mode;
}

/** セッションの開始列に値が入っている行。ここがブロックの先頭になる */
function primaryRows(
  table: Table,
  sessionStartCols: readonly number[],
  dataStart: number,
): number[] {
  const hits: number[] = [];
  for (let r = dataStart; r < table.rows.length; r++) {
    if (sessionStartCols.some((c) => cellAt(table.rows, r, c).text !== '')) hits.push(r);
  }
  return hits;
}

function locateWithHeader(table: Table): Structure | null {
  const header = findHeader(table);
  if (!header) return null;

  const dataStart = Math.max(...header.rows) + 1;
  if (dataStart >= table.rows.length) return null;

  const timeRatio = ratioByColumn(table, dataStart, table.rows.length, isTimeLike);
  const dateRatio = ratioByColumn(table, dataStart, table.rows.length, isDateLike);
  const weekdayRatio = ratioByColumn(table, dataStart, table.rows.length, isWeekdayLike);

  let dateCol: number | null = null;
  let weekdayCol: number | null = null;
  let noteCol: number | null = null;
  let noteLabel: string | null = null;
  const sessions: SessionColumns[] = [];

  const pendingSessions: { ordinal: number; region: { start: number; end: number } }[] = [];

  for (const region of regionsOf(header.merged)) {
    const ordinal = sessionOrdinalOf(region.label);
    if (ordinal != null) {
      const cols = sessionColumnsIn(region, timeRatio);
      if (cols) sessions.push({ ordinal, start: cols.start, end: cols.end });
      else pendingSessions.push({ ordinal, region });
      continue;
    }
    if (matchesAny(region.label, VOCAB.date)) {
      // 区画の中で最も日付らしい列を選ぶ。曜日列は見出しを持たないことがある
      dateCol = argMaxIn(dateRatio, region.start, region.end) ?? region.start;
      weekdayCol = argMaxIn(weekdayRatio, region.start, region.end, 0.5);
      continue;
    }
    if (matchesAny(region.label, VOCAB.note)) {
      noteCol = region.start;
      noteLabel = region.label;
    }
  }

  // 見出しはあるが値が無い区画（その月に N 回目が一度も現れない場合）は、
  // 解決済みの区画から相対位置を借りる。レイアウトは区画間で揃っているため成立する。
  if (pendingSessions.length > 0 && sessions.length > 0) {
    const sample = sessions[0];
    const sampleRegion = regionsOf(header.merged).find((r) => r.start === sample?.start);
    if (sample && sampleRegion) {
      const startOffset = sample.start - sampleRegion.start;
      const endOffset = sample.end - sampleRegion.start;
      for (const p of pendingSessions) {
        const start = p.region.start + startOffset;
        const end = p.region.start + endOffset;
        if (end <= p.region.end) sessions.push({ ordinal: p.ordinal, start, end });
      }
    }
  }

  if (dateCol == null || sessions.length === 0) return null;

  sessions.sort((a, b) => a.start - b.start);
  const startCols = sessions.map((s) => s.start);
  // ブロックの先頭に揃える。ヘッダ直後に空行や英語行が挟まっても位置がずれない
  const firstPrimary = primaryRows(table, startCols, dataStart)[0] ?? dataStart;

  return {
    dataStart: firstPrimary,
    stride: inferStride(table, startCols, firstPrimary),
    dateCol,
    weekdayCol,
    noteCol,
    noteLabel,
    sessions,
    inferredByShape: false,
  };
}

function argMaxIn(values: number[], from: number, to: number, min = 0): number | null {
  let best: number | null = null;
  let bestValue = min;
  for (let i = from; i <= to; i++) {
    const v = values[i] ?? 0;
    if (v > bestValue) {
      bestValue = v;
      best = i;
    }
  }
  return best;
}

/**
 * ヘッダの語彙が総入れ替えされた場合の経路。値の形だけから構造を推定する。
 * 時刻らしい列を左から順にペアにすると、区切り列があってもなくても正しく組める。
 */
function locateByShape(table: Table): Structure | null {
  const dataStart = 0;
  const timeRatio = ratioByColumn(table, dataStart, table.rows.length, isTimeLike);
  const dateRatio = ratioByColumn(table, dataStart, table.rows.length, isDateLike);
  const weekdayRatio = ratioByColumn(table, dataStart, table.rows.length, isWeekdayLike);

  const timeCols: number[] = [];
  timeRatio.forEach((r, i) => {
    if (r >= TOLERANCE.timeColumnRatio) timeCols.push(i);
  });
  if (timeCols.length < 2) return null;

  const dateCol = argMaxIn(dateRatio, 0, dateRatio.length - 1, TOLERANCE.dateColumnRatio);
  if (dateCol == null) return null;

  const sessions: SessionColumns[] = [];
  for (let i = 0; i + 1 < timeCols.length; i += 2) {
    sessions.push({
      ordinal: sessions.length + 1,
      start: timeCols[i] ?? 0,
      end: timeCols[i + 1] ?? 0,
    });
  }

  const startCols = sessions.map((s) => s.start);
  const start = primaryRows(table, startCols, 0)[0] ?? 0;

  return {
    dataStart: start,
    stride: inferStride(table, startCols, start),
    dateCol,
    weekdayCol: argMaxIn(weekdayRatio, 0, weekdayRatio.length - 1, 0.5),
    noteCol: null,
    noteLabel: null,
    sessions,
    inferredByShape: true,
  };
}

export function locateStructure(table: Table): Structure | null {
  const structure = locateWithHeader(table) ?? locateByShape(table);
  if (!structure) return null;
  if (structure.sessions.length > TOLERANCE.maxSessionsPerDay) return null;
  return structure;
}

/** タイトル行など、ヘッダより上にある文言を集める。年の推定に使う */
export function textAbove(table: Table, dataStart: number): string[] {
  const out: string[] = [];
  for (let r = 0; r < Math.min(dataStart, table.rows.length); r++) {
    for (const cell of table.rows[r] ?? []) {
      if (cell.text !== '') out.push(cell.text);
    }
  }
  return out;
}

/** 注意書きの行を集める。データ行より下にある「※」で始まる文言 */
export function collectNotices(table: Table): string[] {
  const out: string[] = [];
  for (const row of table.rows) {
    for (const cell of row) {
      const t = cell.text;
      if (t.length < 8) continue;
      if (VOCAB.noticeMarkers.some((mk) => vocabKey(t).startsWith(vocabKey(mk)))) out.push(t);
    }
  }
  return out;
}
