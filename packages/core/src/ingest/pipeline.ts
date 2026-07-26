import { parseDocument, UnknownFormatError } from '@mizunashi/parser';
import type { Cache, Http, Storage } from '../storage.js';
import { activeYears } from '../status/jst.js';
import { archiveRaw, readManifest, writeManifest, type ArchiveEntry } from './archive.js';
import {
  prune,
  readIndex,
  readYear,
  toYearEntry,
  writeIndex,
  writeYear,
  type ArchiveIndex,
} from './derived.js';
import { discoverDocuments, pickForYear, type DiscoveredDocument } from './discover.js';
import { buildYearSchedule, mergeYearSchedule, toBuckets, toSourceInfo } from './transform.js';
import { validateBucket } from './validate.js';

export interface IngestConfig {
  pageUrl: string;
  storage: Storage;
  cache: Cache;
  http: Http;
}

export type YearOutcome =
  | { year: number; status: 'ok'; dayCount: number; complete: boolean; fileName: string }
  | { year: number; status: 'not_published' }
  | { year: number; status: 'pdf_only'; urls: string[] }
  | { year: number; status: 'rejected'; reason: string; issues: string[] }
  | { year: number; status: 'unchanged'; fileName: string };

export interface IngestResult {
  ranAt: string;
  outcome: 'ok' | 'partial' | 'failed';
  years: YearOutcome[];
  pruned: number[];
  discovered: number;
}

/**
 * 状態を持たない取り込み。前回何を取得したかを覚えず、起動のたびに
 * 「公式ページを見て、対象年のファイルを取ってきて、作り直す」だけを行う（ADR-019）。
 * これにより、パーサを直してデプロイすれば次の実行で自動的に回復する。
 */
export async function runIngest(config: IngestConfig, now: Date): Promise<IngestResult> {
  const { pageUrl, storage, cache, http } = config;
  const years = activeYears(now);

  const { documents } = await discoverDocuments(http, pageUrl);
  const manifest = await readManifest(storage);
  const index = await readIndex(storage);

  const outcomes: YearOutcome[] = [];

  for (const year of years) {
    outcomes.push(await ingestYear({ ...config, year, documents, manifest, index, now }));
  }

  const pruneResult = await prune(storage, cache, index, now);

  manifest.lastRunAt = now.toISOString();
  await writeManifest(storage, manifest);

  const failed = outcomes.filter((o) => o.status === 'rejected' || o.status === 'pdf_only');
  const ok = outcomes.filter((o) => o.status === 'ok' || o.status === 'unchanged');
  const outcome: IngestResult['outcome'] =
    failed.length === 0 ? 'ok' : ok.length > 0 ? 'partial' : 'failed';

  index.updatedAt = now.toISOString();
  index.lastRun = {
    at: now.toISOString(),
    outcome,
    pruned: pruneResult.removed,
    notPublished: outcomes.filter((o) => o.status === 'not_published').map((o) => o.year),
  };
  await writeIndex(storage, cache, index);

  return {
    ranAt: now.toISOString(),
    outcome,
    years: outcomes,
    pruned: pruneResult.removed,
    discovered: documents.length,
  };
}

interface YearContext extends IngestConfig {
  year: number;
  documents: DiscoveredDocument[];
  manifest: Awaited<ReturnType<typeof readManifest>>;
  index: ArchiveIndex;
  now: Date;
}

