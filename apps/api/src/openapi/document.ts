import { buildComponentSchemas } from './schemas.js';

const DATE_PARAM = {
  name: 'date',
  in: 'path' as const,
  required: true,
  description: '`YYYY-MM-DD`、または `today` / `tomorrow`',
  schema: { type: 'string' as const },
  example: 'today',
};

const AT_PARAM = {
  name: 'at',
  in: 'query' as const,
  required: false,
  description:
    '判定の基準時刻（ISO 8601、タイムゾーン省略時は JST）。`none` を渡すと `relative` を省いた、現在時刻に依存しない静的レスポンスになる（キャッシュ可能）。省略時は現在時刻。',
  schema: { type: 'string' as const },
  example: 'none',
};

const LANG_PARAM = {
  name: 'lang',
  in: 'query' as const,
  required: false,
  description: '祝日名・注意書きの言語',
  schema: { type: 'string' as const, enum: ['ja', 'en'], default: 'ja' },
};

function problemResponse(description: string): object {
  return {
    description,
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  };
}

function periodResponse(description: string): object {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/PeriodResponse' } },
    },
  };
}

const ERROR_RESPONSES = {
  '400': problemResponse('パラメータが不正'),
  '404': problemResponse('見つからない、または提供対象外の年'),
};

/**
 * OpenAPI 3.0.3 ドキュメントを組み立てる。
 *
 * レスポンスの形は @mizunashi/schema の Zod 定義（components.schemas）から導出するが、
 * パス・パラメータ・エンドポイントの説明はここに手で書く。ルーティング自体を
 * OpenAPIHono に載せ替えることはしていない（DESIGN.md ADR-011 の設計を変えないため）。
 */
