import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument, splitByCalendarYear, type SourceArtifact } from '../src/index.js';

const FIXTURE_DIR = join(import.meta.dirname, '../../core/test/fixtures');

function load(name: string): SourceArtifact | null {
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return {
    bytes: new Uint8Array(buf),
    fileName: name,
    contentType: null,
    linkLabel: null,
  };
}

function distribution(days: { sessions: unknown[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) {
    const key = String(d.sessions.length);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

interface Golden {
  file: string;
  readerId: string;
  buckets: { year: number; days: number; complete: boolean }[];
  distribution?: Record<string, number>;
  holidays?: number;
  warns?: string[];
}

/** 期待値は実データを解析して得た既知の値（DESIGN.md §4.4.4） */
const GOLDEN: Golden[] = [
  {
    file: 'mizunashi2026.xlsx',
    readerId: 'xlsx',
    buckets: [{ year: 2026, days: 365, complete: true }],
    distribution: { 1: 177, 2: 169, 3: 19 },
    holidays: 18,
  },
  {
    file: '2022mizunasionsen.xlsx',
    readerId: 'xlsx',
    buckets: [{ year: 2022, days: 365, complete: true }],
    distribution: { 1: 147, 2: 203, 3: 15 },
    holidays: 0,
    warns: ['date.sourceRejected', 'time.separator'],
  },
  {
    file: 'R2.2021.xlsx',
    readerId: 'xlsx',
    buckets: [{ year: 2021, days: 365, complete: true }],
    distribution: { 1: 112, 2: 246, 3: 7 },
    warns: ['date.sourceRejected'],
  },
  {
    file: 'r02mizunashi.2020.xlsx',
    readerId: 'xlsx',
    buckets: [{ year: 2020, days: 275, complete: false }],
    distribution: { 1: 109, 2: 141, 3: 25 },
    warns: ['session.zeroLength'],
  },
  {
    file: 'h29mizunashi.csv',
    readerId: 'csv',
    buckets: [
      { year: 2017, days: 275, complete: false },
      { year: 2018, days: 90, complete: false },
    ],
    distribution: { 1: 133, 2: 211, 3: 21 },
  },
  {
    file: 'h28mizunashi.csv',
    readerId: 'csv',
    buckets: [
      { year: 2016, days: 275, complete: false },
      { year: 2017, days: 90, complete: false },
    ],
    distribution: { 1: 110, 2: 233, 3: 22 },
  },
];

const available = GOLDEN.filter((g) => existsSync(join(FIXTURE_DIR, g.file)));

describe.skipIf(available.length === 0)('golden', () => {
  for (const g of GOLDEN) {
    const artifact = load(g.file);

    describe.skipIf(artifact == null)(g.file, () => {
      if (!artifact) return;
      const parsed = parseDocument(artifact);
      const buckets = splitByCalendarYear(parsed.days);

      it('期待した Reader が選ばれる', () => {
        expect(parsed.readerId).toBe(g.readerId);
      });

      it('暦年バケットが一致する', () => {
        expect(
          buckets.map((b) => ({ year: b.year, days: b.days.length, complete: b.complete })),
        ).toEqual(g.buckets);
      });

      it('ヘッダから構造を推論できている', () => {
        expect(parsed.inferredByShape).toBe(false);
      });

      it('曜日の一致率が閾値を満たす', () => {
        expect(parsed.weekdayAgreement).toBeGreaterThanOrEqual(0.95);
      });

      it('日付が連続している', () => {
        for (const bucket of buckets) {
          for (let i = 1; i < bucket.days.length; i++) {
            const prev = Date.parse(`${bucket.days[i - 1]!.date}T00:00:00Z`);
            const cur = Date.parse(`${bucket.days[i]!.date}T00:00:00Z`);
            expect(cur - prev).toBe(86_400_000);
          }
        }
      });

      it('セッションは開始 < 終了で、開始順に並ぶ', () => {
        for (const day of parsed.days) {
          for (const s of day.sessions) expect(s.minutes).toBeGreaterThan(0);
          for (let i = 1; i < day.sessions.length; i++) {
            expect(day.sessions[i]!.start >= day.sessions[i - 1]!.start).toBe(true);
          }
        }
      });

      it('重複があれば診断に計上されている', () => {
        let overlaps = 0;
        for (const day of parsed.days) {
          for (let i = 1; i < day.sessions.length; i++) {
            if (day.sessions[i]!.start < day.sessions[i - 1]!.end) overlaps++;
          }
        }
        const recorded = parsed.diagnostics.entries.find((e) => e.code === 'session.overlap');
        expect(recorded?.count ?? 0).toBe(overlaps);
      });

      it('ルビが混入していない', () => {
        const strings = parsed.days.flatMap((d) => [d.holiday?.ja ?? '', d.holiday?.en ?? '']);
        for (const s of [...strings, ...parsed.notes.ja]) {
          expect(s).not.toMatch(/[一-鿿][゠-ヿ]{2,}$/);
        }
      });

      it('注意書きを取得できている', () => {
        expect(parsed.notes.ja.join('')).toContain('波の高い日');
      });

      const dist = g.distribution;
      if (dist) {
        it('セッション数分布が一致する', () => {
          expect(distribution(parsed.days)).toEqual(dist);
        });
      }

      const holidays = g.holidays;
      if (holidays != null) {
        it('祝日の件数が一致する', () => {
          expect(parsed.days.filter((d) => d.holiday != null)).toHaveLength(holidays);
        });
      }

      const warns = g.warns;
      if (warns) {
        it('期待した警告が出ている', () => {
          const codes = parsed.diagnostics.entries.map((e) => e.code);
          for (const w of warns) expect(codes).toContain(w);
        });
      }
    });
  }
});

describe('祝日名の正規化', () => {
  const artifact = load('mizunashi2026.xlsx');

  it.skipIf(artifact == null)('ルビを除いた祝日名が得られる', () => {
    if (!artifact) return;
    const parsed = parseDocument(artifact);
    const byDate = new Map(parsed.days.map((d) => [d.date, d]));
    expect(byDate.get('2026-01-01')?.holiday?.ja).toBe('元日');
    expect(byDate.get('2026-10-12')?.holiday?.ja).toBe('スポーツの日');
    expect(byDate.get('2026-02-11')?.holiday?.ja).toBe('建国記念の日');
  });
});
