import { Hono } from 'hono';
import {
  PageStructureError,
  readManifest,
  regenerateFromArchive,
  runIngest,
  type Http,
} from '@mizunashi/core';
import type { Deps } from '../deps.js';
import { ApiProblem } from '../errors.js';

export interface AdminDeps extends Deps {
  http: Http;
  adminToken: string | undefined;
}

/** タイミング攻撃を避けるため、長さと内容を定数時間で比較する */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface IngestBody {
  fromArchive?: string;
}

export function adminRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  app.use('/api/v1/admin/*', async (c, next) => {
    const expected = deps.adminToken;
    if (expected == null || expected === '') {
      throw new ApiProblem('unauthorized', '管理エンドポイントは無効です');
    }
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!safeEqual(token, expected)) {
      throw new ApiProblem('unauthorized', '認証に失敗しました');
    }
    await next();
  });

  app.post('/api/v1/admin/ingest', async (c) => {
    const now = deps.now();
    const body = await c.req.json<IngestBody>().catch((): IngestBody => ({}));

    // 原本から派生データを作り直す。パーサ修正後の即時復旧に使う
    if (body.fromArchive != null) {
      const manifest = await readManifest(deps.storage);
      const entry = manifest.entries.find((e) => e.sha256 === body.fromArchive);
      if (entry == null) throw new ApiProblem('not-found', '該当する原本がありません');
      const outcomes = await regenerateFromArchive(
        { pageUrl: deps.pageUrl, storage: deps.storage, cache: deps.cache, http: deps.http },
        entry,
        now,
      );
      return c.json({ mode: 'fromArchive', sha256: entry.sha256, years: outcomes });
    }

    try {
      const result = await runIngest(
        { pageUrl: deps.pageUrl, storage: deps.storage, cache: deps.cache, http: deps.http },
        now,
      );
      return c.json({ mode: 'ingest', ...result });
    } catch (err) {
      // 公式サイト側の障害はこちらの内部エラーではない。運用者が原因を切り分けられるよう分ける
      if (err instanceof PageStructureError) {
        throw new ApiProblem('data-unavailable', `公式ページを取得できません: ${err.message}`);
      }
      throw err;
    }
  });

  return app;
}
