import { cellLines, type Cell } from '../readers/types.js';
import { VOCAB, vocabKey } from '../vocabulary.js';

export interface DateReading {
  month?: number;
  day?: number;
  year?: number;
  /** Excel の日付シリアル値。信頼度は低い（2021 / 2022 年版で壊れている・§4.4.4） */
  serial?: number;
}

const JA_MONTH_DAY = /^(\d{1,2})月(\d{1,2})日$/;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const EN_MONTH_DAY = /^([a-z]{3,9})[.,\s]+(\d{1,2})$/;
/** 妥当な日付シリアル値の範囲。1954-01-01 〜 2119-12-31 相当 */
const SERIAL_MIN = 20000;
const SERIAL_MAX = 80000;

function monthFromEnglish(word: string): number | null {
  const key = vocabKey(word).slice(0, 3);
  const i = VOCAB.monthEn.indexOf(key as (typeof VOCAB.monthEn)[number]);
  return i >= 0 ? i + 1 : null;
}

/** セル全体から読む。複数行あれば各行を試し、得られた情報を統合する */
export function readDate(cell: Cell): DateReading | null {
  const parts = cellLines(cell);
  if (parts.length === 0) return null;
  if (parts.length === 1) return readDateLine(parts[0] ?? cell);

  const merged: DateReading = {};
  for (const part of parts) {
    const r = readDateLine(part);
    if (!r) continue;
    if (merged.month == null && r.month != null) merged.month = r.month;
    if (merged.day == null && r.day != null) merged.day = r.day;
    if (merged.year == null && r.year != null) merged.year = r.year;
    if (merged.serial == null && r.serial != null) merged.serial = r.serial;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

function readDateLine(cell: Cell): DateReading | null {
  const t = cell.text;
  if (t === '') return null;

  const iso = ISO.exec(t);
  if (iso?.[1] && iso[2] && iso[3]) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }

  const ja = JA_MONTH_DAY.exec(t);
  if (ja?.[1] && ja[2]) return { month: Number(ja[1]), day: Number(ja[2]) };

  const en = EN_MONTH_DAY.exec(vocabKey(t));
  if (en?.[1] && en[2]) {
    const month = monthFromEnglish(en[1]);
    if (month != null) return { month, day: Number(en[2]) };
  }

  if (cell.numeric != null && Number.isInteger(cell.numeric)) {
    if (cell.numeric >= SERIAL_MIN && cell.numeric <= SERIAL_MAX) {
      return { serial: cell.numeric };
    }
  }

  return null;
}

export function isDateLike(cell: Cell): boolean {
  return readDate(cell) !== null;
}

/** Excel の日付シリアル値を暦日に変換する。1900 日付システムのエポックは 1899-12-30 */
export function fromSerial(serial: number, date1904 = false): { y: number; m: number; d: number } {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.floor(serial) * 86_400_000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** シート名やタイトルから月を取り出す。「1月」「８月」「１０月」に対応する */
export function readMonthLabel(label: string): number | null {
  const key = vocabKey(label);
  const m = /(?:^|[^\d])(\d{1,2})月/.exec(key);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) return n;
  }
  const en = /^([a-z]{3,9})$/.exec(key);
  if (en?.[1]) return monthFromEnglish(en[1]);
  return null;
}

/** 曜日の 0=日 .. 6=土。日本語表記と英語表記の両方を受け付ける */
export function readWeekday(cell: Cell): number | null {
  for (const part of cellLines(cell)) {
    const v = readWeekdayLine(part);
    if (v != null) return v;
  }
  return null;
}

function readWeekdayLine(cell: Cell): number | null {
  const t = cell.text.trim();
  if (t === '') return null;
  const ja = VOCAB.weekdayJa.indexOf(t.charAt(0) as (typeof VOCAB.weekdayJa)[number]);
  if (ja >= 0 && (t.length === 1 || t.startsWith(`${t.charAt(0)}曜`))) return ja;
  const key = vocabKey(t).slice(0, 3);
  const en = VOCAB.weekdayEn.indexOf(key as (typeof VOCAB.weekdayEn)[number]);
  return en >= 0 ? en : null;
}

export function isWeekdayLike(cell: Cell): boolean {
  return readWeekday(cell) !== null;
}

/** UTC 基準で曜日を求める。ローカル時刻に依存させない */
export function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 「2026年」「令和8年」「(JANUARY,2026)」などから西暦年の候補を取り出す */
export function readYearCandidates(text: string): number[] {
  const key = text.normalize('NFKC');
  const found = new Set<number>();

  for (const m of key.matchAll(/(\d{4})\s*年/g)) if (m[1]) found.add(Number(m[1]));
  for (const m of key.matchAll(/[(,]\s*(\d{4})\s*[),]/g)) if (m[1]) found.add(Number(m[1]));

  for (const era of VOCAB.eras) {
    for (const name of era.names) {
      if (name.length === 1) continue;
      const re = new RegExp(`${name}\\s*(\\d{1,2})\\s*年`, 'g');
      for (const m of key.matchAll(re)) if (m[1]) found.add(era.offset + Number(m[1]));
    }
  }

  // 上記に該当しない裸の 4 桁も候補にする（弱い手掛かり）
  for (const m of key.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/g)) {
    if (m[1]) found.add(Number(m[1]));
  }

  return [...found].filter((y) => y >= 1990 && y <= 2100);
}
