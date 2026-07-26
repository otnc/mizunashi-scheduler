/**
 * 許容度の閾値。フォーマットが変わって調整が必要になったとき探す場所を 1 つにする
 * （DESIGN.md §8.10.6）。
 */
export const TOLERANCE = {
  /** ヘッダ行と判定する最小の語彙マッチ数 */
  headerMinMatches: 2,
  /** 形状推論で「時刻列」とみなす、時刻らしい値の割合 */
  timeColumnRatio: 0.5,
  /** 形状推論で「日付列」とみなす割合 */
  dateColumnRatio: 0.5,
  /** 年の交差検証で要求する曜日一致率 */
  weekdayAgreement: 0.95,
  /** これを超えるセッション数が出たら構造推論の誤りとみなす */
  maxSessionsPerDay: 8,
  /** 列の役割を判定するのに必要な、値が入っているセルの最小数 */
  minColumnSamples: 5,
} as const;

/** 日数に対する比率の上限。超えたら取り込みを却下する（DESIGN.md §7.7） */
export const DIAGNOSTIC_LIMITS: Readonly<Record<string, number>> = {
  'time.separator': 0.01,
  'time.unparsable': 0.01,
  'time.hourOnly': 0.05,
  'session.zeroLength': 0.01,
  'session.crossMidnight': 0.05,
  'session.overlap': 0.001,
  'date.gap': 0.01,
  'date.unparsable': 0.01,
};
