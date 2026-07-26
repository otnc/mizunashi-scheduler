import { readJson, writeJson, type Storage } from '../storage.js';
import type { DiscoveredDocument } from './discover.js';

/**
 * 原本は内容アドレスで保存する。2 週間ごとに無条件で取得するため（ADR-019）、
 * 同一内容を年 26 回書き込むことになる。キーが内容から決まっていれば自然に
 * 重複排除され、内容が変わったときだけ新しいオブジェクトが増える。
 *
 * 対象年をキーに含めないのは、保存がパースより先だから。年はパースして初めて
 * 確定するため（R2.xlsx の中身が 2021 年である前例がある・§4.4.2）、
 * 保存時点で年を決め打つと誤った場所に置くことになる。年は manifest が持つ。
 */
export const OBJECT_PREFIX = 'raw/objects/';
export const MANIFEST_KEY = 'raw/manifest.json';

export interface ArchiveEntry {
  sha256: string;
  key: string;
  fileName: string;
  format: string;
  bytes: number;
  contentType: string | null;
  sourceUrl: string;
  label: string | null;
  firstSeenAt: string;
  /** この内容が最後に公式サイトで確認できた時刻。削除された時期の目安になる */
  lastSeenAt: string;
  /** パースして確定した対象年。未パース / 失敗時は null */
  years: number[] | null;
  parseStatus: 'ok' | 'failed' | 'skipped';
}

export interface ArchiveManifest {
  schemaVersion: 1;
  entries: ArchiveEntry[];
  lastRunAt: string | null;
}

/**
 * 毎回新しいオブジェクトを作る。定数をスプレッドすると entries 配列の参照が共有され、
 * モジュールスコープが保持される Workers ではリクエストをまたいで履歴が混ざる。
 */
function emptyManifest(): ArchiveManifest {
  return { schemaVersion: 1, entries: [], lastRunAt: null };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // slice() で専用の ArrayBuffer を作る。元の Uint8Array が大きなバッファの一部でも安全
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function objectKey(sha256: string, fileName: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? 'bin';
  return `${OBJECT_PREFIX}${sha256}.${ext}`;
}

export async function readManifest(storage: Storage): Promise<ArchiveManifest> {
  return (await readJson<ArchiveManifest>(storage, MANIFEST_KEY)) ?? emptyManifest();
}

export async function writeManifest(storage: Storage, manifest: ArchiveManifest): Promise<void> {
  await writeJson(storage, MANIFEST_KEY, manifest);
}

export interface ArchiveResult {
  entry: ArchiveEntry;
  /** 既に同じ内容が保存されていたか */
  deduplicated: boolean;
}

/**
 * 原本を保存する。**パースより先に呼ぶ。**
 * パースに失敗しても原本は残り、パーサを直したあとに再生成できる（DESIGN.md §7.4）。
 */
export async function archiveRaw(
  storage: Storage,
  manifest: ArchiveManifest,
  doc: DiscoveredDocument,
  bytes: Uint8Array,
  contentType: string | null,
  now: Date,
): Promise<ArchiveResult> {
  const sha256 = await sha256Hex(bytes);
  const key = objectKey(sha256, doc.fileName);
  const at = now.toISOString();

  const existing = manifest.entries.find((e) => e.sha256 === sha256);
  if (existing) {
    existing.lastSeenAt = at;
    // 同じ内容が別 URL でも配信されることがある。最後に見た URL を残す
    existing.sourceUrl = doc.url;
    return { entry: existing, deduplicated: true };
  }

  await storage.put(key, bytes, contentType == null ? {} : { contentType });

  const entry: ArchiveEntry = {
    sha256,
    key,
    fileName: doc.fileName,
    format: doc.format,
    bytes: bytes.byteLength,
    contentType,
    sourceUrl: doc.url,
    label: doc.label === '' ? null : doc.label,
    firstSeenAt: at,
    lastSeenAt: at,
    years: null,
    parseStatus: 'skipped',
  };
  manifest.entries.push(entry);
  return { entry, deduplicated: false };
}
