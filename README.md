# mizunashi-scheduler

函館市の **水無海浜温泉** に「今入れるか」「いつまで入れるか」「次はいつから入れるか」を答える Web サイトと API です。**非公式**のサービスです。

水無海浜温泉は海中に湧く天然の露天風呂で、**潮の干満によって入浴できる時間が日ごとに変わります**。函館市が年に一度 Excel で公開している時間表を機械可読化し、現地で開いてもすぐ判断できる形にします。

## なぜ作るのか

一次資料は 12 シートの印刷用 Excel で、「今入れるのか」を知るのにファイルをダウンロードして該当月・該当日を辿る必要があります。電波が良好とは限らない現地でこれは現実的ではありません。

さらに**旧年度のファイルは公式サイトから削除されます**（2024 / 2025 年版がいずれも 404 であることを実測で確認）。取得した原本は永久保存し、失われないようにします。

## 構成

```
apps/
  api/          Cloudflare Workers 上の API（Hono）と取得の定期実行
  web/          Astro の静的サイト
packages/
  schema/       Zod によるデータ定義（唯一の情報源・非公開）
  parser/       xlsx / csv を読む構造推論パーサ（非公開）
  core/         取得パイプライン・状態判定・期間計算（非公開）
  api-types/    npm 公開。API レスポンスの型定義
  api-client/   npm 公開。薄い fetch クライアント
```

## 公開パッケージ

| パッケージ | 内容 |
| --- | --- |
| [`@mizunashi/api-types`](./packages/api-types) | レスポンスの型定義。依存ゼロ・CJS / ESM 両対応 |
| [`@mizunashi/api-client`](./packages/api-client) | 薄い fetch クライアント |

```ts
import { MizunashiClient } from '@mizunashi/api-client';

const client = new MizunashiClient();
const { data } = await client.status();

if (data.state === 'open') {
  console.log(`${data.current?.end} まで入浴できます`);
} else if (data.nextToday != null) {
  console.log(`次は今日 ${data.nextToday.start} から`);
}
```

## セットアップ

Node.js 22 以上、pnpm 10 以上が必要です。

```bash
pnpm install --frozen-lockfile
pnpm check          # lint / format / typecheck / test / 不変条件
```

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | CI と完全に同じ検証 |
| `pnpm build` | 公開パッケージのビルド |
| `pnpm verify:dist` | 公開パッケージの CJS / ESM 両対応を実測で検証 |
| `pnpm --filter @mizunashi/api dev` | API をローカル起動（Miniflare） |
| `pnpm --filter @mizunashi/web dev` | サイトをローカル起動 |

## この設計で重要な 3 点

**1 日に複数回入れるのが常態です。** 2021 年版では 2 回以上ある日が 365 日中 253 日でした。「入浴不可」は「今日はもう無理」を意味しません。API は `nextToday`（日をまたがない次）と `next`（日をまたぐ次）を別々に返します。現地へ向かうかの判断が真逆になるためです。

**フォーマットは毎年変わります。** 12 年分を調査した結果、命名規則・ファイル形式・時刻表現・対象期間・列の意味がすべて変動していました。パーサは列位置を決め打たず、ヘッダの語句と値の形から構造を推論します。

**取得した原本は消しません。** 公式サイトから消えた後は、保存したものが唯一残る版になります。一方で提供する時間表は今年と来年のみで、それ以外の派生データは自動的に破棄します（原本から再生成できるため可逆）。

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/DESIGN.md](./docs/DESIGN.md) | 設計・仕様・判断根拠（ADR） |
| [docs/OPERATIONS.md](./docs/OPERATIONS.md) | 障害対応と定型作業の手順 |
| [AGENTS.md](./AGENTS.md) | 開発・運用の規約 |

調査の詳細（12 年分のフォーマット変動、実在するデータ欠陥）は DESIGN.md §4.4 にあります。

## 出典と免責

本サイトは函館市が公開している「水無海浜温泉入浴可能時間表」をもとに作成した**非公式**の情報提供サービスです。

出典: [函館市公式ホームページ](https://www.city.hakodate.hokkaido.jp/docs/2014041800107/)

入浴可能時間はあくまで潮位表に基づく目安です。**荒天や高波などの気象状況により、全日入浴できない場合があります。** 海中の露天風呂であり、波・潮位・気温により危険が伴います。最新かつ正確な情報は必ず公式サイトおよび函館市椴法華支所産業建設課（0138-86-2111）にてご確認ください。

本サイトの情報に起因する損害について、運営者は責任を負いません。

## 著者

otoneko. https://github.com/otnc

## ライセンス

MIT
