import type { DaySchedule, Session } from '@mizunashi/schema';
import { describe, expect, it } from 'vitest';
import { buildIcs } from '../src/index.js';

const NOW = new Date('2026-07-26T03:15:00.000Z');

function session(index: number, start: string, end: string, crossesMidnight = false): Session {
  const min = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const span = crossesMidnight ? min(end) + 1440 - min(start) : min(end) - min(start);
  return { index, start, end, minutes: span, crossesMidnight };
}

function day(date: string, sessions: Session[], holiday: string | null = null): DaySchedule {
  return {
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    holiday: holiday == null ? null : { ja: holiday, en: null },
    sessions,
    summary: {
      firstStart: sessions[0]?.start ?? null,
      lastEnd: sessions.at(-1)?.end ?? null,
      totalMinutes: sessions.reduce((s, x) => s + x.minutes, 0),
      sessionCount: sessions.length,
      longestMinutes: sessions.reduce((m, s) => Math.max(m, s.minutes), 0),
      gaps: [],
    },
  };
}

const OPTIONS = {
  calendarName: '水無海浜温泉 入浴可能時間',
  domain: 'mizunashi.example.test',
  location: '北海道函館市恵山岬町',
  now: NOW,
};

describe('buildIcs', () => {
  const days = [day('2026-01-05', [session(1, '10:00', '11:00'), session(2, '20:00', '21:00')])];

  it('カレンダーの骨格を出力する', () => {
    const ics = buildIcs(days, OPTIONS);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('END:VCALENDAR');
    // 日本にサマータイムが無いので STANDARD ひとつ
    expect(ics).toContain('TZID:Asia/Tokyo');
    expect(ics).toContain('TZOFFSETTO:+0900');
  });

  it('セッションごとに VEVENT を作る', () => {
    const ics = buildIcs(days, OPTIONS);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260105T100000');
    expect(ics).toContain('DTEND;TZID=Asia/Tokyo:20260105T110000');
    expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260105T200000');
  });

  it('UID が日付と回数で一意になる', () => {
    const ics = buildIcs(days, OPTIONS);
    expect(ics).toContain('UID:2026-01-05-1@mizunashi.example.test');
    expect(ics).toContain('UID:2026-01-05-2@mizunashi.example.test');
  });

  it('複数回ある日は何回目かを示す', () => {
    const ics = buildIcs(days, OPTIONS);
    expect(ics).toContain('2回中1回目');
    expect(ics).toContain('2回中2回目');
  });

  it('1 回だけの日には回数を付けない', () => {
    const ics = buildIcs([day('2026-01-04', [session(1, '19:00', '21:00')])], OPTIONS);
    expect(ics).not.toContain('回中');
  });

  it('日跨ぎのセッションは翌日を終了日にする', () => {
    const ics = buildIcs([day('2026-01-04', [session(1, '23:00', '01:00', true)])], OPTIONS);
    expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260104T230000');
    expect(ics).toContain('DTEND;TZID=Asia/Tokyo:20260105T010000');
  });

  it('alarm を指定すると VALARM が付く', () => {
    const ics = buildIcs(days, { ...OPTIONS, alarmMinutes: 30 });
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT30M');
  });

  it('alarm を指定しなければ VALARM は付かない', () => {
    expect(buildIcs(days, OPTIONS)).not.toContain('VALARM');
  });

  it('祝日を CATEGORIES に出す', () => {
    const ics = buildIcs([day('2026-01-01', [session(1, '17:00', '19:00')], '元日')], OPTIONS);
    expect(ics).toContain('CATEGORIES:元日');
  });

  it('特殊文字をエスケープする', () => {
    const ics = buildIcs(days, { ...OPTIONS, calendarName: 'a;b,c\\d' });
    expect(ics).toContain('X-WR-CALNAME:a\\;b\\,c\\\\d');
  });

  it('CRLF で終端し、すべての行が 75 オクテット以内に収まる', () => {
    const ics = buildIcs(days, OPTIONS);
    expect(ics.endsWith('\r\n')).toBe(true);
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('日本語を含む長い行もマルチバイト文字の途中で切らない', () => {
    const ics = buildIcs(days, {
      ...OPTIONS,
      calendarName: '水無海浜温泉'.repeat(10),
    });
    // 折り返しても復元できる（継続行の先頭空白を除いて連結）
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`X-WR-CALNAME:${'水無海浜温泉'.repeat(10)}`);
    expect(ics).not.toContain('�');
  });

  it('英語表記に切り替えられる', () => {
    const ics = buildIcs(days, { ...OPTIONS, lang: 'en' });
    expect(ics).toContain('SUMMARY:Mizunashi Kaihin Onsen (1/2)');
    expect(ics).toContain('waves are high');
  });
});
