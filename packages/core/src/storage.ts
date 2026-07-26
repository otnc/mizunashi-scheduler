/**
 * ストレージの抽象。R2 / ローカル FS / S3 のどれでも差し替えられるようにしておく。
 * これが VPS 構成への移行可能性を担保する（DESIGN.md §5.3 / ADR-001）。
 */

export const RAW_PREFIX = 'raw/';

export class ImmutablePrefixError extends Error {
  constructor(key: string) {
    super(`原本は削除・上書きできません: ${key}`);
    this.name = 'ImmutablePrefixError';
  }
}

/**
 * 原本の削除を型やレビューではなくコードで止める。
 * lint ルールと二重にしてあるのは、失うと復元不能だから（ADR-006 / ADR-009）。
 */
export function assertDeletable(key: string): void {
  if (key.startsWith(RAW_PREFIX)) throw new ImmutablePrefixError(key);
}

export interface Storage {
  get(key: string): Promise<Uint8Array | null>;
  getText(key: string): Promise<string | null>;
  put(key: string, body: Uint8Array | string, opts?: { contentType?: string }): Promise<void>;
  has(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  /** raw/ 配下を渡すと ImmutablePrefixError を投げる */
  delete(key: string): Promise<void>;
}

/** 読み取り高速化のためのキャッシュ層。真実の源は常に Storage 側にある */
export interface Cache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array;
}

export interface Http {
  get(url: string): Promise<HttpResponse>;
}

export async function readJson<T>(storage: Storage, key: string): Promise<T | null> {
  const text = await storage.getText(key);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeJson(storage: Storage, key: string, value: unknown): Promise<void> {
  await storage.put(key, JSON.stringify(value), { contentType: 'application/json; charset=utf-8' });
}

/** テストとローカル開発で使うメモリ実装 */
export class MemoryStorage implements Storage {
  readonly #objects = new Map<string, Uint8Array>();

  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.#objects.get(key) ?? null);
  }

  getText(key: string): Promise<string | null> {
    const v = this.#objects.get(key);
    return Promise.resolve(v == null ? null : new TextDecoder().decode(v));
  }

  put(key: string, body: Uint8Array | string): Promise<void> {
    this.#objects.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body);
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.#objects.has(key));
  }

  list(prefix: string): Promise<string[]> {
    return Promise.resolve([...this.#objects.keys()].filter((k) => k.startsWith(prefix)).sort());
  }

  // Promise を返す契約なので、ガードも同期 throw ではなく reject にする
  async delete(key: string): Promise<void> {
    await Promise.resolve();
    assertDeletable(key);
    this.#objects.delete(key);
  }

  /** テスト用。ガードを迂回して中身を確認する */
  keys(): string[] {
    return [...this.#objects.keys()].sort();
  }
}

export class MemoryCache implements Cache {
  readonly #entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#entries.get(key) ?? null);
  }

  put(key: string, value: string): Promise<void> {
    this.#entries.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }

  keys(): string[] {
    return [...this.#entries.keys()].sort();
  }
}
