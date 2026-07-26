import type { YearSchedule } from '@mizunashi/schema';
import {
  CalendarView,
  activeYears,
  cacheKey,
  readIndex,
  readYear,
  type ArchiveIndex,
  type Cache,
  type Storage,
} from '@mizunashi/core';

/**
 * HTTP 層が依存する外部要素。テストではメモリ実装を差し込む。
 * now を関数で受けるのは、時刻依存のロジックを検証可能にするため（AGENTS.md §6）。
 */
export interface Deps {
  storage: Storage;
  cache: Cache;
  now: () => Date;
  pageUrl: string;
  baseUrl: string;
  /**
   * 原本ファイルの公開。既定はオフ。
   * 大量ダウンロードが R2 の課金につながりうるため、明示的に有効化したときだけ配信する。
   */
  archivePublic: boolean;
}

export interface LoadedData {
  calendar: CalendarView;
  years: YearSchedule[];
  index: ArchiveIndex;
}

/** KV を先に見て、無ければ R2 から読んで書き戻す（read-through） */
async function loadYear(deps: Deps, year: number): Promise<YearSchedule | null> {
  const cached = await deps.cache.get(cacheKey(year));
  if (cached != null) {
    try {
      return JSON.parse(cached) as YearSchedule;
    } catch {
      // 壊れたキャッシュは無視して R2 から読み直す
    }
  }
  const fromStorage = await readYear(deps.storage, year);
  if (fromStorage != null) await deps.cache.put(cacheKey(year), JSON.stringify(fromStorage));
  return fromStorage;
}

/** 提供対象（今年 + 来年）のデータをまとめて読む */
export async function loadData(deps: Deps): Promise<LoadedData> {
  const now = deps.now();
  const years: YearSchedule[] = [];
  for (const year of activeYears(now)) {
    const schedule = await loadYear(deps, year);
    if (schedule != null) years.push(schedule);
  }
  return { calendar: new CalendarView(years), years, index: await readIndex(deps.storage) };
}
