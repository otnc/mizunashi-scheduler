import { splitByCalendarYear, type ParsedDocument } from '@mizunashi/parser';
import type { DaySchedule, SourceInfo, YearSchedule } from '@mizunashi/schema';
import type { ArchiveEntry } from './archive.js';

export interface YearBucket {
  year: number;
  days: DaySchedule[];
  coverage: { from: string; to: string };
  complete: boolean;
  maxSessionsPerDay: number;
}

/**
 * パース結果を暦年ごとに分ける。会計年度ファイルや部分年ファイルが来ても、
 * 下流は常に「暦年ごとの日程」だけを見ればよくなる（DESIGN.md §8.6）。
 */
export function toBuckets(parsed: ParsedDocument): YearBucket[] {
  return splitByCalendarYear(parsed.days);
}

export function toSourceInfo(entry: ArchiveEntry, pageUrl: string, fetchedAt: string): SourceInfo {
  return {
    pageUrl,
    fileUrl: entry.sourceUrl,
    fileName: entry.fileName,
    label: entry.label,
    sha256: entry.sha256,
    bytes: entry.bytes,
    fetchedAt,
    archiveKey: entry.key,
  };
}

export function buildYearSchedule(
  bucket: YearBucket,
  source: SourceInfo,
  notes: { ja: string[]; en: string[] },
  now: Date,
): YearSchedule {
  return {
    schemaVersion: 1,
    year: bucket.year,
    timezone: 'Asia/Tokyo',
    generatedAt: now.toISOString(),
    coverage: bucket.coverage,
    complete: bucket.complete,
    maxSessionsPerDay: bucket.maxSessionsPerDay,
    sources: [source],
    notes,
    days: bucket.days,
  };
}

/**
 * 既存の年データに新しい取り込み結果を重ねる。
 * 会計年度ファイルのように 1 つの暦年が複数の原本に由来しうるため、
 * 日付をキーにマージし、同じ日は新しい方を採る（DESIGN.md §8.6）。
 */
export function mergeYearSchedule(
  existing: YearSchedule | null,
  incoming: YearSchedule,
): YearSchedule {
  if (existing == null) return incoming;

  const byDate = new Map(existing.days.map((d) => [d.date, d]));
  for (const day of incoming.days) byDate.set(day.date, day);

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const from = days[0]?.date ?? incoming.coverage.from;
  const to = days[days.length - 1]?.date ?? incoming.coverage.to;

  const sources = [...existing.sources];
  for (const s of incoming.sources) {
    const i = sources.findIndex((v) => v.sha256 === s.sha256);
    if (i >= 0) sources[i] = s;
    else sources.push(s);
  }

  return {
    ...incoming,
    coverage: { from, to },
    complete: isCompleteYear(incoming.year, days.length, from, to),
    maxSessionsPerDay: days.reduce((max, d) => Math.max(max, d.sessions.length), 0),
    sources,
    days,
  };
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function isCompleteYear(year: number, dayCount: number, from: string, to: string): boolean {
  return (
    dayCount === (isLeap(year) ? 366 : 365) && from.endsWith('-01-01') && to.endsWith('-12-31')
  );
}