export function buildOpenApiDocument(baseUrl: string): object {
  return {
    openapi: '3.0.3',
    info: {
      title: '水無海浜温泉 入浴可能時間 API',
      version: '1',
      description:
        '函館市 水無海浜温泉（北海道函館市恵山岬町）の入浴可能時間を機械可読で提供する非公式 API です。' +
        '潮の干満により入浴できる時間が日ごとに変わり、1 日に複数回の入浴可能時間帯があるのが常態です。',
      contact: { url: 'https://github.com/otnc/mizunashi-scheduler' },
      license: {
        name: 'MIT',
        url: 'https://github.com/otnc/mizunashi-scheduler/blob/main/LICENSE',
      },
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'status', description: '現在時刻を基準にした入浴可否' },
      { name: 'periods', description: '日・週・月・年・任意期間の時間表' },
      { name: 'meta', description: '提供年・施設情報' },
      { name: 'feed', description: 'iCalendar フィード' },
      { name: 'system', description: 'ヘルスチェック' },
    ],
    paths: {
      '/api/v1/status': {
        get: {
          tags: ['status'],
          summary: '現在（または指定時刻）の入浴可否',
          description:
            '`current`（入浴中ならいつまで）と `next`（次はいつから）を返す。' +
            '`nextToday`（今日この後、日をまたがない次）と `next`（日をまたいでもよい次）は別の値なので混同しないこと。',
          parameters: [
            AT_PARAM,
            LANG_PARAM,
            {
              name: 'upcoming',
              in: 'query',
              required: false,
              description: '`upcoming` に含める件数の上限',
              schema: { type: 'integer', minimum: 0, maximum: 30, default: 5 },
            },
          ],
          responses: {
            '200': {
              description: '現在の状態',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } },
              },
            },
            ...ERROR_RESPONSES,
          },
        },
      },

      '/api/v1/days/{date}': {
        get: {
          tags: ['periods'],
          summary: '単日の時間表',
          parameters: [DATE_PARAM, AT_PARAM, LANG_PARAM],
          responses: { '200': periodResponse('指定日の時間表'), ...ERROR_RESPONSES },
        },
      },

      '/api/v1/weeks/{date}': {
        get: {
          tags: ['periods'],
          summary: '指定日から 7 日間の時間表',
          parameters: [
            DATE_PARAM,
            {
              name: 'align',
              in: 'query',
              required: false,
              description:
                '`anchor`（指定日を起点に 7 日間、既定）か `calendar`（指定日を含む日〜土の週）',
              schema: { type: 'string', enum: ['anchor', 'calendar'], default: 'anchor' },
            },
            AT_PARAM,
            LANG_PARAM,
          ],
          responses: { '200': periodResponse('7 日間の時間表'), ...ERROR_RESPONSES },
        },
      },

      '/api/v1/months/{month}': {
        get: {
          tags: ['periods'],
          summary: '1 日から最終日までの時間表',
          parameters: [
            {
              name: 'month',
              in: 'path',
              required: true,
              description: '`YYYY-MM`、または `current`',
              schema: { type: 'string' },
              example: 'current',
            },
            AT_PARAM,
            LANG_PARAM,
            {
              name: 'grid',
              in: 'query',
              required: false,
              description:
                '`1` を指定すると週区切りのカレンダーグリッド（`calendarGrid`）を追加する',
              schema: { type: 'string', enum: ['0', '1'] },
            },
            {
              name: 'weekStart',
              in: 'query',
              required: false,
              description: '`grid=1` のときの週の始まり。`0`=日曜（既定）、`1`=月曜',
              schema: { type: 'string', enum: ['0', '1'] },
            },
          ],
          responses: { '200': periodResponse('当該月の時間表'), ...ERROR_RESPONSES },
        },
      },

      '/api/v1/years': {
        get: {
          tags: ['meta'],
          summary: '提供中の年の一覧',
          responses: {
            '200': {
              description: '提供中の年（今年と、公開されていれば来年）',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/YearsResponse' } },
              },
            },
          },
        },
      },

      '/api/v1/years/{year}': {
        get: {
          tags: ['periods'],
          summary: '年間の時間表',
          description:
            '提供対象は今年と来年のみ。それ以外は `404 year-not-available` を返す（原本は永久保存しているが、時間表として提供するのは 2 年分だけ）。',
          parameters: [
            {
              name: 'year',
              in: 'path',
              required: true,
              description: '西暦年、または `current`',
              schema: { type: 'string' },
              example: 'current',
            },
            AT_PARAM,
            LANG_PARAM,
          ],
          responses: { '200': periodResponse('年間の時間表'), ...ERROR_RESPONSES },
        },
      },

      '/api/v1/days': {
        get: {
          tags: ['periods'],
          summary: '任意期間の時間表',
          parameters: [
            {
              name: 'from',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'date' },
            },
            {
              name: 'to',
              in: 'query',
              required: true,
              description: '`from` 以降。範囲は最大 400 日',
              schema: { type: 'string', format: 'date' },
            },
            AT_PARAM,
            LANG_PARAM,
          ],
          responses: { '200': periodResponse('指定期間の時間表'), ...ERROR_RESPONSES },
        },
      },

      '/api/v1/calendar.ics': {
        get: {
          tags: ['feed'],
          summary: 'iCalendar フィード（RFC 5545）',
          parameters: [
            {
              name: 'year',
              in: 'query',
              required: false,
              description: '省略時は提供中の全年',
              schema: { type: 'integer' },
            },
            {
              name: 'alarm',
              in: 'query',
              required: false,
              description: '開始何分前に通知するか（0〜1440）。省略時はアラームなし',
              schema: { type: 'integer', minimum: 0, maximum: 1440 },
            },
            LANG_PARAM,
          ],
          responses: {
            '200': {
              description: 'iCalendar 形式のカレンダー',
              content: { 'text/calendar': { schema: { type: 'string' } } },
            },
            ...ERROR_RESPONSES,
          },
        },
      },

      '/api/v1/meta': {
        get: {
          tags: ['meta'],
          summary: '施設情報・出典・データ保持方針',
          responses: {
            '200': {
              description: '施設情報と出典',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/MetaResponse' } },
              },
            },
          },
        },
      },

      '/api/v1/healthz': {
        get: {
          tags: ['system'],
          summary: 'ヘルスチェック',
          responses: {
            '200': {
              description: '`status` が `ok` なら今年のデータあり、`degraded` ならなし',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['ok', 'degraded'] },
                      checks: {
                        type: 'object',
                        properties: {
                          currentYearData: { type: 'string', enum: ['ok', 'missing'] },
                          activeYears: { type: 'array', items: { type: 'integer' } },
                          lastRunAt: { type: 'string', nullable: true },
                          archivePublic: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: buildComponentSchemas(),
      securitySchemes: {
        adminToken: {
          type: 'http',
          scheme: 'bearer',
          description:
            '管理エンドポイント専用。`/api/v1/admin/*` は既定で無効で、`ADMIN_TOKEN` を設定した場合のみ有効になる。',
        },
      },
    },
  };
}
