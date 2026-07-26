/**
 * 水無海浜温泉 入浴可能時間 API のレスポンス型。
 *
 * 実行時コードも依存も持たない型だけのパッケージ。
 * 唯一の情報源は @mizunashi/schema の Zod 定義で、ここの型がそれと等価であることは
 * test/contract.test.ts のコンパイル時アサーションで担保している。
 */

/**
 * このパッケージが対応する API バージョン。
 * 型だけでは実行時に互換性を確かめられないため、値としても公開する。
 */
export const API_VERSION = 'v1';
export const SCHEMA_VERSION = 1;

/** "HH:mm" (JST) */
export type TimeStr = string;
/** "YYYY-MM-DD" */
export type DateStr = string;

export interface Session {
  /** その日の何回目か (1 origin) */
  index: number;
  start: TimeStr;
  /** 区間は [start, end) */
  end: TimeStr;
  minutes: number;
  crossesMidnight: boolean;
}

export interface Holiday {
  ja: string;
  en: string | null;
}

export interface DaySummary {
  firstStart: TimeStr | null;
  lastEnd: TimeStr | null;
  /** セッションの合計分数。firstStart〜lastEnd の幅ではない */
  totalMinutes: number;
  sessionCount: number;
  longestMinutes: number;
  /** セッション間の空き時間（分） */
  gaps: number[];
}

export interface DaySchedule {
  date: DateStr;
  /** 0=日 .. 6=土 */
  weekday: number;
  holiday: Holiday | null;
  sessions: Session[];
  summary: DaySummary;
}

export interface SourceRef {
  pageUrl: string;
  fileName: string;
  years: { year: number; fetchedAt: string; sha256: string | null }[];
}

export interface ResponseMeta {
  /** このレスポンスを生成した時刻 */
  servedAt: string;
  /** 原本を公式サイトから取得した時刻。複数年にまたがる場合は最も古いもの */
  fetchedAt: string | null;
  generatedAt: string | null;
  /** fetchedAt からの経過秒 */
  dataAgeSeconds: number | null;
  timezone: 'Asia/Tokyo';
  apiVersion: 'v1';
  schemaVersion: 1;
  source: SourceRef;
}

export interface ResolvedSession {
  date: DateStr;
  index: number;
  /** その日の総セッション数 */
  ofDay: number;
  start: TimeStr;
  end: TimeStr;
  startAt: string;
  endAt: string;
  /** 負なら開始済み */
  startsInSeconds: number;
  endsInSeconds: number;
  durationMinutes: number;
  status?: 'upcoming' | 'ongoing' | 'ended' | undefined;
}

export type UnavailableReason = 'no_data_for_next_year' | 'out_of_coverage';
export type BathingState = 'open' | 'closed' | 'unknown';

export interface Coverage {
  from: DateStr;
  to: DateStr;
}

export interface RelativeInfo {
  at: string;
  state: BathingState;
  closingSoon: boolean;
  /** 入浴中なら「いつまで」 */
  openUntil: ResolvedSession | null;
  /** 入浴中でないなら「いつから」。日をまたいで探す */
  openFrom: ResolvedSession | null;
  /** 今日この後の次。日をまたがない点が openFrom と異なる */
  nextToday: ResolvedSession | null;
  remainingToday: ResolvedSession[];
  remainingCountToday: number;
  endedCountToday: number;
  totalCountToday: number;
  unavailableReason: UnavailableReason | null;
}

export interface PeriodSummary {
  dayCount: number;
  daysWithSessions: number;
  sessionCount: number;
  totalMinutes: number;
  earliestStart: TimeStr | null;
  latestEnd: TimeStr | null;
  longestSession: { date: DateStr; start: TimeStr; end: TimeStr; minutes: number } | null;
  holidayCount: number;
  sessionCountDistribution: Record<string, number>;
  maxSessionsPerDay: number;
  missingDays: number;
}

export interface PeriodNavigation {
  prev: string | null;
  next: string | null;
  current: string;
}

export type PeriodScope = 'day' | 'week' | 'month' | 'year' | 'range';

/** day / week / month / year は同じ形。期間の長さが違うだけ */
export interface PeriodResponse {
  scope: PeriodScope;
  range: Coverage;
  timezone: 'Asia/Tokyo';
  days: DaySchedule[];
  summary: PeriodSummary;
  navigation: PeriodNavigation;
  /** at=none のときは null */
  relative: RelativeInfo | null;
  partial: boolean;
  coverage: Coverage;
  notes: string[];
  meta: ResponseMeta;
}

export interface StatusResponse {
  now: string;
  timezone: 'Asia/Tokyo';
  state: BathingState;
  closingSoon: boolean;
  current: ResolvedSession | null;
  next: ResolvedSession | null;
  nextUnavailableReason: UnavailableReason | null;
  nextToday: ResolvedSession | null;
  remainingToday: ResolvedSession[];
  remainingCountToday: number;
  endedCountToday: number;
  totalCountToday: number;
  today: DaySchedule | null;
  todaySessions: ResolvedSession[];
  upcoming: ResolvedSession[];
  coverage: Coverage;
  notes: string[];
  meta: ResponseMeta;
}

export interface YearsResponse {
  activeYears: number[];
  current: number;
  years: {
    year: number;
    coverage: Coverage;
    dayCount: number;
    complete: boolean;
    fetchedAt: string;
  }[];
  archivedOnly: { year: number; archiveUrl: string; derivedRemovedAt: string }[];
  meta: ResponseMeta;
}

export interface Localized {
  ja: string;
  en: string | null;
}

export interface MetaResponse {
  facility: {
    name: Localized;
    address: string;
    springTemperature: number | null;
    springQuality: Localized;
    fee: Localized;
    contact: { department: string; tel: string };
  };
  data: {
    activeYears: number[];
    nextYearPublished: boolean;
    coverage: Coverage | null;
    lastCheckedAt: string | null;
    retentionPolicy: string;
  };
  attribution: { source: string; sourceUrl: string; disclaimer: string };
  notes: { ja: string[]; en: string[] };
  meta: ResponseMeta;
}

/** RFC 9457 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string | undefined;
  instance?: string | undefined;
  errors?: { path: string; message: string }[] | undefined;
  meta: ResponseMeta;
}
