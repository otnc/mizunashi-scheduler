import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: false,
  // paths を持たない設定を使う。src に解決すると @mizunashi/api-types の型が
  // インライン化され、外部依存として保たれなくなる
  tsconfig: 'tsconfig.build.json',
});
