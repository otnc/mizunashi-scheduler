import type { Session } from '@mizunashi/schema';
import { MINUTES_PER_DAY, toTimeStr } from '@mizunashi/schema';
import type { DiagnosticsCollector } from '../diagnostics.js';
import type { RawSlot } from '../extract.js';
import { readTime } from '../recognize/time.js';

/**
 * スロットからセッションを組み立てる。開始と終了が両方揃っている場合のみ採用する。
 * 2022 年版には区切り記号だけが残った空スロットが 400 箇所ある（§4.4.5）。
 */
export function buildSessions(slots: readonly RawSlot[], diag: DiagnosticsCollector): Session[] {
  const built: { start: number; end: number; crossesMidnight: boolean }[] = [];

  for (const slot of slots) {
    const start = readTime(slot.start);
    const end = readTime(slot.end);

    if (start == null && end == null) continue;
    if (start == null || end == null) {
      diag.add('session.incomplete', `${slot.start.text}|${slot.end.text}`);
      continue;
    }
    if (start.code) diag.add(start.code, slot.start.text);
    if (end.code) diag.add(end.code, slot.end.text);

    if (end.minutes === start.minutes) {
      diag.add('session.zeroLength', `${slot.start.text}-${slot.end.text}`);
      continue;
    }
    if (end.minutes < start.minutes) {
      diag.add('session.crossMidnight', `${slot.start.text}-${slot.end.text}`);
      built.push({
        start: start.minutes,
        end: end.minutes + MINUTES_PER_DAY,
        crossesMidnight: true,
      });
      continue;
    }
    built.push({
      start: start.minutes,
      end: end.minutes,
      crossesMidnight: end.minutes >= MINUTES_PER_DAY,
    });
  }

  built.sort((a, b) => a.start - b.start);

  for (let i = 1; i < built.length; i++) {
    const prev = built[i - 1];
    const cur = built[i];
    if (prev && cur && cur.start < prev.end) diag.add('session.overlap', String(cur.start));
  }

  // index は「その日の何回目か」。原本の序数に欠けがあっても 1 から連番に振り直す
  return built.map((s, i) => ({
    index: i + 1,
    start: toTimeStr(s.start),
    end: toTimeStr(s.end),
    minutes: s.end - s.start,
    crossesMidnight: s.crossesMidnight,
  }));
}
