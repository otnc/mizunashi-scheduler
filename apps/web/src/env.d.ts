/// <reference types="astro/client" />

/**
 * 環境変数の型。Astro の生成物（.astro/types.d.ts）は astro sync を実行しないと
 * 存在せず、CI では lint が型検査より先に走るため解決できない。
 * ここで手書きしておくことで生成物の有無に依存しなくなる。
 */
interface ImportMetaEnv {
  /** API のオリジン。同一オリジン配信が既定なので通常は未設定 */
  readonly PUBLIC_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
