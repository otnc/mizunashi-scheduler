import type {
  PeriodResponse,
  PeriodScope,
  RelativeInfo,
  StatusResponse,
} from '@mizunashi/api-types';
import type { DaySchedule } from '@mizunashi/schema';
import {
  computeStatus,
  jstDateKey,
  summarize,
  type CalendarView,
  type PeriodRange,
} from '@mizunashi/core';
import type { LoadedData } from './deps.js';
import { buildMeta } from './meta.js';

export interface PeriodOptions {
  scope: PeriodScope;
  range: PeriodRange;
  navigation: { prev: string | null; next: string | null; current: string };
  /** null なら relative を省いた静的レスポンスになる */
  at: Date | null;
  lang: 'ja' | 'en';
}

function daysIn(calendar: CalendarView, range: PeriodRange): DaySchedule[] {
  const out: DaySchedule[] = [];
  const coverage = calendar.coverage();
  if (coverage == null) return out;
  for (
    let d = range.from > coverage.from ? range.from : coverage.from;
    d <= range.to && d <= coverage.to;
    d = nextDate(d)
  ) {
    const day = calendar.day(d);
    if (day != null) out.push(day);
  }
  return out;
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** 「今」を基準にした情報。1 日に複数回あることを前提に nextToday を別に返す */
export function buildRelative(at: Date, calendar: CalendarView): RelativeInfo {
  const s = computeStatus(at, calendar);
  return {
    at: s.now,
    state: s.state,
    closingSoon: s.closingSoon,
    openUntil: s.current,
    openFrom: s.current == null ? s.next : null,
    nextToday: s.nextToday,
    remainingToday: s.remainingToday,
    remainingCountToday: s.remainingCountToday,
    endedCountToday: s.endedCountToday,
    totalCountToday: s.totalCountToday,
    unavailableReason: s.current == null && s.next == null ? s.nextUnavailableReason : null,
  };
}

export function buildPeriodResponse(
  data: LoadedData,
  options: PeriodOptions,
  pageUrl: string,
  now: Date,
): PeriodResponse {
  const days = daysIn(data.calendar, options.range);
  const coverage = data.calendar.coverage() ?? { from: options.range.from, to: options.range.to };
  const expected = Math.round(
    (Date.parse(`${options.range.to}T00:00:00Z`) - Date.parse(`${options.range.from}T00:00:00Z`)) /
      86_400_000 +
      1,
  );

  return {
    scope: options.scope,
    range: options.range,
    timezone: 'Asia/Tokyo',
    days,
    summary: summarize(days, options.range),
    navigation: options.navigation,
    relative: options.at == null ? null : buildRelative(options.at, data.calendar),
    partial: days.length < expected,
    coverage,
    notes: data.calendar.notes(options.lang),
    meta: buildMeta(data.years, pageUrl, now),
  };
}

export function buildStatusResponse(
  data: LoadedData,
  at: Date,
  lang: 'ja' | 'en',
  pageUrl: string,
  now: Date,
  upcomingLimit: number,
): StatusResponse {
  const s = computeStatus(at, data.calendar, { upcomingLimit });
  const coverage = data.calendar.coverage() ?? { from: jstDateKey(at), to: jstDateKey(at) };

  return {
    now: s.now,
    timezone: 'Asia/Tokyo',
    state: s.state,
    closingSoon: s.closingSoon,
    current: s.current,
    next: s.next,
    nextUnavailableReason: s.nextUnavailableReason,
    nextToday: s.nextToday,
    remainingToday: s.remainingToday,
    remainingCountToday: s.remainingCountToday,
    endedCountToday: s.endedCountToday,
    totalCountToday: s.totalCountToday,
    today: s.today,
    todaySessions: s.todaySessions,
    upcoming: s.upcoming,
    coverage,
    notes: data.calendar.notes(lang),
    meta: buildMeta(data.years, pageUrl, now),
  };
}
