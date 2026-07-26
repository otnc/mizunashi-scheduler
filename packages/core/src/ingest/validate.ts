import type { Diagnostics } from '@mizunashi/schema';
import { DIAGNOSTIC_LIMITS } from '@mizunashi/parser';
import type { YearBucket } from './transform.js';

/**
 * 取り込みの可否を決める最後の関門。
 * ここを通らない限り既存の派生データを更新しない。壊れた新データより
 * 正しい旧データのほうが利用者にとって有用（DESIGN.md ADR-008）。
 */

export interface ValidationIssue {
  id: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const DAY_MS = 86_400_000;

function hasNoDateGaps(dates: readonly string[]): boolean {
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(`${String(dates[i - 1])}T00:00:00Z`);
    const cur = Date.parse(`${String(dates[i])}T00:00:00Z`);
    if (cur - prev !== DAY_MS) return false;
  }
  return true;
}

export function validateBucket(bucket: YearBucket, diagnostics: Diagnostics): ValidationResult {
  const issues: ValidationIssue[] = [];
  const days = bucket.days;
  const add = (id: string, message: string): number => issues.push({ id, message });

  // 通年を前提にしない。2020 年版は 4〜12 月の 275 日しかない（§4.4.4）
  if (days.length < 28) add('nonEmpty', `日数が少なすぎます: ${String(days.length)}`);

  const dates = days.map((d) => d.date);
  if (dates.length > 0) {
    if (dates[0] !== bucket.coverage.from || dates[dates.length - 1] !== bucket.coverage.to) {
      add('coverageMatch', 'coverage と日付の範囲が一致しません');
    }
    if (!hasNoDateGaps(dates)) add('noGaps', 'coverage の内部に日付の欠落があります');
    if (!days.every((d) => d.date.startsWith(`${String(bucket.year)}-`))) {
      add('inYear', '他の年の日付が混入しています');
    }
    if (new Set(dates).size !== dates.length) add('unique', '日付が重複しています');
  }

  for (const day of days) {
    for (const s of day.sessions) {
      if (s.minutes <= 0) add('validRange', `${day.date}: 長さが 0 以下のセッションがあります`);
    }
    if (day.sessions.length > 6) {
      add('sessionCap', `${day.date}: セッションが多すぎます (${String(day.sessions.length)})`);
    }
  }

  const withSessions = days.filter((d) => d.sessions.length > 0).length;
  if (days.length > 0 && withSessions / days.length < 0.9) {
    add('coverageRatio', 'セッションのある日が 9 割に届きません');
  }

  // 診断の件数が日数に対する比率の上限を超えていないか（§8.7）
  for (const entry of diagnostics.entries) {
    const limit = DIAGNOSTIC_LIMITS[entry.code];
    if (limit == null || days.length === 0) continue;
    const ratio = entry.count / days.length;
    if (ratio > limit) {
      add(
        'diagnostics',
        `${entry.code} が閾値を超えています: ${String(entry.count)}/${String(days.length)} = ${ratio.toFixed(4)} > ${String(limit)}`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}
