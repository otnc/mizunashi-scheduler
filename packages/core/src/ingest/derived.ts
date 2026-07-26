import type { YearSchedule } from '@mizunashi/schema';
import { readJson, writeJson, type Cache, type Storage } from '../storage.js';
import { activeYears } from '../status/jst.js';

export const DERIVED_PREFIX = 'derived/v1/';
export const INDEX_KEY = `${DERIVED_PREFIX}index.json`;

export const derivedKey = (year: number): string => `${DERIVED_PREFIX}${String(year)}.json`;
export const cacheKey = (year: number): string => `schedule:v1:${String(year)}`;
export const INDEX_CACHE_KEY = 'index:v1';

export interface YearEntry {
  year: number;
  dayCount: number;
  coverage: { from: string; to: string };
  complete: boolean;
  fetchedAt: string;
  generatedAt: string;
  sha256: string | null;
  archiveKey: string | null;
}

export interface ArchiveIndex {
  schemaVersion: 1;
  updatedAt: string;
  /** 時間表を提供している年（今年 + 来年）。昇順 */
  activeYears: number[];
  years: Record<string, YearEntry>;
  lastRun: {
    at: string;
    outcome: 'ok' | 'partial' | 'failed';
    pruned: number[];
    notPublished: number[];
  } | null;
}

/** 定数をスプレッドすると配列やオブジェクトの参照が共有されるため、毎回新しく作る */
function emptyIndex(): ArchiveIndex {
  return {
    schemaVersion: 1,
    updatedAt: '1970-01-01T00:00:00.000Z',
    activeYears: [],
    years: {},
    lastRun: null,
  };
}

export async function readIndex(storage: Storage): Promise<ArchiveIndex> {
  return (await readJson<ArchiveIndex>(storage, INDEX_KEY)) ?? emptyIndex();
}

export async function writeIndex(
  storage: Storage,
  cache: Cache,
  index: ArchiveIndex,
): Promise<void> {
  await writeJson(storage, INDEX_KEY, index);
  await cache.put(INDEX_CACHE_KEY, JSON.stringify(index));
}

export async function readYear(storage: Storage, year: number): Promise<YearSchedule | null> {
  return readJson<YearSchedule>(storage, derivedKey(year));
}

export async function writeYear(
  storage: Storage,
  cache: Cache,
  schedule: YearSchedule,
): Promise<void> {
  await writeJson(storage, derivedKey(schedule.year), schedule);
  await cache.put(cacheKey(schedule.year), JSON.stringify(schedule));
}

export function toYearEntry(schedule: YearSchedule): YearEntry {
  const source = schedule.sources[schedule.sources.length - 1];
  return {
    year: schedule.year,
    dayCount: schedule.days.length,
    coverage: schedule.coverage,
    complete: schedule.complete,
    fetchedAt: source?.fetchedAt ?? schedule.generatedAt,
    generatedAt: schedule.generatedAt,
    sha256: source?.sha256 ?? null,
    archiveKey: source?.archiveKey ?? null,
  };
}

export interface PruneResult {
  removed: number[];
  activeYears: number[];
}

/**
 * 提供対象外になった年の派生データを捨てる（DESIGN.md §7.8 / FR-21）。
 * raw/ には触れない。派生データは原本から再生成できるので、この削除は可逆。
 */
export async function prune(
  storage: Storage,
  cache: Cache,
  index: ArchiveIndex,
  now: Date,
): Promise<PruneResult> {
  const active = new Set(activeYears(now));
  const removed: number[] = [];
  const kept: Record<string, YearEntry> = {};

  for (const [key, entry] of Object.entries(index.years)) {
    const year = Number(key);
    if (active.has(year)) {
      kept[key] = entry;
      continue;
    }
    await storage.delete(derivedKey(year));
    await cache.delete(cacheKey(year));
    removed.push(year);
  }
  index.years = kept;

  index.activeYears = Object.keys(index.years)
    .map(Number)
    .sort((a, b) => a - b);

  return { removed: removed.sort((a, b) => a - b), activeYears: index.activeYears };
}
