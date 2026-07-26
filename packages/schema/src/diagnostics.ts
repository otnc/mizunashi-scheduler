import { z } from 'zod';

/**
 * パース時に収集する警告・エラーのコード。
 * 単発の異常はここに計上して該当分だけ捨て、閾値を超えたときだけ取り込みを却下する
 * （DESIGN.md §8.7 / §7.7）。
 */
export const DiagnosticCode = z.enum([
  'time.separator',
  'time.hourOnly',
  'time.unparsable',
  'session.incomplete',
  'session.zeroLength',
  'session.crossMidnight',
  'session.overlap',
  'year.corrected',
  'year.unresolved',
  'date.gap',
  'date.unparsable',
  'date.sourceRejected',
  'column.fallback',
  'structure.shapeInferred',
  'sheet.skipped',
]);
export type DiagnosticCode = z.infer<typeof DiagnosticCode>;

export const DiagnosticEntry = z.object({
  code: DiagnosticCode,
  count: z.number().int().positive(),
  /** 最初の数件だけ保持する。原因調査の手掛かり用 */
  samples: z.array(z.string()).max(5),
});
export type DiagnosticEntry = z.infer<typeof DiagnosticEntry>;

export const Diagnostics = z.object({
  readerId: z.string(),
  entries: z.array(DiagnosticEntry),
});
export type Diagnostics = z.infer<typeof Diagnostics>;
