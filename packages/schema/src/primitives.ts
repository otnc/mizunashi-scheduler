import { z } from 'zod';

/** "HH:mm" (JST)。24 時以降は表現しない。日跨ぎは crossesMidnight で表す */
export const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type TimeStr = z.infer<typeof TimeStr>;

/** "YYYY-MM-DD" */
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type DateStr = z.infer<typeof DateStr>;

/** 0 時からの経過分。Excel 時刻小数を扱うため分解能は分とする（DESIGN.md §8.10.5） */
export type Minutes = number;

export const MINUTES_PER_DAY = 1440;

export function toTimeStr(m: Minutes): TimeStr {
  const wrapped = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function fromTimeStr(t: TimeStr): Minutes {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}
