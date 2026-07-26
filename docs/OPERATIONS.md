# 運用手順書

障害対応と定型作業の手順です。設計は [DESIGN.md](./DESIGN.md)、規約は [AGENTS.md](../AGENTS.md) を参照してください。

**前提**: このシステムは定期的な手作業を必要としません。人手が要るのはアラートが飛んだときだけで、カレンダー駆動の作業はありません（DESIGN.md §15.6）。

## まず確認すること

```bash
curl -s https://<domain>/api/v1/healthz | jq
```

| `status` | 意味 |
| --- | --- |
| `ok` | 当年データが揃っている |
| `degraded` | 当年データが無い、または最終実行から時間が経ちすぎている |

`/api/v1/meta` の `data.lastCheckedAt` で最後に取り込みが走った時刻がわかります。

## 1. 翌年版が公開されたとき

**何もしなくて構いません。** 検知・取得・保存・公開・サイトの年切替まで自動で完結し、Info アラートが飛びます。

確認したい場合:

```bash
curl -s https://<domain>/api/v1/years | jq '.activeYears'
# [2026, 2027] のように 2 件になっていれば取り込み済み
```

サイト側は `activeYears` を実行時に見るため、デプロイなしで年の切替 UI が有効になります。

## 2. パースに失敗したとき（Critical アラート）

フォーマットが変わった可能性があります。**既存の派生データは据え置かれているので、サービスは動き続けています。** 慌てる必要はありません。

### 手順

1. アラートに含まれる原本の URL と sha256 を控える
2. R2 から原本を取得する

   ```bash
   curl -sO https://<domain>/archive/<year>/<filename>
   ```

3. ローカルで解析する

   ```bash
   pnpm parser:debug <file>
   ```

   Reader の選択結果、`locate` が推論した構造、`Diagnostics` の内訳が出ます。

4. 原因に応じて直す

   | 症状 | 直す場所 |
   | --- | --- |
   | 新しい表記（見出し・区切り・時刻形式） | `packages/parser/src/vocabulary.ts` に 1 要素追加 |
   | 列位置や行構成が変わった | `packages/parser/src/locate/` |
   | 新しいファイル形式（`.xls` / `.ods` など） | `packages/parser/src/readers/` に Reader を追加 |
   | 閾値が厳しすぎる | `packages/parser/src/tolerance.ts` |

5. **フィクスチャを手元に置いてゴールデンテストを書く**。取得元を `packages/core/test/fixtures/README.md` に追記する
6. `pnpm check` を通してデプロイする
7. 即時に復旧させる場合は原本から再生成する

   ```bash
   curl -X POST https://<domain>/api/v1/admin/ingest \
     -H "authorization: Bearer $ADMIN_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"fromArchive":"<sha256>"}'
   ```

   急がなければ次の定期実行（最大 2 週間後、11〜1 月は翌日）で自動的に回復します。

### やってはいけないこと

- **バリデーションを緩めて無理に通さない。** 壊れたデータで正しいデータを上書きするのが最悪の結果です
- **既存のゴールデンテストの期待値を変えて通す。** 過去年のパース結果が変わったなら、それは回帰です

## 3. PDF しか公開されていないとき（Critical アラート）

2016 年以降 11 年連続で機械可読ファイルが提供されているため、発生確率は低い想定です。

1. `/api/v1/years` で該当年が欠けていることを確認する
2. PDF を見ながら手作業で CSV を起こす。列は公式と同じ並び（日付・1回目・2回目・3回目・備考）にする
3. 作成した CSV を R2 の `raw/objects/` に置き、manifest に追記する
4. `POST /api/v1/admin/ingest` の `fromArchive` で取り込む
5. **作成した CSV も原本と並べて保存する。** 次年度以降の参照元になります

## 4. 公式ページの構造が変わったとき

「ドキュメントリンクを 1 件も抽出できない」という Critical アラートが出ます。

1. `snapshots/page/` に保存された HTML と現在のページを比較する
2. ページ ID や URL が変わっていれば `wrangler.toml` の `PAGE_URL` を更新する
3. リンクの書き方が変わっていれば `packages/core/src/ingest/discover.ts` を修正する

抽出は拡張子と同一オリジンだけで判定しているため、ディレクトリ名や命名規則の変更では壊れません。

## 5. 過去年のデータを一時的に見たいとき

提供対象は今年と来年のみですが、原本は残っています。

```bash
curl -X POST https://<domain>/api/v1/admin/ingest \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"fromArchive":"<sha256>"}'
```

**次回の日次プルーニングで再び削除されます。** これは意図した挙動です。恒久的に必要なら `activeYears` の定義自体を変更してください。

## 6. 年またぎの確認（1 月上旬）

1/1 以降の最初の実行で前年の派生データが自動削除されます。

```bash
curl -s https://<domain>/api/v1/healthz | jq '.checks.activeYears'
```

`raw/` は削除されません。原本が消えていないことを確認してください。

```bash
curl -s https://<domain>/archive | jq '.entries | length'
```

## 7. npm パッケージの公開

1. `packages/api-types/package.json`（または `api-client`）のバージョンを上げる
2. `pnpm check` と `pnpm verify:dist` を通す
3. コミットしてタグを打つ

   ```bash
   git tag api-types-v1.2.3
   git push origin api-types-v1.2.3
   ```

4. ワークフローがタグと `package.json` の一致を検証し、Trusted Publishing で公開する

**`api-client` より先に `api-types` を公開してください。** 逆順だとインストールできないパッケージになります（ワークフローが `npm view` で確認します）。

**手元から `npm publish` しないでください。** 公開したバージョンは取り消せません。

## 8. バックアップ

R2 の `raw/` を月次で別プロバイダへ複製してください。**原本が失われると復元不能です。**

```bash
rclone sync r2:mizunashi-archive/raw <backup>:mizunashi-raw
```

`derived/` は原本から再生成できるのでバックアップ不要です。

## アラートと対応の対応表

| アラート | 重要度 | 対応 |
| --- | --- | --- |
| 翌年版を取り込み成功 | Info | なし |
| 年またぎのプルーニング実行 | Info | §6 |
| 曜日交差検証で年を補正 | Info | なし（原本のシリアル値が壊れている） |
| パース失敗 / 未知の形式 | Critical | §2 |
| バリデーション失敗 | Critical | §2 |
| 機械可読ファイルが無い | Critical | §3 |
| ページからリンクを抽出できない | Critical | §4 |
| 12/28 時点で翌年データ未取得 | Critical | 公式サイトを目視確認。必要なら §3 |
| Diagnostics が閾値超過 | Warning | 原本を確認。恒常的なら `tolerance.ts` を調整 |
| アダプタが切り替わった | Warning | フォーマットが変わった可能性。原本を確認 |
| 部分年データのまま | Warning | 追加ファイルの公開待ちか、パース漏れ |
