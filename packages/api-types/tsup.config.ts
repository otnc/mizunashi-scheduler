import { defineConfig } from 'tsup';

/**
 * CJS と ESM の両方に型解決できるようにする。
 * moduleResolution: node16 以降では、CJS 側は .d.cts を見に行くため
 * .d.ts だけでは解決できない利用者が出る。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: false,
});
