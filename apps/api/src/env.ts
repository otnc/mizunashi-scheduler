import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  ARCHIVE: R2Bucket;
  KV: KVNamespace;
  PAGE_URL: string;
  PUBLIC_BASE_URL: string;
  USER_AGENT: string;
  /** "true" のときだけ /archive で原本を配信する。未設定なら無効 */
  ARCHIVE_PUBLIC?: string;
  /** 管理エンドポイント用。wrangler secret put で設定する */
  ADMIN_TOKEN?: string;
}
