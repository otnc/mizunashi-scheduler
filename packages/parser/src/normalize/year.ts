import type { DiagnosticsCollector } from '../diagnostics.js';
import type { RawEntry } from '../extract.js';
import { daysInMonth, fromSerial, weekdayOf } from '../recognize/date.js';
import { TOLERANCE } from '../tolerance.js';

export interface YearHint {
  year: number;
  weight: number;
}

export interface DatedEntry {
  entry: RawEntry;
  year: number;
  month: number;
  day: number;
}

export class YearResolutionError extends Error {
  constructor(
    message: string,
    readonly detail: { candidates: number[]; bestAgreement: number },
  ) {
    super(message);
    this.name = 'YearResolutionError';
  }
}

/**
 * 月日の情報源。どちらが正しいかは年によって異なるため優先順位を固定しない。
 * 2021 年版は英語日付行が全行「MAR.3」で壊れており、2021 / 2022 年版はシリアル値の
 * 年がずれている。どちらの情報源も単独では信用できない（DESIGN.md §8.4）。
 */
type Source = 'text' | 'serial';
const SOURCES: readonly Source[] = ['text', 'serial'];

type MonthDay = { month: number; day: number } | null;

function monthDayFrom(entry: RawEntry, source: Source, date1904: boolean): MonthDay {
  const d = entry.date;
  if (!d) return null;
  if (source === 'text') {
    return d.month != null && d.day != null ? { month: d.month, day: d.day } : null;
  }
  if (d.serial != null) {
    const s = fromSerial(d.serial, date1904);
    return { month: s.m, day: s.d };
  }
  return null;
}

/** 主の情報源を使い、欠けている行だけもう一方で補う */
function buildSeries(
  entries: readonly RawEntry[],
  primary: Source,
  date1904: boolean,
): { entries: RawEntry[]; pairs: { month: number; day: number }[]; coverage: number } {
  const other = primary === 'text' ? 'serial' : 'text';
  const keptEntries: RawEntry[] = [];
  const pairs: { month: number; day: number }[] = [];
  let fromPrimary = 0;

  for (const entry of entries) {
    const p = monthDayFrom(entry, primary, date1904);
    const md = p ?? monthDayFrom(entry, other, date1904);
    if (!md) continue;
    if (p) fromPrimary++;
    keptEntries.push(entry);
    pairs.push(md);
  }

  return {
    entries: keptEntries,
    pairs,
    coverage: entries.length === 0 ? 0 : fromPrimary / entries.length,
  };
}

/** 月が減少に転じたら年を進める。会計年度（4月〜翌3月）のファイルもこれで並ぶ */
function assignYears(
  pairs: readonly { month: number; day: number }[],
  startYear: number,
): number[] {
  const years: number[] = [];
  let year = startYear;
  let prevMonth: number | null = null;
  for (const p of pairs) {
    if (prevMonth != null && p.month < prevMonth) year++;
    years.push(year);
    prevMonth = p.month;
  }
  return years;
}

function weekdayAgreement(
  entries: readonly RawEntry[],
  pairs: readonly { month: number; day: number }[],
  years: readonly number[],
): number {
  let checked = 0;
  let matched = 0;
  for (let i = 0; i < entries.length; i++) {
    const wd = entries[i]?.weekday;
    const p = pairs[i];
    const y = years[i];
    if (wd == null || p == null || y == null) continue;
    if (p.day > daysInMonth(y, p.month)) continue;
    checked++;
    if (weekdayOf(y, p.month, p.day) === wd) matched++;
  }
  return checked === 0 ? -1 : matched / checked;
}

/** 重複しない日付の割合。曜日列が無い場合の代替指標になる */
function distinctRatio(
  pairs: readonly { month: number; day: number }[],
  years: readonly number[],
): number {
  if (pairs.length === 0) return 0;
  const seen = new Set<string>();
  for (let i = 0; i < pairs.length; i++) {
    seen.add(`${String(years[i])}-${String(pairs[i]?.month)}-${String(pairs[i]?.day)}`);
  }
  return seen.size / pairs.length;
}

export interface YearResolution {
  dated: DatedEntry[];
  year: number;
  agreement: number;
  source: Source;
}

export function resolveYears(
  entries: readonly RawEntry[],
  hints: readonly YearHint[],
  diag: DiagnosticsCollector,
  date1904 = false,
): YearResolution {
  const ranked = [...hints].sort((a, b) => b.weight - a.weight).map((h) => h.year);
  const candidates = [...new Set([...ranked, ...ranked.flatMap((y) => [y - 1, y + 1])])];
  if (candidates.length === 0) {
    throw new YearResolutionError('年の候補が 1 つも得られませんでした', {
      candidates: [],
      bestAgreement: -1,
    });
  }

  interface Attempt {
    source: Source;
    year: number;
    score: number;
    agreement: number;
    series: ReturnType<typeof buildSeries>;
    years: number[];
  }

  let best: Attempt | null = null;

  for (const source of SOURCES) {
    const series = buildSeries(entries, source, date1904);
    if (series.pairs.length === 0) continue;

    for (const year of candidates) {
      const years = assignYears(series.pairs, year);
      const agreement = weekdayAgreement(series.entries, series.pairs, years);
      // 曜日列が無ければ日付の重複の少なさで代用する
      const score = agreement >= 0 ? agreement : distinctRatio(series.pairs, years);
      if (best == null || score > best.score) {
        best = { source, year, score, agreement, series, years };
      }
      if (score >= 1) break;
    }
  }

  if (best == null) {
    throw new YearResolutionError('日付を読み取れる行がありません', {
      candidates,
      bestAgreement: -1,
    });
  }
  if (best.score < TOLERANCE.weekdayAgreement) {
    throw new YearResolutionError('日付の一貫性が閾値に届きませんでした', {
      candidates,
      bestAgreement: best.score,
    });
  }

  const skipped = entries.length - best.series.entries.length;
  if (skipped > 0) diag.add('date.unparsable', `${String(skipped)} rows`);
  if (best.year !== ranked[0]) {
    diag.add('year.corrected', `${String(ranked[0])} -> ${String(best.year)}`);
  }
  if (best.source !== 'text') {
    // 通常は日付テキストが主。シリアル値が選ばれたのはテキスト側に欠陥がある証拠
    diag.add('date.sourceRejected', `text -> ${best.source}`);
  }

  return {
    dated: best.series.entries.map((entry, i) => ({
      entry,
      year: best.years[i] ?? best.year,
      month: best.series.pairs[i]?.month ?? 1,
      day: best.series.pairs[i]?.day ?? 1,
    })),
    year: best.year,
    agreement: best.agreement,
    source: best.source,
  };
}
