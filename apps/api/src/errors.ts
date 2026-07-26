import type { ProblemDetails, ResponseMeta } from '@mizunashi/api-types';

export type ProblemType =
  | 'invalid-parameter'
  | 'not-found'
  | 'year-not-available'
  | 'unauthorized'
  | 'rate-limited'
  | 'internal-error'
  | 'data-unavailable';

const TITLES: Record<ProblemType, string> = {
  'invalid-parameter': 'Invalid parameter',
  'not-found': 'Not found',
  'year-not-available': 'Year not available',
  unauthorized: 'Unauthorized',
  'rate-limited': 'Rate limited',
  'internal-error': 'Internal error',
  'data-unavailable': 'Data unavailable',
};

const STATUS: Record<ProblemType, number> = {
  'invalid-parameter': 400,
  'not-found': 404,
  'year-not-available': 404,
  unauthorized: 401,
  'rate-limited': 429,
  'internal-error': 500,
  'data-unavailable': 503,
};

export class ApiProblem extends Error {
  constructor(
    readonly problemType: ProblemType,
    readonly detail: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(detail);
    this.name = 'ApiProblem';
  }

  get status(): number {
    return STATUS[this.problemType];
  }

  /** RFC 9457。エラーでも meta を返す（DESIGN.md §11.6） */
  toResponse(baseUrl: string, instance: string, meta: ResponseMeta): ProblemDetails {
    return {
      type: `${baseUrl}/errors/${this.problemType}`,
      title: TITLES[this.problemType],
      status: this.status,
      detail: this.detail,
      instance,
      ...(this.errors ? { errors: this.errors } : {}),
      meta,
    };
  }
}
