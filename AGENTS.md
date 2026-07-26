# 運用ルール

このファイルは**運用ルール**（人間・Claude 双方が従う規約）をまとめたものです。設計とその判断根拠は [DESIGN.md](./docs/DESIGN.md) を参照してください。ここに書かれたルールは必須で、逸脱する場合は PR で明示的に合意してください。

## 1. 文書の役割分担

どこに何を書くかを固定します。同じことを 2 箇所に書かない。

| ファイル | 書くもの | 書かないもの |
| --- | --- | --- |
| [docs/DESIGN.md](./docs/DESIGN.md) | 設計・仕様・判断根拠（ADR） | 手順、日々の運用ルール |
| **AGENTS.md**（このファイル） | 開発・運用の規約 | 設計の詳細、障害対応の手順 |
| docs/OPERATIONS.md | 障害対応・定型作業の手順書 | 規約、設計 |
| CLAUDE.md | AGENTS.md への参照のみ | それ以外 |

**設計に関わる変更は、実装より先に DESIGN.md を更新する。** 判断が分かれる決定をしたら ADR（付録B）に追記し、PR で該当 ADR 番号を示す。

## 2. 言語ポリシー

**原則: リポジトリに残る成果物・コミュニケーションはすべて日本語。** ドキュメント、コミットメッセージ、PR 本文、コードコメント、Issue が対象。

### 英語のままにするもの

以下は機械可読性・慣習を優先して英語を使う。

- コード上の識別子（変数名・関数名・型名・ファイル名）
- コミットメッセージの `type` と `scope`（Conventional Commits の規約に従うため）
- ログの `code`、API のフィールド名・エラー `type`、`Diagnostics` のコード
- 依存パッケージ名、コマンド名、設定キー

### Markdown の改行

散文をハードラップしない（段落・箇条書きは1行に収める）。ハードラップは余計な半角スペースとして描画され、日本語では特に不自然になる。改行してよいのはコードブロックとテーブルの中だけ。

