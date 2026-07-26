import { describe, it, expect } from 'vitest';
import type * as Zod from '@mizunashi/schema';
import type * as Api from '../src/index.js';

/**
 * 公開する型と Zod 定義が等価であることをコンパイル時に検証する。
 * ずれた時点で typecheck が落ちるので、公開パッケージが嘘をつくことがない
 * （DESIGN.md §11.8「型が API とずれないようにする」）。
 *
 * 生成ではなく等価アサーションにしたのは、生成器の依存を増やさずに済み、
 * 差分が人間にレビュー可能な形で残るため。
 */
/* 型の同一性を判定する既知のイディオム。条件型の遅延評価に T が必要で、
   型引数を外すと構造的に等しいだけの型まで通してしまう */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

type Assert<T extends true> = T;

/** 1 つでも等価でなければ、この型の定義自体がコンパイルエラーになる */
export type Contracts = [
  Assert<Equals<Api.Session, Zod.Session>>,
  Assert<Equals<Api.Holiday, Zod.Holiday>>,
  Assert<Equals<Api.DaySummary, Zod.DaySummary>>,
  Assert<Equals<Api.DaySchedule, Zod.DaySchedule>>,
  Assert<Equals<Api.SourceRef, Zod.SourceRef>>,
  Assert<Equals<Api.ResponseMeta, Zod.ResponseMeta>>,
  Assert<Equals<Api.ResolvedSession, Zod.ResolvedSession>>,
  Assert<Equals<Api.UnavailableReason, Zod.UnavailableReason>>,
  Assert<Equals<Api.Coverage, Zod.Coverage>>,
  Assert<Equals<Api.RelativeInfo, Zod.RelativeInfo>>,
  Assert<Equals<Api.PeriodSummary, Zod.PeriodSummary>>,
  Assert<Equals<Api.PeriodNavigation, Zod.PeriodNavigation>>,
  Assert<Equals<Api.PeriodScope, Zod.PeriodScope>>,
  Assert<Equals<Api.PeriodResponse, Zod.PeriodResponse>>,
  Assert<Equals<Api.StatusResponse, Zod.StatusResponse>>,
  Assert<Equals<Api.YearsResponse, Zod.YearsResponse>>,
  Assert<Equals<Api.Localized, Zod.Localized>>,
  Assert<Equals<Api.MetaResponse, Zod.MetaResponse>>,
  Assert<Equals<Api.ProblemDetails, Zod.ProblemDetails>>,
];

describe('契約', () => {
  it('型の等価性はコンパイル時に検証される', () => {
    // 上のアサーションが通ることが本体。ここは検証が実行されたことの記録
    expect(true).toBe(true);
  });
});
