# テストフィクスチャ

パーサのゴールデンテスト（DESIGN.md §16.2）が使う実データです。**函館市が公開した原本そのものであり、再配布を避けるためリポジトリには含めていません。**

## 取得

```bash
pnpm fixtures:fetch
```

`CHECKSUMS.txt` と照合し、一致しないファイルは破棄します。取得できない場合、該当するゴールデンテストはスキップされます（他のテストは通常どおり実行されます）。

## 一覧

| ファイル | 年 | 形式 | 取得元 |
| --- | --- | --- | --- |
| `mizunashi2026.xlsx` | 2026 | XLSX | 公式サイト `file_contents/mizunashi2026.xlsx` |
| `2022mizunasionsen.xlsx` | 2022 | XLSX | Internet Archive |
| `R2.2021.xlsx` | 2021 | XLSX | Internet Archive |
| `r02mizunashi.2020.xlsx` | 2020 | XLSX | Internet Archive |
| `h29mizunashi.csv` | 2017年度 | CSV | Internet Archive |
| `h28mizunashi.csv` | 2016年度 | CSV | Internet Archive |

2026 年版以外は公式サイトから既に削除されており、Internet Archive からのみ取得できます。各ファイルがどのフォーマット差異を代表しているかは DESIGN.md §4.4 を参照してください。

## 注意

- **内容を編集・整形しない。** 改行コードの正規化も禁止です。CSV は Shift_JIS でレコード区切りの CRLF とセル内改行の LF が混在しており、正規化すると原本と別物になります。
- 出典: 函館市公式ホームページ <https://www.city.hakodate.hokkaido.jp/docs/2014041800107/>
