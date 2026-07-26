# @mizunashi/api

Cloudflare Workers 上の API です。Hono で構成し、静的サイトと同一オリジンで配信します。

同一オリジンなのでフロントは `/api/v1/...` を相対パスで叩けます。CORS のプリフライトが発生せず、デプロイもドメインも 1 つで済みます。

## エンドポイント

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/v1/status` | 現在（または指定時刻）の入浴可否 |
| GET | `/api/v1/days/{date}` | 単日。`today` / `tomorrow` も可 |
| GET | `/api/v1/weeks/{date}` | 指定日から 7 日間 |
| GET | `/api/v1/months/{YYYY-MM}` | 1 日から最終日まで。`current` も可 |
| GET | `/api/v1/years/{year}` | 年。`current` も可 |
| GET | `/api/v1/days?from=&to=` | 任意期間（最大 400 日） |
| GET | `/api/v1/years` | 提供中の年の一覧 |
| GET | `/api/v1/meta` | 施設情報・出典 |
| GET | `/api/v1/calendar.ics` | iCalendar フィード |
| GET | `/api/v1/openapi.json` | OpenAPI 3.0.3 定義 |
| GET | `/api/v1/docs` | Swagger UI |
| GET | `/api/v1/healthz` | ヘルスチェック |
| GET | `/archive` | 原本の一覧（既定で無効） |
| GET | `/archive/{year}/{file}` | 原本のダウンロード（既定で無効） |
| POST | `/api/v1/admin/ingest` | 手動取り込み（Bearer 認証） |

## 原本配信は既定でオフです

`/archive/*` は環境変数 `ARCHIVE_PUBLIC` が `"true"` のときだけ有効になります。無効時はルート自体を生やさないので `404` を返します。

原本は R2 に保管し続けますが、公開すると大量ダウンロードが R2 の課金につながりうるため、既定では配信しません。有効化する場合は `wrangler.toml` の `ARCHIVE_PUBLIC` を `"true"` にしたうえで、`/archive/*` にレートリミットをかけてください。現在の設定は `/api/v1/healthz` の `checks.archivePublic` で確認できます。

**期間ビュー 4 種は同じ形を返します。** `scope` と `range` だけが違うので、クライアントは 1 つのレンダラで扱えます。

## API ドキュメント

`/api/v1/openapi.json`（OpenAPI 3.0.3）を `/api/v1/docs`（Swagger UI）で見られます。

`components.schemas` は [`packages/schema`](../../packages/schema) の Zod 定義から [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) で生成しています（[`src/openapi/schemas.ts`](./src/openapi/schemas.ts)）。手で書き写すと実装とドキュメントが食い違いうるため、`@mizunashi/api-types` と同じく唯一の情報源（Zod）から導出しています。パス・パラメータの説明（[`src/openapi/document.ts`](./src/openapi/document.ts)）は手で書いています。

## 共通のパラメータ

| 名前 | 内容 |
| --- | --- |
| `at` | 判定の基準時刻。`none` を渡すと現在時刻に依存する `relative` を省いた静的レスポンスになる |
| `lang` | `ja`（既定）/ `en` |
| `grid=1` | 月ビューでカレンダーグリッドを追加 |

## すべてのレスポンスに `meta` が付きます

```json
"meta": {
  "servedAt": "2026-07-26T09:31:00.412Z",
  "fetchedAt": "2026-07-22T17:15:04.000Z",
  "dataAgeSeconds": 317156,
  "source": { "pageUrl": "...", "fileName": "mizunashi2026.xlsx", "years": [...] }
}
```

エラー（RFC 9457 の `problem+json`）にも付きます。障害報告を受けたときに「いつ時点のデータで、いつ配信されたレスポンスか」が分かるだけで切り分けが速くなります。

## キャッシュ

| レスポンス | `Cache-Control` |
| --- | --- |
| `relative` を含む（`at` 未指定・`/status`） | `no-store` |
| `at=none` の静的バリアント | `public, max-age=3600, s-maxage=86400` |
| `/archive/*` | `immutable` |

**現在時刻に依存する値を含むレスポンスは共有キャッシュしません。** `servedAt` だけでなく `endsInSeconds` のような相対値まで古くなるためです。切り分けの基準を「現在時刻に依存するか」に統一しています。

## 定期実行

```toml
crons = ["15 17 1,15 * *", "15 17 * 11,12,1 *"]
```

通常は 2 週間ごと、11〜1 月は翌年版の公開時期なので日次です。処理は状態を持たず、毎回作り直します（[`@mizunashi/core`](../../packages/core) を参照）。

## ローカル開発

```bash
pnpm --filter @mizunashi/api dev     # wrangler dev --local
pnpm --filter @mizunashi/api test
```

テストは Hono の `app.request()` と `MemoryStorage` を使い、**外部ネットワークに一切出ません**。契約テストとして、実レスポンスが `packages/schema` の Zod 定義を満たすことを全エンドポイントで検証しています。

## デプロイ前に必要なこと

R2 バケット `mizunashi-archive` と KV namespace は作成済みで、ID は `wrangler.toml` に入っています。`ADMIN_TOKEN` だけ `wrangler secret put ADMIN_TOKEN` で設定してください（値をファイルに書かないでください）。
