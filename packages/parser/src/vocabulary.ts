/**
 * 表記ゆれの語彙。新しい表記が出てきたら配列に 1 要素足すだけで対応できるようにしてある
 * （DESIGN.md §8.10.4）。マッチは NFKC 正規化 + 空白除去 + 小文字化した文字列に対して行う。
 */

export const VOCAB = {
  date: ['日付', 'date', '月日', '日にち'],
  weekday: ['曜日', 'day', 'week', '曜'],

  /** 備考・祝日など、日単位の注記が入る列。見出し文字列はそのまま保持する */
  note: ['備考', 'note', 'notes', 'remarks', '祝日', 'nationalholidays', 'holiday', 'holidays'],

  /**
   * 「N回目」「Nst/nd/rd/th」から序数を取り出す。
   * 日本語見出しと英語見出しを連結した「1回目1st」の形も来るため完全一致にしない。
   */
  sessionOrdinal: [
    /(\d+)回目/,
    /(?:^|\D)(\d+)(?:st|nd|rd|th)(?:\D|$)/,
    /(?:^|[^a-z])(first|second|third|fourth|fifth)(?:[^a-z]|$)/,
  ] as const,

  ordinalWords: ['first', 'second', 'third', 'fourth', 'fifth'] as const,

  /** 開始と終了の区切り。無くても動くが、あればヒントとして使う */
  separator: ['～', '〜', '~', '-', '‐', '–', '—', 'から', 'to', '/'],

  /** 時刻の区切り記号。';' は 2022 年版に実在する誤入力 */
  timeDelimiter: [':', ';', '.', '時'],

  weekdayJa: ['日', '月', '火', '水', '木', '金', '土'] as const,
  weekdayEn: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const,

  monthEn: [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ] as const,

  /** 元号 → 西暦のオフセット。令和1年 = 2019 */
  eras: [
    { names: ['令和', 'reiwa', 'r'], offset: 2018 },
    { names: ['平成', 'heisei', 'h'], offset: 1988 },
    { names: ['昭和', 'showa', 's'], offset: 1925 },
  ] as const,

  /** 注意書きの行を見つける手掛かり。本文そのものは原本から取る */
  noticeMarkers: ['※', '*', '＊', '注意', 'please', 'caution', 'note:'],
} as const;

/** 語彙マッチ用の正規化。NFKC → 空白除去 → 小文字化 */
export function vocabKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .toLowerCase();
}

export function matchesAny(text: string, candidates: readonly string[]): boolean {
  const key = vocabKey(text);
  if (key === '') return false;
  return candidates.some((c) => key.includes(vocabKey(c)));
}

/** 「1回目」「1st」などから序数を返す。該当しなければ null */
export function sessionOrdinalOf(text: string): number | null {
  const key = vocabKey(text);
  for (const re of VOCAB.sessionOrdinal) {
    const m = re.exec(key);
    if (!m) continue;
    const captured = m[1];
    if (captured === undefined) continue;
    const asNumber = Number(captured);
    if (Number.isFinite(asNumber)) return asNumber;
    const wordIndex = VOCAB.ordinalWords.indexOf(captured as (typeof VOCAB.ordinalWords)[number]);
    if (wordIndex >= 0) return wordIndex + 1;
  }
  return null;
}
