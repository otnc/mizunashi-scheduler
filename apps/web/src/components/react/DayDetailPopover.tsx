import { useEffect, useRef, type ReactNode } from 'react';
import type { DaySchedule } from '@mizunashi/api-types';
import { formatDate, dayTotalLabel } from '../../lib/format';
import { SessionList } from './SessionList';

export interface DayDetailPopoverProps {
  day: DaySchedule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 画面端でポップアップが切れないよう、セルの列位置に応じて揃える */
  align?: 'left' | 'center' | 'right';
  /** トリガー（週・月の狭いセル）の見た目。中身の意味はここでは問わない */
  children: ReactNode;
}

const ALIGN_CLASS: Record<NonNullable<DayDetailPopoverProps['align']>, string> = {
  left: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  right: 'right-0',
};

/** hover で開いたあと、ポップアップ本体へ移動する間の猶予（ms） */
const HOVER_CLOSE_DELAY = 150;

/**
 * 週・月ビューの狭いセルはミニタイムラインしか置けず、正確な時刻が読めない
 * （DESIGN.md §12.4: セル内に時刻文字列を入れない）。
 * ホバー・クリック・タップで、今日カードと同じ SessionList を出す。
 */
export function DayDetailPopover({
  day,
  open,
  onOpenChange,
  align = 'center',
  children,
}: DayDetailPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current != null && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  useEffect(
    () => () => {
      if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const handleMouseEnter = (): void => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    onOpenChange(true);
  };

  const handleMouseLeave = (): void => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      onOpenChange(false);
    }, HOVER_CLOSE_DELAY);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className="block w-full rounded-md text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          onOpenChange(!open);
        }}
      >
        {children}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${formatDate(day.date)}の入浴可能時間`}
          className={`absolute top-full z-20 mt-1 w-64 max-w-[90vw] rounded-lg border border-border bg-card p-3 shadow-lg ${ALIGN_CLASS[align]}`}
        >
          <p className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
            <span>{formatDate(day.date)}</span>
            <span className="text-xs font-normal text-muted-foreground">{dayTotalLabel(day)}</span>
          </p>
          <SessionList day={day} />
        </div>
      )}
    </div>
  );
}
