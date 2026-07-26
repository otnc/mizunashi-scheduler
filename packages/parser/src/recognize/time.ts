import type { Minutes } from '@mizunashi/schema';
import { MINUTES_PER_DAY } from '@mizunashi/schema';
import type { Cell } from '../readers/types.js';

export interface TimeReading {
  minutes: Minutes;
  /** 通常でない解釈をした場合の診断コード */
  code?: 'time.separator' | 'time.hourOnly';
}

/** 明示的な区切りを持つ形式。';' は 2022 年版に実在する誤入力（§4.4.5） */
const DELIMITED = /^(\d{1,2})\s*([:;時])\s*(\d{1,2})$/;
/** "9.00" のように小数点を区切りに使った形式 */
const DOT_DELIMITED = /^(\d{1,2})\.(\d{2})$/;
const INT_HHMM = /^\d{3,4}$/;
const BARE_HOUR = /^\d{1,2}$/;

/**
 * 時刻として解釈する。整数 HHMM / Excel 時刻小数 / H:MM 文字列 / 誤入力に対応する
 * （DESIGN.md §8.5）。分単位で返すため、将来 30 分刻みになっても実装変更は要らない。
 */
export function readTime(cell: Cell, opts: { allowBareHour?: boolean } = {}): TimeReading | null {
  const t = cell.text;
  if (t === '') return null;

  const delimited = DELIMITED.exec(t);
  if (delimited) {
    const h = Number(delimited[1]);
    const m = Number(delimited[3]);
    if (m >= 60) return null;
    return delimited[2] === ':'
      ? { minutes: h * 60 + m }
      : { minutes: h * 60 + m, code: 'time.separator' };
  }

  // Excel 時刻小数。1 日 = 1.0 なので 2.0 未満だけを対象にする
  if (cell.numeric != null && t.includes('.') && cell.numeric >= 0 && cell.numeric < 2) {
    return { minutes: Math.round(cell.numeric * MINUTES_PER_DAY) };
  }

  const dotted = DOT_DELIMITED.exec(t);
  if (dotted) {
    const m = Number(dotted[2]);
    if (m < 60) return { minutes: Number(dotted[1]) * 60 + m, code: 'time.separator' };
  }

  if (INT_HHMM.test(t)) {
    const n = Number(t);
    const h = Math.floor(n / 100);
    const m = n % 100;
    if (m < 60 && h <= 47) return { minutes: h * 60 + m };
  }

  if (opts.allowBareHour === true && BARE_HOUR.test(t)) {
    const h = Number(t);
    if (h <= 47) return { minutes: h * 60, code: 'time.hourOnly' };
  }

  return null;
}

/**
 * 列の役割を推定するための判定。
 * 裸の 1〜2 桁は日付の「日」と区別できないため、ここでは時刻とみなさない。
 */
export function isTimeLike(cell: Cell): boolean {
  return readTime(cell) !== null;
}
