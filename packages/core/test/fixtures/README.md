# テストフィクスチャ

パーサのゴールデンテスト（DESIGN.md §16.2）が使う実データです。**函館市が公開した原本そのものであり、再配布を避けるためリポジトリには含めていません。**

このディレクトリにファイルが無い場合、ゴールデンテストはスキップされます。他のテストは通常どおり実行されます。

**本番サービスとは無関係です。** ingest パイプラインは公式サイトから直接取得するため、ここのファイルを参照しません。翌年版が公開されても、このディレクトリで何かをする必要はありません。

## 一覧と取得元

| ファイル | 年 | 形式 | 代表するフォーマット差異 |
| --- | --- | --- | --- |
| `mizunashi2026.xlsx` | 2026 | XLSX | 整数 HHMM・祝日列・通年 |
| `2022mizunasionsen.xlsx` | 2022 | XLSX | 小数時刻・シリアル値破損・時刻の誤入力 2 件 |
| `R2.2021.xlsx` | 2021 | XLSX | 小数時刻・シリアル値破損・孤立した区切り 106 件 |
| `r02mizunashi.2020.xlsx` | 2020 | XLSX | 9 シート（4〜12 月）・長さ 0 のセッション 1 件 |
| `h29mizunashi.csv` | 2017年度 | CSV | Shift_JIS・会計年度（4月〜翌3月）・セル内改行 |
| `h28mizunashi.csv` | 2016年度 | CSV | Shift_JIS・会計年度（4月〜翌3月）・セル内改行 |

2026 年版は公式サイトから取得できます。

```
https://www.city.hakodate.hokkaido.jp/docs/2014041800107/file_contents/mizunashi2026.xlsx
```

それ以外は公式サイトから既に削除されており、Internet Archive にのみ残っています。以下の CDX 検索で現存するスナップショットを列挙できます。

```
https://web.archive.org/cdx/search/cdx?url=www.city.hakodate.hokkaido.jp%2Fdocs%2F2014041800107%2F&matchType=prefix&fl=timestamp,original,mimetype
```

取得は `https://web.archive.org/web/{timestamp}id_/{原 URL}` の形式で行います（`id_` を付けると Wayback のツールバーが挿入されない原本が得られます）。ファイル名と対象年が一致しない点に注意してください（`R2.xlsx` の中身は 2021 年です。DESIGN.md §4.4.2）。

## 注意

- **内容を編集・整形しない。** 改行コードの正規化も禁止です。CSV は Shift_JIS でレコード区切りの CRLF とセル内改行の LF が混在しており、正規化すると原本と別物になります。
- 出典: 函館市公式ホームページ <https://www.city.hakodate.hokkaido.jp/docs/2014041800107/>
