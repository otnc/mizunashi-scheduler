import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { runIngest } from '@mizunashi/core';
import { createApp } from './app.js';
import type { Deps } from './deps.js';
import type { Env } from './env.js';
import { FetchHttp, KvCache, R2Storage } from './storage/cloudflare.js';

export { createApp } from './app.js';
export type { Deps } from './deps.js';

function depsFrom(env: Env): Deps {
  return {
    storage: new R2Storage(env.ARCHIVE),
    cache: new KvCache(env.KV),
    now: () => new Date(),
    pageUrl: env.PAGE_URL,
    baseUrl: env.PUBLIC_BASE_URL,
    archivePublic: env.ARCHIVE_PUBLIC === 'true',
  };
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const deps = depsFrom(env);
    const app = createApp(deps, {
      ...deps,
      http: new FetchHttp(env.USER_AGENT),
      adminToken: env.ADMIN_TOKEN,
    });
    return app.fetch(request, env, ctx);
  },

  /**
   * 2 週間ごと（11〜1 月は日次）に無条件で取得して作り直す（ADR-019）。
   * 状態を持たないので、パーサを直せば次の実行で自動的に回復する。
   */
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const deps = depsFrom(env);
    ctx.waitUntil(
      runIngest(
        {
          pageUrl: env.PAGE_URL,
          storage: deps.storage,
          cache: deps.cache,
          http: new FetchHttp(env.USER_AGENT),
        },
        new Date(),
      ).then((result) => {
        console.warn('ingest.complete', JSON.stringify(result));
      }),
    );
  },
};
