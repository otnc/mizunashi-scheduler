import { Hono } from 'hono';
import { readManifest, type ArchiveEntry } from '@mizunashi/core';
import type { Deps } from '../deps.js';
import { ApiProblem } from '../errors.js';

const CONTENT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  pdf: 'application/pdf',
};

function extensionOf(fileName: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? 'bin';
}

/** 同じ年・同じ名前で複数のリビジョンがある場合は、最後に確認できたものを採る */
function pick(
  entries: readonly ArchiveEntry[],
  year: number,
  fileName: string,
): ArchiveEntry | null {
  const matched = entries
    .filter((e) => e.fileName === fileName && (e.years ?? []).includes(year))
    .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
  return matched.at(-1) ?? null;
}

/**
 * 取得した原本の公開。提供対象外の年でも原本はここから取得できる（DESIGN.md §3.4）。
 * 内容アドレスで保存しているため、URL は年とファイル名で引ける形に見せる。
 */
export function archiveRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/archive', async (c) => {
    const manifest = await readManifest(deps.storage);
    c.header('cache-control', 'public, max-age=3600');
    return c.json({
      entries: manifest.entries
        .map((e) => ({
          fileName: e.fileName,
          years: e.years,
          format: e.format,
          bytes: e.bytes,
          sha256: e.sha256,
          firstSeenAt: e.firstSeenAt,
          lastSeenAt: e.lastSeenAt,
          parseStatus: e.parseStatus,
          url:
            e.years == null || e.years.length === 0
              ? null
              : `/archive/${String(e.years[0])}/${e.fileName}`,
        }))
        .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt)),
      lastRunAt: manifest.lastRunAt,
    });
  });

  app.get('/archive/:year/:fileName', async (c) => {
    const year = Number(c.req.param('year'));
    const fileName = c.req.param('fileName');
    if (!Number.isInteger(year) || !/^[A-Za-z0-9._-]+$/.test(fileName)) {
      throw new ApiProblem('invalid-parameter', '年またはファイル名の形式が不正です');
    }

    const manifest = await readManifest(deps.storage);
    const entry = pick(manifest.entries, year, fileName);
    if (entry == null) throw new ApiProblem('not-found', '該当する原本がありません');

    const bytes = await deps.storage.get(entry.key);
    if (bytes == null) throw new ApiProblem('not-found', '原本の実体が見つかりません');

    // 内容アドレスなので中身が変わることはない
    c.header('cache-control', 'public, max-age=31536000, immutable');
    c.header(
      'content-type',
      entry.contentType ?? CONTENT_TYPES[extensionOf(fileName)] ?? 'application/octet-stream',
    );
    c.header('content-disposition', `inline; filename="${fileName}"`);
    c.header('x-content-sha256', entry.sha256);
    return c.body(bytes.buffer as ArrayBuffer);
  });

  return app;
}
