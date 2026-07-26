import type { DiagnosticCode, Diagnostics } from '@mizunashi/schema';

const MAX_SAMPLES = 5;

/** 単発の異常を計上する。閾値判定は取り込み側が行う（DESIGN.md §8.7） */
export class DiagnosticsCollector {
  readonly #entries = new Map<DiagnosticCode, { count: number; samples: string[] }>();

  add(code: DiagnosticCode, sample?: string): void {
    const entry = this.#entries.get(code) ?? { count: 0, samples: [] };
    entry.count++;
    if (sample != null && entry.samples.length < MAX_SAMPLES) entry.samples.push(sample);
    this.#entries.set(code, entry);
  }

  count(code: DiagnosticCode): number {
    return this.#entries.get(code)?.count ?? 0;
  }

  toDiagnostics(readerId: string): Diagnostics {
    return {
      readerId,
      entries: [...this.#entries].map(([code, v]) => ({
        code,
        count: v.count,
        samples: v.samples,
      })),
    };
  }
}
