# @mizunashi/api-client

函館市 **水無海浜温泉** の入浴可能時間 API（[非公式](https://github.com/otnc/mizunashi-scheduler)）の薄いクライアントです。

標準の `fetch` だけを使うので、ブラウザ / Node / Cloudflare Workers / Deno で同じコードが動きます。CJS と ESM の両方に対応しています。

```bash
npm install @mizunashi/api-client
```

## 使い方

```ts
import { MizunashiClient } from '@mizunashi/api-client';

const client = new MizunashiClient({ baseUrl: 'https://example.com' });

const { data, receivedAt, ageSeconds } = await client.status();

if (data.state === 'open') {
  console.log(`${data.current?.end} まで入浴できます`);
} else if (data.nextToday != null) {
  console.log(`次は今日 ${data.nextToday.start} から`);
} else if (data.next != null) {
  console.log(`本日は終了。次は ${data.next.date} ${data.next.start} から`);
}
```

### 期間ビュー

4 種とも同じ形が返るので、1 つのレンダラで扱えます。

```ts
await client.day('today');
await client.day('2026-07-26');
await client.week('today');        // 指定日から 7 日間（暦週に丸めない）
await client.month(2026, 7);       // 1 日から最終日まで
await client.year('current');
await client.range('2026-07-26', '2026-08-01');
```

### 年の切替

```ts
const { data } = await client.years();
// data.activeYears が 2 件以上なら来年の時間表が公開されている
```

### エラー

`problem+json` を `MizunashiApiError` として投げます。

```ts
import { MizunashiApiError } from '@mizunashi/api-client';

try {
  await client.range('2026-01-01', '2028-01-01');
} catch (err) {
  if (err instanceof MizunashiApiError) {
    console.error(err.status, err.type, err.detail);
  }
}
```

### 静的バリアント

`at: 'none'` を渡すと、現在時刻に依存する `relative` を省いた**共有キャッシュ可能な**レスポンスになります。相対的な情報が要らない場合や、自前で計算する場合に使ってください。

```ts
const { data } = await client.month(2026, 7, { at: 'none' });
```

### オプション

```ts
new MizunashiClient({
  baseUrl,          // 既定は公式ホスト
  fetch: myFetch,   // 差し替え可能。テストのフェイクをそのまま渡せる
  timeoutMs: 10000,
  userAgent,        // 連絡先を入れておくと運営側から辿れる
});
```

各メソッドは `AbortSignal` を受け取れます。

## 意図的に持たない機能

リトライのバックオフ戦略、永続キャッシュ、React フック、日時の書式整形は**入れていません**。利用者ごとに要件が違い、薄さという価値を壊すためです。必要なら呼び出し側で組み合わせてください。

## 受信時刻について

レスポンスは `{ data, receivedAt, ageSeconds }` の形で返ります。`data.meta.servedAt` は **origin がペイロードを生成した時刻**なので、共有キャッシュを経由すると最大でキャッシュの有効期間だけ古くなります。正確な受信時刻が必要なときは `receivedAt`（クライアントの時計）か `ageSeconds`（HTTP の `Age` ヘッダ）を使ってください。

なお、現在時刻に依存する値を含むレスポンスはサーバ側で共有キャッシュを禁止しているため、通常 `ageSeconds` は `null` になります。

## 著者

otoneko. https://github.com/otnc

## ライセンス

MIT
