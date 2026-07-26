import type { DaySchedule } from '@mizunashi/schema';
import { addDays } from './status/jst.js';

export interface IcsOptions {
  calendarName: string;
  /** UID のドメイン部。カレンダー間で衝突しないようにする */
  domain: string;
  /** 開始の N 分前にアラームを設定する。null なら付けない */
  alarmMinutes?: number | null;
  lang?: 'ja' | 'en';
  location?: string;
  url?: string;
  now: Date;
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/** RFC 5545 のテキスト値のエスケープ */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * 1 行を 75 オクテットで折り返す。
 * 日本語を含むため、コードユニットではなく UTF-8 のバイト数で数え、
 * マルチバイト文字の途中で切らないようにする。
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_OCTETS) return line;

  const out: string[] = [];
  let current = '';
  let octets = 0;
  let first = true;

  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // 継続行は先頭の空白 1 オクテットを消費する
    const limit = first ? MAX_OCTETS : MAX_OCTETS - 1;
    if (octets + size > limit) {
      out.push(first ? current : ` ${current}`);
      first = false;
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  if (current !== '') out.push(first ? current : ` ${current}`);
  return out.join(CRLF);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** JST のローカル日時（TZID 付きで使う） */
function localStamp(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function utcStamp(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/**
 * 入浴可能時間を iCalendar として書き出す。
 * 1 日に複数回あるのが常態なので、セッションごとに VEVENT を作る。
 */
export function buildIcs(days: readonly DaySchedule[], options: IcsOptions): string {
  const lang = options.lang ?? 'ja';
  const summaryBase = lang === 'en' ? 'Mizunashi Kaihin Onsen' : '水無海浜温泉 入浴可能';
  const notice =
    lang === 'en'
      ? 'Do not bathe when waves are high. Times are an estimate based on tide tables.'
      : '波の高い日は入浴できません。時間は潮位表に基づく目安です。';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${options.domain}//mizunashi-scheduler//${lang.toUpperCase()}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    // 日本にサマータイムは無いので STANDARD 1 つで足りる
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  const dtstamp = utcStamp(options.now);

  for (const day of days) {
    const ofDay = day.sessions.length;
    for (const session of day.sessions) {
      const endDate = session.crossesMidnight ? addDays(day.date, 1) : day.date;
      const ordinal =
        ofDay > 1
          ? lang === 'en'
            ? ` (${String(session.index)}/${String(ofDay)})`
            : `（${String(ofDay)}回中${String(session.index)}回目）`
          : '';

      lines.push(
        'BEGIN:VEVENT',
        `UID:${day.date}-${String(session.index)}@${options.domain}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Asia/Tokyo:${localStamp(day.date, session.start)}`,
        `DTEND;TZID=Asia/Tokyo:${localStamp(endDate, session.end)}`,
        `SUMMARY:${escapeText(summaryBase + ordinal)}`,
        `DESCRIPTION:${escapeText(notice)}`,
      );
      if (options.location != null) lines.push(`LOCATION:${escapeText(options.location)}`);
      if (options.url != null) lines.push(`URL:${options.url}`);
      if (day.holiday != null) {
        lines.push(
          `CATEGORIES:${escapeText(lang === 'en' ? (day.holiday.en ?? day.holiday.ja) : day.holiday.ja)}`,
        );
      }
      if (options.alarmMinutes != null && options.alarmMinutes > 0) {
        lines.push(
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `TRIGGER:-PT${String(options.alarmMinutes)}M`,
          `DESCRIPTION:${escapeText(summaryBase)}`,
          'END:VALARM',
        );
      }
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

export { pad as padTwo };
