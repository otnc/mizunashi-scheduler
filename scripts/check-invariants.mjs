#!/usr/bin/env node
/**
 * 設計上の不変条件のうち、ESLint では表現できないものを検出する（DESIGN.md §17.5）。
 * コード内で表現できるものは eslint.config.js の no-restricted-* 側にある。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RULES = [
  {
    id: 'no-fixture-data-committed',
    kind: 'tracked',
    pattern: /^packages\/core\/test\/fixtures\/.+\.(xlsx|xlsm|xls|csv|pdf)$/,
    message: 'フィクスチャの実データはコミットしない（函館市の原本そのもので再配布にあたる）',
  },
  {
    id: 'no-raw-deletion',
    kind: 'content',
    include: /^(packages|apps)\/.+\/src\/.+\.(ts|tsx)$/,
    pattern: /\.delete\s*\(\s*[`'"]raw\//,
    message: 'raw/ 配下のオブジェクト削除は禁止（原本は永久保存・ADR-006 / ADR-009）',
  },
  {
    id: 'no-hardcoded-year',
    kind: 'content',
    include: /^apps\/web\/src\/.+\.(ts|tsx|astro)$/,
    exclude: /\.test\.|\/data\/snapshot\.json$/,
    pattern: /\b20(2[6-9]|3\d)\b/,
    message: '年のハードコード禁止。activeYears を実行時に取得すること（FR-10 / ADR-011）',
  },
];

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

const files = trackedFiles();
const violations = [];

for (const rule of RULES) {
  if (rule.kind === 'tracked') {
    for (const file of files) {
      if (rule.pattern.test(file)) violations.push({ rule, file, line: 0, text: file });
    }
    continue;
  }

  for (const file of files) {
    if (!rule.include.test(file)) continue;
    if (rule.exclude?.test(file)) continue;
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    content.split('\n').forEach((text, i) => {
      if (rule.pattern.test(text)) violations.push({ rule, file, line: i + 1, text: text.trim() });
    });
  }
}

if (violations.length > 0) {
  console.error('設計上の不変条件に違反しています:\n');
  for (const v of violations) {
    console.error(`  [${v.rule.id}] ${v.file}${v.line > 0 ? `:${v.line}` : ''}`);
    console.error(`    ${v.rule.message}`);
    if (v.line > 0) console.error(`    > ${v.text}`);
    console.error('');
  }
  process.exit(1);
}

console.log(
  `不変条件チェック: ${String(RULES.length)} ルール / ${String(files.length)} ファイル — 違反なし`,
);
