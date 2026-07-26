/**
 * JST 固定の時刻ユーティリティ。
 * Workers は UTC で動くため、ローカル時刻依存の Date メソッドをここ以外で使わない
 * （DESIGN.md §10.1）。日本にサマータイムは無いので固定オフセットで安全。
 */

export const JST_OFFSET_MINUTES = 9 * 60;
const JST_OFFSET_MS = JST_OFFSET_MINUTES * 60 * 1000;
export const DAY_MS = 86_400_000;

/** JST における "YYYY-MM-DD" */
export function jstDateKey(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST における年 */
export function jstYear(at: Date): number {
  return Number(jstDateKey(at).slice(0, 4));
}

/** JST における月 (1-12) */
export function jstMonth(at: Date): number {
  return Number(jstDateKey(at).slice(5, 7));
}

/** JST の日付 + "HH:mm" を絶対時刻にする */
export function jstInstant(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}:00+09:00`);
}

/** ISO 8601 を JST オフセット表記で返す */
export function toIsoJst(at: Date): string {
  return `${new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 23)}+09:00`;
}

export function addDays(dateKey: string, days: number): string {
  const t = Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * 提供対象の年。常に「今年」と「来年」（DESIGN.md §3.4）。
 * UTC で判定すると 12/31 の JST 09:00 以降でずれるため、必ず JST の年を使う。
 */
export function activeYears(at: Date): [number, number] {
  const y = jstYear(at);
  return [y, y + 1];
}
