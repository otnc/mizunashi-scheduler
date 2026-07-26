import { z } from 'zod';
import { DateStr, TimeStr } from './primitives.js';

export const Session = z.object({
  /** その日の何回目か (1 origin)。原本の「1回目 / 2回目 / 3回目」に対応 */
  index: z.number().int().min(1),
  start: TimeStr,
  /** 区間は [start, end) として扱う（DESIGN.md ADR-007） */
  end: TimeStr,
  minutes: z.number().int().positive(),
  /** end が翌日の時刻を指す場合。現行データには存在しないが将来の備え */
  crossesMidnight: z.boolean(),
});
export type Session = z.infer<typeof Session>;

export const Holiday = z.object({
  ja: z.string(),
  en: z.string().nullable(),
});
export type Holiday = z.infer<typeof Holiday>;

export const DaySummary = z.object({
  firstStart: TimeStr.nullable(),
  lastEnd: TimeStr.nullable(),
  /** セッションの合計分数。firstStart〜lastEnd の幅ではない */
  totalMinutes: z.number().int().min(0),
  sessionCount: z.number().int().min(0),
  longestMinutes: z.number().int().min(0),
  /** セッション間の空き時間（分）。sessionCount - 1 個 */
  gaps: z.array(z.number().int().min(0)),
});
export type DaySummary = z.infer<typeof DaySummary>;

export const DaySchedule = z.object({
  date: DateStr,
  /** 0=日 .. 6=土。date から導出し、原本の曜日セルは使わない */
  weekday: z.number().int().min(0).max(6),
  holiday: Holiday.nullable(),
  sessions: z.array(Session),
  summary: DaySummary,
});
export type DaySchedule = z.infer<typeof DaySchedule>;

export const SourceInfo = z.object({
  pageUrl: z.string().url().nullable(),
  fileUrl: z.string().url().nullable(),
  fileName: z.string(),
  label: z.string().nullable(),
  sha256: z.string().length(64).nullable(),
  bytes: z.number().int().positive(),
  fetchedAt: z.string().datetime(),
  archiveKey: z.string().nullable(),
});
export type SourceInfo = z.infer<typeof SourceInfo>;

export const YearSchedule = z.object({
  schemaVersion: z.literal(1),
  year: z.number().int().min(2000).max(2100),
  timezone: z.literal('Asia/Tokyo'),
  generatedAt: z.string().datetime(),
  /** 実データから算出した収録範囲。通年とは限らない */
  coverage: z.object({ from: DateStr, to: DateStr }),
  /** coverage が 1/1〜12/31 を満たすか */
  complete: z.boolean(),
  maxSessionsPerDay: z.number().int().min(0),
  sources: z.array(SourceInfo).min(1),
  notes: z.object({
    ja: z.array(z.string()),
    en: z.array(z.string()),
  }),
  days: z.array(DaySchedule),
});
export type YearSchedule = z.infer<typeof YearSchedule>;
