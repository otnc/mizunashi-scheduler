#!/usr/bin/env node
/**
 * 公開パッケージのビルド成果物を実測で検証する。
 *
 * exports マップが指すファイルが実在すること、CJS と ESM の両方から実際に
 * 読み込めること、型定義が両方の形式で揃っていることを確認する。
 * publint が静的に見る範囲を、実際の読み込みで補う。
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['packages/api-types', 'packages/api-client'];

const failures = [];
const fail = (pkg, message) => failures.push(`${pkg}: ${message}`);

/** exports マップを再帰的に辿り、末端のファイルパスを集める */
function collectTargets(node, acc = []) {
  if (typeof node === 'string') {
    acc.push(node);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectTargets(value, acc);
  }
  return acc;
}

for (const rel of PACKAGES) {
  const dir = join(ROOT, rel);
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const name = pkg.name;

  if (!pkg.exports) {
    fail(name, 'exports フィールドがありません');
    continue;
  }

  for (const target of collectTargets(pkg.exports)) {
    if (!existsSync(join(dir, target))) fail(name, `exports が指す ${target} が存在しません`);
  }

  // 型定義は CJS 側の .d.cts も必要。moduleResolution: node16 の CJS 利用者は
  // .d.ts を見に行かないため、片方だけだと型が解決できない
  for (const file of ['dist/index.d.ts', 'dist/index.d.cts']) {
    if (!existsSync(join(dir, file))) fail(name, `${file} がありません`);
  }

  const cjsEntry = join(dir, 'dist/index.cjs');
  if (existsSync(cjsEntry)) {
    try {
      createRequire(import.meta.url)(cjsEntry);
    } catch (err) {
      fail(name, `CJS を require できません: ${String(err)}`);
    }
  } else {
    fail(name, 'dist/index.cjs がありません');
  }

  const esmEntry = join(dir, 'dist/index.js');
  if (existsSync(esmEntry)) {
    try {
      await import(pathToFileURL(esmEntry).href);
    } catch (err) {
      fail(name, `ESM を import できません: ${String(err)}`);
    }
  } else {
    fail(name, 'dist/index.js がありません');
  }

  console.log(`${name}: CJS / ESM ともに読み込み可能`);
}

if (failures.length > 0) {
  console.error('\n公開パッケージの検証に失敗しました:\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`\n公開パッケージの検証: ${String(PACKAGES.length)} 件 — 問題なし`);
