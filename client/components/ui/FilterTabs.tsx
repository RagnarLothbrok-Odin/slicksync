'use client';

import { useState, useRef, useLayoutEffect, useEffect, useId, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/core';
import { useIsTV } from '@/lib/hooks/useIsTV';
import { TVFocusable } from '@/components/tv/TVFocusable';
import { ScrollRow } from './ScrollRow';

// One tab stop per group, with native focus scrolling the selected tab into view.
function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
  if (!tabs.length) return;
  const current = tabs.indexOf(event.currentTarget);
  const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
  const step = event.key === 'ArrowRight' ? direction : -direction;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + step + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

// Wraps a tab button to make it a dnd-kit drop target when enabled — kept as
// its own component since useDroppable is a hook and can't be called
// conditionally inside the options.map() loop.
function DroppableTabButton({ id, enabled, isOver: isOverOverride, children }: { id: string; enabled: boolean; isOver?: boolean; children: (isOver: boolean) => React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !enabled });
  // A tab may grow into spare room, but only to 150px: on a wide screen the
  // rest becomes even space between tabs rather than long, mostly empty
  // buttons. min-w-max keeps a longer name (Vault's "Metadata & Trackers")
  // whole - an explicit min-width wins over max-width. Inline, as this
  // project's max-w-* classes don't apply (see commit 423221d).
  return <div ref={enabled ? setNodeRef : undefined} className="grow shrink-0 min-w-max" style={{ maxWidth: 150 }}>{children(enabled ? isOver : false)}</div>;
}

export interface FilterTabOption {
  key: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  badge?: {
    value: number | string;
    variant?: 'default' | 'error' | 'warning' | 'success';
  };
}

export interface FilterTabsProps {
  /** Stretch the box across the space it's given, the tabs sharing the
   *  spare width. Off: the box is as wide as its tabs. Either way a row
   *  that doesn't fit scrolls sideways instead of cutting names short. */
  fill?: boolean;
  options: FilterTabOption[];
  activeKey: string;
  onChange: (key: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  /** Unique ID for the sliding indicator animation (use different IDs if multiple FilterTabs on same page) */
  layoutId?: string;
  /** When true, each tab becomes a dnd-kit droppable zone with id `${dropTargetPrefix}${key}` — must be rendered inside a DndContext */
  enableDropTargets?: boolean;
  /** Prefix for the droppable id, so pages sharing one DndContext can tell
   *  each other's category-tab drops apart (e.g. 'vault-category-' vs
   *  'addon-tag-'). Defaults to 'vault-category-' for backward compat with
   *  the original (only) consumer. */
  dropTargetPrefix?: string;
}

/**
 * FilterTabs - A modern tab selector with Framer Motion sliding indicator
 * 
 * Features:
 * - Animated sliding background indicator
 * - Support for icons, counts, and badges
 * - Two sizes: sm (compact) and md (default)
 * - Accessible with ARIA attributes
 */
export function FilterTabs({
  fill = false,
  options,
  activeKey,
  onChange,
  size = 'sm',
  className = '',
  layoutId,
  enableDropTargets = false,
  dropTargetPrefix = 'vault-category-',
}: FilterTabsProps) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  const generatedId = useId();
  const uniqueLayoutId = layoutId || `filter-tabs-${generatedId}`;

