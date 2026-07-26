import { z } from 'zod';
import { DateStr, TimeStr } from './primitives.js';
import { DaySchedule } from './schedule.js';

/**
 * API レスポンスの契約。すべてのレスポンスに meta を含める（DESIGN.md §11.2）。
 * ここが唯一の情報源で、@mizunashi/api-types はこれと型等価であることを
 * コンパイル時に検証する。
 */

export const SourceRef = z.object({
  pageUrl: z.string(),
  fileName: z.string(),
  /** 複数年をまたぐレスポンスでは年ごとの由来を列挙する */
  years: z.array(
    z.object({
      year: z.number().int(),
      fetchedAt: z.string(),
      sha256: z.string().nullable(),
    }),
  ),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const ResponseMeta = z.object({
  /** このレスポンスを生成した時刻（origin での生成時刻） */
  servedAt: z.string(),
  /** 原本を公式サイトから取得した時刻。複数年にまたがる場合は最も古いもの */
  fetchedAt: z.string().nullable(),
  /** 派生データを生成した時刻 */
  generatedAt: z.string().nullable(),
  /** fetchedAt からの経過秒 */
  dataAgeSeconds: z.number().int().nullable(),
  timezone: z.literal('Asia/Tokyo'),
  apiVersion: z.literal('v1'),
  schemaVersion: z.literal(1),
  source: SourceRef,
});
export type ResponseMeta = z.infer<typeof ResponseMeta>;

/** 絶対時刻まで解決したセッション */
export const ResolvedSession = z.object({
  date: DateStr,
  /** その日の何回目か (1 origin) */
  index: z.number().int().min(1),
  /** その日の総セッション数。「3回中2回目」と出せるようにする */
  ofDay: z.number().int().min(1),
  start: TimeStr,
  end: TimeStr,
  startAt: z.string(),
  endAt: z.string(),
  /** 負なら開始済み */
  startsInSeconds: z.number().int(),
  endsInSeconds: z.number().int(),
  durationMinutes: z.number().int(),
  status: z.enum(['upcoming', 'ongoing', 'ended']).optional(),
});
export type ResolvedSession = z.infer<typeof ResolvedSession>;

export const UnavailableReason = z.enum(['no_data_for_next_year', 'out_of_coverage']);
export type UnavailableReason = z.infer<typeof UnavailableReason>;

export const Coverage = z.object({ from: DateStr, to: DateStr });
export type Coverage = z.infer<typeof Coverage>;

/**
 * 「今」を基準にした情報。1 日に複数回あるのが常態なので、
 * 「今日この後まだ入れるか」と「翌日以降になるか」を別々に返す（DESIGN.md §9.3）。
 */
export const RelativeInfo = z.object({
  at: z.string(),
  state: z.enum(['open', 'closed', 'unknown']),
  closingSoon: z.boolean(),
  /** 入浴中なら「いつまで」 */
  openUntil: ResolvedSession.nullable(),
  /** 入浴中でないなら「いつから」。日をまたいで探す */
  openFrom: ResolvedSession.nullable(),
  /** 今日この後の次。日をまたがない点が openFrom と異なる */
  nextToday: ResolvedSession.nullable(),
  remainingToday: z.array(ResolvedSession),
  remainingCountToday: z.number().int().min(0),
  endedCountToday: z.number().int().min(0),
  totalCountToday: z.number().int().min(0),
  unavailableReason: UnavailableReason.nullable(),
});
export type RelativeInfo = z.infer<typeof RelativeInfo>;

export const PeriodSummary = z.object({
  dayCount: z.number().int(),
  daysWithSessions: z.number().int(),
  sessionCount: z.number().int(),
  totalMinutes: z.number().int(),
  earliestStart: TimeStr.nullable(),
  latestEnd: TimeStr.nullable(),
  longestSession: z
    .object({ date: DateStr, start: TimeStr, end: TimeStr, minutes: z.number().int() })
    .nullable(),
  holidayCount: z.number().int(),
  /** 1日あたりのセッション数の分布 */
  sessionCountDistribution: z.record(z.string(), z.number().int()),
  maxSessionsPerDay: z.number().int().min(0),
  missingDays: z.number().int().min(0),
});
export type PeriodSummary = z.infer<typeof PeriodSummary>;

export const PeriodNavigation = z.object({
  prev: z.string().nullable(),
  next: z.string().nullable(),
  current: z.string(),
});
export type PeriodNavigation = z.infer<typeof PeriodNavigation>;

export const PeriodScope = z.enum(['day', 'week', 'month', 'year', 'range']);
export type PeriodScope = z.infer<typeof PeriodScope>;

/** day / week / month / year は同じ形を返す。期間の長さが違うだけ（DESIGN.md §11.3） */
export const PeriodResponse = z.object({
  scope: PeriodScope,
  range: Coverage,
  timezone: z.literal('Asia/Tokyo'),
  days: z.array(DaySchedule),
  summary: PeriodSummary,
  navigation: PeriodNavigation,
  /** at=none のときは null */
  relative: RelativeInfo.nullable(),
  /** 提供範囲外を含み、一部が欠けている */
  partial: z.boolean(),
  coverage: Coverage,
  notes: z.array(z.string()),
  meta: ResponseMeta,
});
export type PeriodResponse = z.infer<typeof PeriodResponse>;

export const StatusResponse = z.object({
  now: z.string(),
  timezone: z.literal('Asia/Tokyo'),
  state: z.enum(['open', 'closed', 'unknown']),
  closingSoon: z.boolean(),
  current: ResolvedSession.nullable(),
  next: ResolvedSession.nullable(),
  nextUnavailableReason: UnavailableReason.nullable(),
  nextToday: ResolvedSession.nullable(),
  remainingToday: z.array(ResolvedSession),
  remainingCountToday: z.number().int().min(0),
  endedCountToday: z.number().int().min(0),
  totalCountToday: z.number().int().min(0),
  today: DaySchedule.nullable(),
  todaySessions: z.array(ResolvedSession),
  upcoming: z.array(ResolvedSession),
  coverage: Coverage,
  notes: z.array(z.string()),
  meta: ResponseMeta,
});
export type StatusResponse = z.infer<typeof StatusResponse>;

export const YearsResponse = z.object({
  activeYears: z.array(z.number().int()),
  current: z.number().int(),
  years: z.array(
    z.object({
      year: z.number().int(),
      coverage: Coverage,
      dayCount: z.number().int(),
      complete: z.boolean(),
      fetchedAt: z.string(),
    }),
  ),
  archivedOnly: z.array(
    z.object({ year: z.number().int(), archiveUrl: z.string(), derivedRemovedAt: z.string() }),
  ),
  meta: ResponseMeta,
});
export type YearsResponse = z.infer<typeof YearsResponse>;

export const Localized = z.object({ ja: z.string(), en: z.string().nullable() });
export type Localized = z.infer<typeof Localized>;

export const MetaResponse = z.object({
  facility: z.object({
    name: Localized,
    address: z.string(),
    springTemperature: z.number().nullable(),
    springQuality: Localized,
    fee: Localized,
    contact: z.object({ department: z.string(), tel: z.string() }),
  }),
  data: z.object({
    activeYears: z.array(z.number().int()),
    nextYearPublished: z.boolean(),
    coverage: Coverage.nullable(),
    lastCheckedAt: z.string().nullable(),
    retentionPolicy: z.string(),
  }),
  attribution: z.object({
    source: z.string(),
    sourceUrl: z.string(),
    disclaimer: z.string(),
  }),
  notes: z.object({ ja: z.array(z.string()), en: z.array(z.string()) }),
  meta: ResponseMeta,
});
export type MetaResponse = z.infer<typeof MetaResponse>;

/** RFC 9457。エラーでも meta を返す（DESIGN.md §11.6） */
export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  meta: ResponseMeta,
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