async function ingestYear(ctx: YearContext): Promise<YearOutcome> {
  const { year, documents, storage, cache, http, manifest, index, now, pageUrl } = ctx;
  const candidates = pickForYear(documents, year);
  if (candidates.length === 0) return { year, status: 'not_published' };

  const machineReadable = candidates.filter((d) => d.format !== 'pdf');
  if (machineReadable.length === 0) {
    return { year, status: 'pdf_only', urls: candidates.map((d) => d.url) };
  }

  const issues: string[] = [];

  for (const doc of machineReadable) {
    const res = await http.get(doc.url);
    if (res.status !== 200) {
      issues.push(`${doc.fileName}: HTTP ${String(res.status)}`);
      continue;
    }

    // 原本の保存はパースより先。パースに失敗しても原本は残る（DESIGN.md §7.4）
    const archived = await archiveRaw(
      storage,
      manifest,
      doc,
      res.bytes,
      res.headers['content-type'] ?? null,
      now,
    );

    let parsed;
    try {
      parsed = parseDocument({
        bytes: res.bytes,
        fileName: doc.fileName,
        contentType: res.headers['content-type'] ?? null,
        linkLabel: doc.label === '' ? null : doc.label,
      });
    } catch (err) {
      archived.entry.parseStatus = 'failed';
      issues.push(
        `${doc.fileName}: ${err instanceof UnknownFormatError ? '未知の形式' : String(err)}`,
      );
      continue;
    }

    const bucket = toBuckets(parsed).find((b) => b.year === year);
    if (!bucket) {
      // 名前やヒントとは違う年のファイルだった。他の候補を試す
      issues.push(`${doc.fileName}: ${String(year)} 年のデータを含みません`);
      continue;
    }

    const validation = validateBucket(bucket, parsed.diagnostics);
    if (!validation.ok) {
      archived.entry.parseStatus = 'failed';
      return {
        year,
        status: 'rejected',
        reason: 'バリデーションに失敗しました',
        issues: validation.issues.map((v) => `${v.id}: ${v.message}`),
      };
    }

    archived.entry.parseStatus = 'ok';
    archived.entry.years = toBuckets(parsed).map((b) => b.year);

    const source = toSourceInfo(archived.entry, pageUrl, archived.entry.lastSeenAt);
    const incoming = buildYearSchedule(bucket, source, parsed.notes, now);
    const merged = mergeYearSchedule(await readYear(storage, year), incoming);

    await writeYear(storage, cache, merged);
    index.years[String(year)] = toYearEntry(merged);
    index.activeYears = Object.keys(index.years)
      .map(Number)
      .sort((a, b) => a - b);

    return archived.deduplicated
      ? { year, status: 'unchanged', fileName: doc.fileName }
      : {
          year,
          status: 'ok',
          dayCount: merged.days.length,
          complete: merged.complete,
          fileName: doc.fileName,
        };
  }

  return { year, status: 'rejected', reason: '取り込める候補がありませんでした', issues };
}

/** 原本から派生データを作り直す。パーサ修正後の即時復旧に使う（§11.4 admin） */
export async function regenerateFromArchive(
  config: IngestConfig,
  entry: ArchiveEntry,
  now: Date,
): Promise<YearOutcome[]> {
  const { storage, cache, pageUrl } = config;
  const bytes = await storage.get(entry.key);
  if (bytes == null) throw new Error(`原本が見つかりません: ${entry.key}`);

  const parsed = parseDocument({
    bytes,
    fileName: entry.fileName,
    contentType: entry.contentType,
    linkLabel: entry.label,
  });

  const index = await readIndex(storage);
  const active = new Set(activeYears(now));
  const outcomes: YearOutcome[] = [];

  for (const bucket of toBuckets(parsed)) {
    if (!active.has(bucket.year)) continue;
    const validation = validateBucket(bucket, parsed.diagnostics);
    if (!validation.ok) {
      outcomes.push({
        year: bucket.year,
        status: 'rejected',
        reason: 'バリデーションに失敗しました',
        issues: validation.issues.map((v) => `${v.id}: ${v.message}`),
      });
      continue;
    }
    const source = toSourceInfo(entry, pageUrl, entry.lastSeenAt);
    const merged = mergeYearSchedule(
      await readYear(storage, bucket.year),
      buildYearSchedule(bucket, source, parsed.notes, now),
    );
    await writeYear(storage, cache, merged);
    index.years[String(bucket.year)] = toYearEntry(merged);
    outcomes.push({
      year: bucket.year,
      status: 'ok',
      dayCount: merged.days.length,
      complete: merged.complete,
      fileName: entry.fileName,
    });
  }

  index.updatedAt = now.toISOString();
  await writeIndex(storage, cache, index);
  return outcomes;
}
