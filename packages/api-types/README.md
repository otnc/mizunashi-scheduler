# @mizunashi/api-types

函館市 **水無海浜温泉** の入浴可能時間 API（[非公式](https://github.com/otnc/mizunashi-scheduler)）のレスポンス型定義です。

**依存ゼロ。** 実行時に持つのは `API_VERSION` と `SCHEMA_VERSION` の 2 つの定数だけです。CJS と ESM の両方から型を解決できます。

```bash
npm install @mizunashi/api-types
```

## 使い方

```ts
import type { StatusResponse, PeriodResponse, ResponseMeta } from '@mizunashi/api-types';

const res = await fetch('https://example.com/api/v1/status');
const status = (await res.json()) as StatusResponse;

if (status.state === 'open') {
  console.log(`${status.current?.end} まで`);
}
```

HTTP クライアントごと欲しい場合は [`@mizunashi/api-client`](https://www.npmjs.com/package/@mizunashi/api-client) を使ってください。

## 主な型

| 型 | 用途 |
| --- | --- |
| `StatusResponse` | `/api/v1/status` |
| `PeriodResponse` | `/api/v1/days` `/weeks` `/months` `/years` に共通 |
| `YearsResponse` | 提供中の年の一覧 |
| `MetaResponse` | 施設情報・出典 |
| `ProblemDetails` | エラー（RFC 9457） |
| `ResponseMeta` | すべてのレスポンスに含まれるメタ情報 |

### 押さえておくべき点

**期間ビュー 4 種は同じ形を返します。** `day` / `week` / `month` / `year` はすべて `PeriodResponse` で、`scope` と `range` だけが違います。1 つのレンダラで全ビューを扱えます。

**1 日に複数回入れるのが常態です。** `sessions` は必ず全件を見てください。`sessions[0]` だけを扱う実装や、`summary.firstStart`〜`summary.lastEnd` を「入浴可能時間」として表示する実装は誤りになります（その間には入れない時間帯が含まれます）。合計は `summary.totalMinutes` を使ってください。

**`nextToday` と `openFrom` は別物です。** 前者は日をまたがない次のセッション、後者は日をまたいで探した次です。両者の差が「今日まだ入れるか」を表します。

**すべてのレスポンスに `meta` が付きます。** `meta.fetchedAt`（原本の取得時刻）と `meta.servedAt`（レスポンスの生成時刻）で、情報の鮮度が判断できます。

## バージョニング

メジャーバージョンは API のバージョンに追従します（`1.x` ↔ `/api/v1`）。

型定義は [`packages/schema`](https://github.com/otnc/mizunashi-scheduler/tree/main/packages/schema) の Zod 定義と**型等価であることがコンパイル時に検証されています**。ずれた状態で公開されることはありません。

## 著者

otoneko. https://github.com/otnc

## ライセンス

MIT