  // Function to calculate and update indicator position
  const updateIndicatorPosition = () => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const activeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-tab-key]'))
      .find(button => button.dataset.tabKey === activeKey);

    if (activeButton) {
      const containerRect = container.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      // Measurements must use layout coordinates, even while a containing
      // dialog is scaling. A transform does not trigger ResizeObserver.
      const scale = container.offsetWidth ? containerRect.width / container.offsetWidth : 1;
      if (!scale) return;
      const next = { left: (buttonRect.left - containerRect.left) / scale, width: buttonRect.width / scale };
      setIndicatorStyle(previous => previous?.left === next.left && previous.width === next.width ? previous : next);
    }
  };

  // Calculate indicator position based on active tab - use layoutEffect to avoid flash
  useLayoutEffect(() => {
    updateIndicatorPosition();
  }, [activeKey, options]);

  // Use ResizeObserver to recalculate when button sizes change (e.g., after icons load)
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      updateIndicatorPosition();
    });

    // Observe all tab buttons for size changes
    const buttons = containerRef.current.querySelectorAll('[data-tab-key]');
    buttons.forEach((button) => resizeObserver.observe(button));
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, [activeKey, options]);

  // Size variants
  const sizeClasses = {
    sm: {
      container: 'gap-1 p-1',
      gap: 'gap-1',
      pad: 'p-1',
      button: 'px-4 py-1.5 text-sm',
      icon: 'w-4 h-4',
      badge: 'w-5 h-5 text-xs',
    },
    md: {
      container: 'gap-2 p-1.5',
      gap: 'gap-2',
      pad: 'p-1.5',
      button: 'px-5 py-2 text-sm',
      icon: 'w-5 h-5',
      badge: 'w-6 h-6 text-xs',
    },
  };

  const styles = sizeClasses[size];
  const isTV = useIsTV();

  return (
    // The box fills the space it's given. Every tab shows its full name and
    // the tabs share any spare width; when they don't all fit, the row
    // scrolls sideways (drag, swipe, wheel, or the small edge arrows).
    <ScrollRow
      arrows
      wrapperClassName={`interface-segments rounded-xl bg-surface border border-default ${fill ? 'w-full' : 'w-auto max-w-full'} ${className}`}
      className={styles.pad}
      role="tablist"
      aria-label="Filter options"
    >
    <div ref={containerRef} className={`relative flex justify-evenly ${styles.gap} w-max min-w-full`}>
      {/* Animated sliding indicator - only render when position is calculated */}
      {indicatorStyle && (
        <motion.div
          layoutId={uniqueLayoutId}
          className="interface-segment-indicator absolute left-0 top-0 bottom-0 rounded-lg"
          initial={false}
          animate={{
            x: indicatorStyle.left,
          }}
          transition={{
            duration: reduceMotion ? 0 : 0.3,
            type: reduceMotion ? 'tween' : 'spring',
            stiffness: 500,
            damping: 35,
            mass: 1,
          }}
          style={{
            width: indicatorStyle.width,
            zIndex: 0,
          }}
        />
      )}

      {/* Tab buttons */}
      {options.map((option) => {
        const isActive = activeKey === option.key;
        
        return (
          <DroppableTabButton key={option.key} id={`${dropTargetPrefix}${option.key}`} enabled={enableDropTargets}>
            {(isOver) => {
              const btn = (
              <button
                data-tab-key={option.key}
                onClick={() => onChange(option.key)}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onKeyDown={moveTabFocus}
                className={`
                  relative z-10 flex items-center justify-center gap-2 w-full whitespace-nowrap ${styles.button} rounded-lg font-medium
                  transition-colors duration-150 ease-out
                  ${isActive
                    ? 'text-primary'
                    : 'text-muted nav-item-hover-pill'
                  }
                  ${isOver ? 'tab-drop-over' : ''}
                `}
              >
              {/* Icon */}
              {option.icon && (
                <span className={`${styles.icon} shrink-0`}>
                  {option.icon}
                </span>
              )}

              {/* Label - always the full name; the row scrolls instead. */}
              <span>{option.label}</span>

              {/* Count (inline, muted) */}
              {option.count !== undefined && (
                <span className={`shrink-0 text-xs tabular-nums ${isActive ? 'text-primary/60' : 'text-subtle'}`}>
                  ({option.count})
                </span>
              )}

              {/* Badge (notification style, positioned) */}
              {option.badge && (
                <span
                  className={`
                    absolute -top-1 -right-1 ${styles.badge} rounded-full
                    flex items-center justify-center font-bold
                    ${option.badge.variant === 'error'
                      ? 'bg-error text-white'
                      : option.badge.variant === 'warning'
                        ? 'bg-warning text-white'
                        : option.badge.variant === 'success'
                          ? 'bg-success text-white'
                          : 'bg-primary text-white'
                    }
                  `}
                  aria-label={`${option.badge.value} ${option.label}`}
                >
                  {option.badge.value}
                </span>
              )}
              </button>
              );
              return isTV ? <TVFocusable onEnterPress={() => onChange(option.key)}>{btn}</TVFocusable> : btn;
            }}
          </DroppableTabButton>
        );
      })}
    </div>
    </ScrollRow>
  );
}

/**
 * FilterTabsSimple - A simpler version without the sliding indicator
 * Useful when you need multiple tab sets that shouldn't share animation context
 */
export function FilterTabsSimple({
  options,
  activeKey,
  onChange,
  size = 'sm',
  className = '',
}: Omit<FilterTabsProps, 'layoutId'>) {
  const sizeClasses = {
    sm: {
      container: 'gap-1 p-1',
      button: 'px-4 py-1.5 text-sm',
    },
    md: {
      container: 'gap-2 p-1.5',
      button: 'px-5 py-2 text-sm',
    },
  };

  const styles = sizeClasses[size];

  return (
    <div
      className={`flex flex-wrap ${styles.container} rounded-xl bg-surface border border-default ${className}`}
      role="tablist"
      aria-label="Filter options"
    >
      {options.map((option) => {
        const isActive = activeKey === option.key;
        
        return (
          <button
            key={option.key}
            onClick={() => onChange(option.key)}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            onKeyDown={moveTabFocus}
            aria-selected={isActive}
            className={`
              ${styles.button} rounded-lg font-medium transition-all duration-150
              ${isActive 
                ? 'bg-primary-muted text-primary' 
                : 'text-muted hover:text-default'
              }
            `}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={`ml-1.5 text-xs ${isActive ? 'text-primary/60' : 'text-subtle'}`}>
                ({option.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * FilterTabsResponsive - Shows dropdown on mobile, tabs on desktop
 * Perfect for pages with many filter options that don't fit on mobile
 */
export function FilterTabsResponsive({
  fill = false,
  options,
  activeKey,
  onChange,
  size = 'sm',
  className = '',
  layoutId,
  enableDropTargets = false,
  dropTargetPrefix,
}: FilterTabsProps) {
  // A native picker handles focus, dismissal, text scaling, and the platform's
  // touch interactions without a second modal implementation.
  if (fill) {
    return <FilterTabs fill options={options} activeKey={activeKey} onChange={onChange} size={size} className={className} layoutId={layoutId} enableDropTargets={enableDropTargets} dropTargetPrefix={dropTargetPrefix} />;
  }
  const many = options.length > 5;
  return (
    <div className={`min-w-0 ${className}`}>
      <select
        aria-label="Select filter"
        value={activeKey}
        onChange={event => onChange(event.target.value)}
        className={`interface-field w-full min-h-11 rounded-xl border border-default bg-surface px-3 text-sm text-default ${many ? 'lg:hidden' : 'md:hidden'}`}
      >
        {options.map(option => (
          <option key={option.key} value={option.key}>
            {option.label}{option.count !== undefined ? ` (${option.count})` : ''}
          </option>
        ))}
      </select>
      <div className={many ? 'hidden lg:block' : 'hidden md:block'}>
        <FilterTabs options={options} activeKey={activeKey} onChange={onChange} size={size} layoutId={layoutId} enableDropTargets={enableDropTargets} dropTargetPrefix={dropTargetPrefix} />
      </div>
    </div>
  );
}
