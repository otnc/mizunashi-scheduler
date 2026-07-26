import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import {
  assertDeletable,
  type Cache,
  type Http,
  type HttpResponse,
  type Storage,
} from '@mizunashi/core';

export class R2Storage implements Storage {
  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string): Promise<Uint8Array | null> {
    const object = await this.bucket.get(key);
    return object == null ? null : new Uint8Array(await object.arrayBuffer());
  }

  async getText(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    return object == null ? null : await object.text();
  }

  async put(
    key: string,
    body: Uint8Array | string,
    opts?: { contentType?: string },
  ): Promise<void> {
    await this.bucket.put(key, body, {
      ...(opts?.contentType == null ? {} : { httpMetadata: { contentType: opts.contentType } }),
    });
  }

  async has(key: string): Promise<boolean> {
    return (await this.bucket.head(key)) != null;
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, ...(cursor == null ? {} : { cursor }) });
      for (const object of page.objects) keys.push(object.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor != null);
    return keys.sort();
  }

  async delete(key: string): Promise<void> {
    // 原本の削除は復元不能。lint とコードの二重で止める（ADR-006 / ADR-009）
    assertDeletable(key);
    await this.bucket.delete(key);
  }
}

export class KvCache implements Cache {
  constructor(private readonly kv: KVNamespace) {}

  get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  put(key: string, value: string): Promise<void> {
    return this.kv.put(key, value);
  }

  delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }
}

/**
 * 公式サイトへのアクセス。User-Agent を明示して連絡先を辿れるようにする
 * （DESIGN.md §18.1）。
 */
export class FetchHttp implements Http {
  constructor(private readonly userAgent: string) {}

  async get(url: string): Promise<HttpResponse> {
    const res = await fetch(url, { headers: { 'user-agent': this.userAgent } });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: res.status,
      headers,
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  }
}
