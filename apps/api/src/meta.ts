import type { ResponseMeta } from '@mizunashi/api-types';
import type { YearSchedule } from '@mizunashi/schema';

/**
 * すべてのレスポンスに付ける meta（DESIGN.md §11.2）。
 * エラーレスポンスにも付ける。障害報告を受けたときに「いつ時点のデータで、
 * いつ配信されたレスポンスか」が分かるだけで切り分けが速くなる。
 */
export function buildMeta(
  years: readonly YearSchedule[],
  pageUrl: string,
  now: Date,
): ResponseMeta {
  const servedAt = now.toISOString();

  const sources = years.flatMap((y) =>
    y.sources.map((s) => ({ year: y.year, fetchedAt: s.fetchedAt, sha256: s.sha256 })),
  );

  // 複数年にまたがる場合は最も古い取得時刻を採る。
  // 「このレスポンス全体として最低でもこの時点のデータである」を意味する
  const fetchedAt = sources.map((s) => s.fetchedAt).sort()[0] ?? null;
  const generatedAt = years.map((y) => y.generatedAt).sort()[0] ?? null;

  return {
    servedAt,
    fetchedAt,
    generatedAt,
    dataAgeSeconds:
      fetchedAt == null
        ? null
        : Math.max(0, Math.round((now.getTime() - Date.parse(fetchedAt)) / 1000)),
    timezone: 'Asia/Tokyo',
    apiVersion: 'v1',
    schemaVersion: 1,
    source: {
      pageUrl,
      fileName: years[years.length - 1]?.sources.at(-1)?.fileName ?? '',
      years: sources,
    },
  };
}