**Markdown は自動整形の対象外**（[§4](#4-コード品質ルール)）。このルールは執筆時とレビューで守る。

## 3. 開発環境ルール

### 前提ツール

| ツール | 要件 | 指定場所 |
| --- | --- | --- |
| Node.js | **`>=22`** | `package.json` の `engines.node` |
| pnpm | **`>=10`** | `package.json` の `engines.pnpm` |
| Git | 2.40+ | — |

**下限のみを定め、特定バージョンに固定しない。**

- `packageManager` フィールドは設定しない。`.nvmrc` / `.node-version` も置かない。**バージョン管理ツール（nvm-windows / fnm / Volta / asdf など）の選択は各自に委ねる。**
- `.npmrc` に `engine-strict=true` を設定してあるので、下限を満たさない環境では `pnpm install` が失敗する。
- 下限を上げる変更（例: `>=24`）は、必要になった API など理由を PR に書く。
- **CI は下限バージョン（Node 22）で検証する。** 「手元の最新でしか動かない」状態を防ぐため。手元が Node 24 でも、CI が 22 で落ちたらそれは自分のコードの問題。

### セットアップ

```bash
pnpm install --frozen-lockfile
pnpm check          # これが通ればローカル環境は正常
```

`--frozen-lockfile` を必ず付ける。ロックファイルを意図せず書き換えないため。

pnpm が未導入なら `npm i -g pnpm` か `corepack enable pnpm` のどちらでもよい（バージョン固定はしない）。

### よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | **CI と完全に同じ検証**（lint / format / typecheck / test / 不変条件） |
| `pnpm lint:fix` | 自動修正できる lint 違反を直す（`eslint --fix`）|
| `pnpm format` | 全ファイルを整形する（`prettier --write`）|
| `pnpm typecheck` | 型検査のみ |
| `pnpm test` | テストのみ |
| `pnpm --filter api dev` | Worker をローカル起動（`wrangler dev --local`） |
| `pnpm --filter web dev` | Astro をローカル起動 |
| `pnpm parser:debug <file>` | パーサのアダプタ選択結果と Diagnostics を表示 |
| `pnpm build` | 公開パッケージをビルドする（依存順に実行される）|
| `pnpm verify:dist` | 公開パッケージの CJS/ESM 両対応を実測で検証する |

**コミット前に `pnpm check` を通す。** pre-commit フックは軽い整形しか行わないため、これはフックに任せず自分で走らせる。

### シークレットと環境変数

- **`.dev.vars` / `.env` は絶対にコミットしない。** 新規に追加するときは `.gitignore` の対象になっていることを目視で確認する。
- 本番のシークレットは `wrangler secret put` でのみ設定する。ソース・ドキュメント・コミットメッセージ・PR 本文に値を書かない。
- 必要な変数は `.dev.vars.example` にキー名とダミー値だけを置き、実値は書かない。
- 誤ってコミットした場合は、直ちに当該シークレットを**無効化してから**履歴の修正を検討する。履歴を消しても漏れた値は戻らない。

### ネットワークアクセス

**通常の開発とテストでは外部ネットワークに出ない。**

- テストは `packages/core/test/fixtures/` の実データフィクスチャを使う。**公式サイトを叩くテストを書かない**（相手方への負荷、CI の不安定化、オフライン開発の阻害）。
- 外部との通信は MSW でモックする。
- 函館市公式サイトへの手動アクセスは、調査目的で必要なときに限る。その際も User-Agent を明示し、連続アクセスをしない（[DESIGN.md §18.1](./docs/DESIGN.md#181-公式サイトへの配慮)）。
- ローカルの ingest 実行は `--local` の Miniflare 上でフィクスチャを使って行う。

### OS 差異

- **改行は LF 固定。** `.editorconfig` と `.gitattributes` で強制する。Windows で作業していても CRLF をコミットしない。
- パス区切りをコードにハードコードしない。`node:path` は `packages/core` / `packages/parser` では使えない（後述）ため、そもそもファイルパスを扱わない設計にする。
- シェルスクリプトに依存する手順を作らない。自動化は Node スクリプト（`scripts/*.mjs`）で書く。

## 4. コード品質ルール

### フォーマット / リント

**Lint と Format の責務を完全に分ける。** 1 ファイルに対して lint するツールと整形するツールがそれぞれ 1 つだけ対応する状態を保つ（[ADR-016](./docs/DESIGN.md#付録b-adr設計上の意思決定記録)）。

- **Lint は ESLint（Flat Config）。** `.ts` / `.tsx` / `.astro` / `.js` を担当する。型情報を使う構成なので `--cache` を常用する。
- **Format は Prettier。** `.md` を除く**全ファイル**を担当する唯一のフォーマッタ。`.ts` / `.tsx` / `.js` / `.json` / `.css` / `.astro` が対象。
- **ESLint に整形をさせない。** `eslint.config.js` の**配列の最後**に `eslint-config-prettier` を置き、整形系ルールを全無効化する。**この位置を動かさない。** 途中に置くと後続の設定が整形ルールを再有効化し、ESLint と Prettier が衝突する。
- **Prettier に lint をさせない。** 整形以外のプラグインを足さない。
- **`--max-warnings=0`。** warning を放置しない。恒久的に許容するならルールを `off` にするか、理由コメント付きの `eslint-disable` を書く。**理由なしの `eslint-disable` は禁止。**
- **Markdown は自動整形しない。** 日本語散文に対する自動整形は、箇条書き記号・テーブル整列・エスケープの書き換えによって差分ノイズを生むだけで、可読性に寄与しない。守るべきルール（ハードラップ禁止）は [§2](#2-言語ポリシー) の規約とレビューで担保する。
- **整形結果に手を入れない。** スタイルをレビューの論点にしない。
- **自動生成物は手で直さない。** `apps/web/src/components/ui/**`（shadcn/ui）は、いつでも再生成できる状態を保つ。手を入れたくなったらラッパーコンポーネントを別に作る。

### コメント

- **コメントは最小限にする。** コードを読めば分かることを書かない。
- **書くのは「なぜ」。** 何をしているかではなく、その判断をした理由・背景・制約を書く。
- **装飾をしない。** 罫線（`───`、`===`、`***`）、アスキーアート、飾り枠、セクション見出し代わりの区切り線を使わない。設定ファイル（`.gitignore` / `.gitattributes` / `eslint.config.js` など）も同様。
- 長い説明が必要なら、コメントではなく DESIGN.md に書いて該当節へのリンクを 1 行で示す。

### 型

- `strict` に加えて `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noImplicitOverride` を有効にする。
- **`any` は原則禁止。** 型が定まらない値は `unknown` で受けて絞り込む。
- `@ts-expect-error` は理由コメントを必須とする。**`@ts-ignore` は使わない**（誤りが解消しても検出できないため）。
- **非 null アサーション `!` は原則使わない。** 特に `sessions[0]!` のような形は、後述の禁止事項に直結するので許容しない。

### 依存の追加

- 追加は最小限に留める。「便利だから」ではなく「無いと成立しないか」で判断する。
- **Cloudflare Workers で動くことを確認する。** `node:` 依存があるものは原則採用しない。
- **`packages/core` / `packages/parser` / `packages/api-client` では `node:` インポートを禁止する。** Web 標準 API のみを使う。これは VPS 構成への移行可能性を担保するための制約（[DESIGN.md §5.3](./docs/DESIGN.md#53-レイヤ構成)）。
- バージョンは `pnpm-workspace.yaml` の `catalog:` に登録し、各パッケージは `"catalog:"` で参照する。パッケージごとに異なるバージョンを直接書かない。

## 5. このプロジェクト固有の禁止事項

**設計上の不変条件であり、破ると利用者に誤情報が出る。** レビューで最優先に確認する。

| 禁止 | 理由 | 検出手段 |
| --- | --- | --- |
| `getHours()` `getDate()` 等のローカル時刻 API | Workers は UTC で動くため JST 判定が壊れる（[§10.1](./docs/DESIGN.md#101-時刻の意味論)） | ESLint `no-restricted-properties` |
| `timeZone` を省いた `toLocaleString` / `Intl` | 実行環境のタイムゾーンに依存する | ESLint `no-restricted-syntax` |
| `sessions[0]` だけを扱う実装 | 1日に複数回あるのが常態（2021年版では 2 回以上が 253/365 日）。[§13.5](./docs/DESIGN.md#135-daytimeline-の描画仕様) の禁止事項 | ESLint `no-restricted-syntax` + `noUncheckedIndexedAccess` |
| `packages/core` / `packages/parser` / `packages/api-client` での `node:` インポート | プラットフォーム非依存を保つ（[§5.3](./docs/DESIGN.md#53-レイヤ構成)） | ESLint `no-restricted-imports` |
| `test/fixtures/` の実データをコミット | 函館市が公開した原本そのもので、再配布にあたる。`.gitignore` で除外済み | `check-invariants` |
| `test/fixtures/` の編集・整形（改行正規化を含む） | 原本との同一性がゴールデンテストの前提 | ゴールデンテストの期待値 |
| `raw/` 配下のオブジェクト削除 | 原本は永久保存。公式サイトから旧年版が消えるため、失うと復元不能（[ADR-006](./docs/DESIGN.md#付録b-adr設計上の意思決定記録) / ADR-009） | `check-invariants` |
| 年のハードコード | 来年データ公開時に年切替が効かなくなる（FR-10 / [ADR-011](./docs/DESIGN.md#付録b-adr設計上の意思決定記録)） | `check-invariants` |
| `firstStart`〜`lastEnd` を「入浴可能時間」として表示 | 谷を含むため誤り。合計は `totalMinutes` を使う | レビュー |
| ファイル名から対象年を推定する実装 | `R2.xlsx` の中身が 2021 年である実例がある（[§4.4.2](./docs/DESIGN.md#442-命名規則は当てにならない)） | レビュー |
| 通年 365 日を前提にした処理 | 2020年版は 4〜12月の 275 日。会計年度ファイルも存在する | レビュー |
| 公式サイトを叩くテスト | 相手方への負荷、CI の不安定化 | レビュー |
| `meta` を含まない API レスポンス | 利用者が「いつ時点のデータか」を判断できなくなる（[§11.2](./docs/DESIGN.md#112-すべてのレスポンスに含める-meta)） | 契約テスト |
| 現在時刻に依存する値を含むレスポンスの共有キャッシュ | 古い残り時間を返してしまう（[ADR-021](./docs/DESIGN.md#付録b-adr設計上の意思決定記録)） | レビュー |

**これらのルールを `eslint-disable` で黙らせない。** 例外が必要な場面が本当にあるなら、`eslint.config.js` の `files` / `ignores` で範囲を明示し、理由をコメントに書く。

## 6. テスト規約

- **時刻に依存するロジックは `now` を引数で受ける。** `new Date()` を関数内部で呼ばない。テストで任意の時刻を注入できることを設計の前提にする。
- `TZ` 環境変数を `UTC` / `Asia/Tokyo` / `America/New_York` のいずれに変えても結果が変わらないこと。
- **フィクスチャの実データはリポジトリに含めない。** 再配布を避けるため。取得元は `fixtures/README.md` に記載してあるので、必要な開発者が手で落とす。**無い環境ではゴールデンテストはスキップされる。**
- **フィクスチャは本番サービスと無関係。** ingest も API も参照しない。翌年版が公開されてもフィクスチャまわりでやることは何もない。
- **パーサを変更したら、既存 6 件のフィクスチャに対するゴールデンテストが壊れていないことを必ず確認する。** 年 1 回しか更新されないデータなので、壊れたことに気づくのが 1 年後になる事態を防ぐ。
- 新しいフォーマットに対応したら、**その実データを手元に置いてゴールデンテストを書き、取得元を `fixtures/README.md` に追記する**。アダプタだけ足してテストを書かないのは不可。
- 境界時刻（`start` ちょうど / `end` ちょうど / その前後 1 秒）は必ずテストする。

## 7. npm 公開パッケージの規約

`@mizunashi/api-types` と `@mizunashi/api-client` を npm に公開している（[DESIGN.md §11.8](./docs/DESIGN.md#118-npm-での型とラッパーの配信)）。**公開したバージョンは事実上取り消せない**ため、他より慎重に扱う。

- **公開するのは API の契約面だけ。** `@mizunashi/schema` / `parser` / `core` は `private: true` を外さない。内部実装を破壊的変更の対象にしないため。
- **`api-types` の型を変えたら `packages/schema` の Zod 定義も揃える。** 両者の等価性はコンパイル時に検証されるので、片方だけ変えると `pnpm typecheck` が落ちる。落ちたら型を合わせるのであって、アサーションを消して黙らせない。
- **公開は `release-types.yml` / `release-client.yml` を `workflow_dispatch` から実行する。** `version` 入力に semver bump（`patch` / `minor` / `major` / `prerelease`）か明示バージョンを指定する。バージョンの上書き・ビルド・公開・コミット・タグ・GitHub Release の作成までワークフローが行う。タグは `api-types-v1.2.3` / `api-client-v1.2.3` 形式。
- **メジャーバージョンは API バージョンに追従する。** `1.x` ↔ `/api/v1`。API に破壊的変更を入れずにパッケージのメジャーを上げない。
- **手元から `npm publish` しない。** 公開は GitHub Actions の Trusted Publishing (OIDC) からのみ行う。**`NPM_TOKEN` を発行も保存もしない。**
- **`api-client` より先に `api-types` の該当バージョンを公開する。** 逆順に出すとインストールできないパッケージになる。ワークフローが `npm view` で確認する。
- **公開パッケージは CJS / ESM の両方を出す。** `exports` の `import` / `require` それぞれに `types` を付ける。CJS 利用者は `.d.cts` を見に行くため、片方だけだと型が解決できない。
- **`pnpm verify:dist` を通してから公開する。** exports が指すファイルの実在と、両形式からの読み込みを実測する。
- **`api-client` を厚くしない。** リトライ戦略・永続キャッシュ・React フック・日時整形は入れない。利用者ごとに要件が違い、薄さという価値を壊す。

## 8. コミットメッセージ規約（Conventional Commits、日本語）

書式:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`
- **scope**（任意）: `parser` / `core` / `schema` / `api` / `web` / `ingest` / `infra` / `ci` / `docs` / `deps`
- **subject**: **日本語**・常体または体言止め・末尾の句点なし・50 字以内を目安
- **body**（任意）: **なぜ**変えたか。何を変えたかは差分を見れば分かるので書かない
- **footer**（任意）: `BREAKING CHANGE: ...` / `Closes #123`

`type` と `scope` のみ英語なのは、Conventional Commits の機械可読性（自動リリースノート生成など）を保つため。

例:

```
feat(parser): 曜日交差検証で対象年を補正する
fix(api): 谷の時間帯で nextToday が null になる不具合を修正
fix(web): 月間セルで 3 セッション目が描画されない問題を修正
docs(design): 過去ファイル調査の結果を追記
chore(deps): eslint を 9.20 に更新
```

破壊的変更は `type(scope)!: ...` か `BREAKING CHANGE:` footer を必ず付ける。

### コミットの粒度

**コミットは細かい粒度で行う（1 コミット 1 論点）。** 単体でレビューでき、"and"（および・かつ）を使わずに 1 行の subject で説明できる単位にする。

- ファイル単位ではなく関心事で分ける。同じファイルを触っていても、依存の更新とバグ修正は別コミット。
- docs・CI・ソースの変更は、片方だけでは意味を成さない場合を除いて分ける。
- 無関係な作業を "wip" や "misc" のコミットにまとめない。
- push も同じ小さな単位で行い、各ステップで CI が結果を返すようにする。

## 9. ブランチ / PR

- **`main` へ直接 push しない。** ブランチ名は `feat/…` `fix/…` `docs/…` `chore/…`。
- マージには **CI 全緑**が必須。具体的には `.github/workflows/ci.yml` の `check` ジョブ（= `pnpm check`）が成功していること。内訳は以下のすべて。

  | ステップ | 内容 |
  | --- | --- |
  | `pnpm lint` | ESLint（`--max-warnings=0`）|
  | `pnpm format:check` | Prettier の整形差分がないこと |
  | `pnpm typecheck` | `tsc --noEmit` / `astro check` |
  | `pnpm test` | Vitest（ゴールデンテストを含む） |
  | `pnpm check:invariants` | §5 の禁止事項の検出 |

  `check` ジョブは GitHub の必須ステータスチェックに登録する。**失敗したまま強制マージしない。**

- PR 本文に書くこと: **何を・なぜ・どう確認したか**。設計に影響する場合は DESIGN.md の該当節へのリンクを添える。
- 設計変更を伴う PR は、DESIGN.md（必要なら ADR）の更新を**同じ PR に含める**。実装だけ先にマージしない。
- レビューでは §5 の禁止事項を最優先で確認する。

## 10. エージェント（Claude 等）向けの追加ルール

- **破壊的操作は事前確認なしに実行しない。** `git push --force`、`git reset --hard`、ブランチ削除、`rm -rf`、R2 / KV のオブジェクト削除が該当する。
- **`main` に対して commit / push しない。** 作業を始める前にブランチを切る。
- 公式サイトへのネットワークアクセスは、利用者が明示的に依頼した調査時のみ行う。ループやバッチで繰り返し叩かない。
- **フィクスチャを「整形」「更新」しない。** 実データの同一性が回帰テストの前提。
- 設計を変える提案をするときは、DESIGN.md の該当節と ADR 番号を示す。既存の判断を覆す場合は、その ADR の「理由」に対する反論を述べる。
- **提出前に `pnpm check` を通す。** 通らないコードを「あとで直す」前提で出さない。
- 不明点があれば仮定を明示して進める。作業を止めて質問するのは、誤った仮定で進めると危険な場合に限る。
- 実行できなかった検証は「実行していない」と明記する。通っていないテストを通ったと書かない。
