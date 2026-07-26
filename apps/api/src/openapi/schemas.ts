import { zodToJsonSchema } from 'zod-to-json-schema';
import { z, type ZodTypeAny } from 'zod';
import * as Schema from '@mizunashi/schema';

/**
 * components.schemas は @mizunashi/schema の Zod 定義から生成する。
 * 手で書き写すと実装とドキュメントが食い違いうるため、唯一の情報源から導出する
 * （DESIGN.md §11.8 の型等価アサーションと同じ考え方）。
 */
const SHARED: Record<string, ZodTypeAny> = {
  // DateStr / TimeStr は各所で同一インスタンスが再利用される。
  // 名前を与えておかないと zod-to-json-schema が「最初に出てきた場所のプロパティ」への
  // $ref（例: #/components/schemas/Coverage/properties/from）を生成し、読みにくくなる
  DateStr: Schema.DateStr,
  TimeStr: Schema.TimeStr,
  Coverage: Schema.Coverage,
  SourceRef: Schema.SourceRef,
  ResponseMeta: Schema.ResponseMeta,
  ResolvedSession: Schema.ResolvedSession,
  PeriodSummary: Schema.PeriodSummary,
  PeriodNavigation: Schema.PeriodNavigation,
  PeriodScope: Schema.PeriodScope,
  UnavailableReason: Schema.UnavailableReason,
  Localized: Schema.Localized,
  Holiday: Schema.Holiday,
  DaySummary: Schema.DaySummary,
  Session: Schema.Session,
  DaySchedule: Schema.DaySchedule,
};

const TOP_LEVEL: Record<string, ZodTypeAny> = {
  PeriodResponse: Schema.PeriodResponse,
  StatusResponse: Schema.StatusResponse,
  YearsResponse: Schema.YearsResponse,
  MetaResponse: Schema.MetaResponse,
  ProblemDetails: Schema.ProblemDetails,
};

/**
 * zod-to-json-schema は「変換対象として渡したスキーマ」自身が definitions にも
 * 含まれていると、中身を展開せず自分自身への $ref だけを返す。しかも一度どこかで
 * $ref 化されたスキーマは、以後そのスキーマを単独で変換しても $ref のまま返る
 * （ライブラリ内部の解決済みキャッシュがスキーマ側に残るため）。
 *
 * そのため全スキーマを 1 回の呼び出しにまとめ、変換対象そのものには definitions の
 * どれとも異なるダミー（プレースホルダ）を渡す。definitions に列挙したものは
 * メインの入力から参照されていなくても必ず展開される。
 */
function convertAll(definitions: Record<string, ZodTypeAny>): Record<string, object> {
  const placeholder = z.object({});
  const out = zodToJsonSchema(placeholder, { definitions, target: 'openApi3' }) as {
    definitions?: Record<string, object>;
  };
  return out.definitions ?? {};
}

/** zod-to-json-schema が出す $ref（#/definitions/X）を components.schemas の位置に張り替える */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node != null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] =
        key === '$ref' && typeof value === 'string'
          ? value.replace('#/definitions/', '#/components/schemas/')
          : rewriteRefs(value);
    }
    return out;
  }
  return node;
}

export function buildComponentSchemas(): Record<string, object> {
  const schemas = convertAll({ ...SHARED, ...TOP_LEVEL });
  return rewriteRefs(schemas) as Record<string, object>;
}
