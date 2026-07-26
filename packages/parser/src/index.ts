import type { DaySchedule, Diagnostics } from '@mizunashi/schema';
import { DiagnosticsCollector } from './diagnostics.js';
import { extractEntries, type RawEntry } from './extract.js';
import { collectNotices, locateStructure, textAbove } from './locate/index.js';
import { buildSessions } from './normalize/sessions.js';
import { resolveYears, YearResolutionError, type YearHint } from './normalize/year.js';
import { csvReader } from './readers/csv.js';
import type { Reader, SourceArtifact } from './readers/types.js';
import { usesDate1904, xlsxReader } from './readers/xlsx.js';
import { readMonthLabel, readYearCandidates, weekdayOf } from './recognize/date.js';
import { summarize } from './summary.js';

export * from './readers/types.js';
export { VOCAB } from './vocabulary.js';
export { TOLERANCE, DIAGNOSTIC_LIMITS } from './tolerance.js';
export { readTime, isTimeLike } from './recognize/time.js';
export { readDate, isDateLike, readWeekday, readYearCandidates } from './recognize/date.js';
export { locateStructure } from './locate/index.js';
export { YearResolutionError } from './normalize/year.js';
export { splitByCalendarYear } from './split.js';

export const READERS: readonly Reader[] = [xlsxReader, csvReader];

export class UnknownFormatError extends Error {
  constructor(readonly scores: Record<string, number>) {
    super(`対応する Reader がありません: ${JSON.stringify(scores)}`);
    this.name = 'UnknownFormatError';
  }
}

export interface ParsedDocument {
  readerId: string;
  /** 日付順・重複なし。年をまたぐことがある */
  days: DaySchedule[];
  notes: { ja: string[]; en: string[] };
  diagnostics: Diagnostics;
  /** 構造推論がヘッダではなく形状に頼ったか */
  inferredByShape: boolean;
  /** 曜日交差検証の一致率。曜日列が無い場合は -1 */
  weekdayAgreement: number;
}

function selectReader(artifact: SourceArtifact): Reader {
  const scores: Record<string, number> = {};
  let best: { reader: Reader; score: number } | null = null;
  for (const reader of READERS) {
    let score = 0;
    try {
      score = reader.sniff(artifact);
    } catch {
      score = 0;
    }
    scores[reader.id] = score;
    if (score > 0 && (best == null || score > best.score)) best = { reader, score };
  }
  if (!best) throw new UnknownFormatError(scores);
  return best.reader;
}

function collectYearHints(artifact: SourceArtifact, texts: readonly string[]): YearHint[] {
  const hints = new Map<number, number>();
  const add = (year: number, weight: number): void => {
    hints.set(year, Math.max(hints.get(year) ?? 0, weight));
  };
  // 内容由来を重く、ファイル名由来を軽くする。R2.xlsx の中身が 2021 年である前例がある
  for (const t of texts) for (const y of readYearCandidates(t)) add(y, 5);
  if (artifact.linkLabel != null) for (const y of readYearCandidates(artifact.linkLabel)) add(y, 2);
  for (const y of readYearCandidates(artifact.fileName)) add(y, 1);
  return [...hints].map(([year, weight]) => ({ year, weight }));
}

function classifyNotices(notices: readonly string[]): { ja: string[]; en: string[] } {
  const ja: string[] = [];
  const en: string[] = [];
  for (const raw of notices) {
    const text = raw.replace(/^[\u203b*\uff0a\s\u3000]+/, '').trim();
    if (text === '') continue;
    if (/[぀-ヿ一-鿿]/.test(text)) {
      if (!ja.includes(text)) ja.push(text);
    } else if (!en.includes(text)) en.push(text);
  }
  return { ja, en };
}

export function parseDocument(artifact: SourceArtifact): ParsedDocument {
  const reader = selectReader(artifact);
  const tables = reader.read(artifact);
  const diag = new DiagnosticsCollector();
  const date1904 = reader.id === 'xlsx' && usesDate1904(artifact);

  const entries: RawEntry[] = [];
  const titleTexts: string[] = [];
  const notices: string[] = [];
  let inferredByShape = false;

  for (const table of tables) {
    const structure = locateStructure(table);
    if (!structure) {
      diag.add('sheet.skipped', table.name);
      continue;
    }
    if (structure.inferredByShape) {
      inferredByShape = true;
      diag.add('structure.shapeInferred', table.name);
    }

    titleTexts.push(...textAbove(table, structure.dataStart), table.name);
    notices.push(...collectNotices(table));

    const sheetMonth = readMonthLabel(table.name);
    for (const entry of extractEntries(table, structure)) {
      if (entry.date && entry.date.month == null && sheetMonth != null) {
        entry.date.month = sheetMonth;
      }
      entries.push(entry);
    }
  }

  if (entries.length === 0) throw new UnknownFormatError({ [reader.id]: 1 });

  const hints = collectYearHints(artifact, titleTexts);
  const resolved = resolveYears(entries, hints, diag, date1904);

  const byDate = new Map<string, DaySchedule>();
  for (const d of resolved.dated) {
    const date = `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    const sessions = buildSessions(d.entry.slots, diag);
    byDate.set(date, {
      date,
      weekday: weekdayOf(d.year, d.month, d.day),
      holiday: buildHoliday(d.entry.noteJa, d.entry.noteEn),
      sessions,
      summary: summarize(sessions),
    });
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];
    if (!prev || !cur) continue;
    if (Date.parse(`${cur.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`) !== 86_400_000) {
      diag.add('date.gap', `${prev.date} -> ${cur.date}`);
    }
  }

  return {
    readerId: reader.id,
    days,
    notes: classifyNotices(notices),
    diagnostics: diag.toDiagnostics(reader.id),
    inferredByShape,
    weekdayAgreement: resolved.agreement,
  };
}

/** 見出し列の値。備考として空欄の年もあるため、値があるときだけ祝日として扱う */
function buildHoliday(
  ja: string | null,
  en: string | null,
): { ja: string; en: string | null } | null {
  if (ja == null || ja === '') return null;
  return {
    ja: normalizeApostrophes(ja),
    en: en == null || en === '' ? null : normalizeApostrophes(en),
  };
}

/** 原本には ` と ’ が混在する（New Year`s Day / Children’s Day）。§4.3 */
function normalizeApostrophes(s: string): string {
  return s.replace(/[`´']/g, '\u2019');
}

export { YearResolutionError as DateResolutionError };
