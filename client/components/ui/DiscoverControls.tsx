"use client";

import {
    AdjustmentsHorizontalIcon,
    ArrowsRightLeftIcon,
    CheckIcon,
    ChevronDownIcon,
    MagnifyingGlassIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import {
    type ReactNode,
    type RefObject,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { GENRES, KINDS, type Kind, type SortKey } from "@/lib/discoverWords";

export function usePopover() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    const panel = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const el = panel.current;
        if (!(open && el)) {
            return;
        }
        el.style.maxHeight = `${Math.max(220, window.innerHeight - el.getBoundingClientRect().top - 16)}px`;
    }, [open]);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);
    return { fit: panel, open, ref, setOpen };
}

/** D-pad reachable in TV mode, a plain element everywhere else. */
export function Focus({
    tv,
    onEnter,
    children,
}: {
    tv: boolean;
    onEnter: () => void;
    children: React.ReactElement;
}) {
    return tv ? <TVFocusable onEnterPress={onEnter}>{children}</TVFocusable> : children;
}

export function Pill({
    on,
    onClick,
    children,
    tv = false,
}: {
    on: boolean;
    onClick: () => void;
    children: React.ReactNode;
    tv?: boolean;
}) {
    return (
        <Focus onEnter={onClick} tv={tv}>
            <button
                aria-pressed={on}
                className={`h-8 rounded-full px-3 font-medium text-[13px] transition-colors ${on ? "disc-pill-on text-default" : "disc-pill-off text-muted hover:text-default"}`}
                onClick={onClick}
                type="button"
            >
                {children}
            </button>
        </Focus>
    );
}

const panelStyle: React.CSSProperties = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-surface-border)",
    boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
};

interface DiscoverControlsProps<Lens extends string> {
    applied: Array<{ key: string; label: string; clear: () => void }>;
    filterCount: number;
    filtersBody: (close: () => void) => ReactNode;
    genre?: string;
    hasFilters: boolean;
    isTV?: boolean;
    kind: Kind;
    lens: Lens;
    lenses: Array<{ key: Lens; label: string; count?: number }>;
    onDescribe?: () => void;
    pickSort: (key: string) => void;
    searchPlaceholder: string;
    searchQuery: string;
    searchRef?: RefObject<HTMLInputElement | null>;
    setGenre?: (value: string) => void;
    setKind: (value: Kind) => void;
    setLens: (value: Lens) => void;
    setSearchQuery: (value: string) => void;
    setSort?: (value: SortKey) => void;
    sort?: SortKey;
    sortOptions: Array<{ key: string; label: string }> | null;
    sorts?: Array<{ key: SortKey; label: string }>;
    sortValue: string;
    surprise: () => void | Promise<void>;
}
export function DiscoverHeading() {
    return (
        <div className="discovery-heading mb-7">
            <p className="mb-3 font-semibold text-primary text-xs tracking-wide">
                A little inspiration
            </p>
            <h1 className="font-bold font-display text-default">Find your next favorite.</h1>
            <p className="mt-3 text-muted text-sm">
                Explore a title, follow a familiar face, or find something unexpected.
            </p>
        </div>
    );
}
export function DiscoverControls<Lens extends string>({
    isTV = false,
    searchRef,
    searchQuery,
    setSearchQuery,
    searchPlaceholder,
    onDescribe,
    kind,
    setKind,
    surprise,
    lens,
    setLens,
    lenses,
    sortOptions,
    sortValue,
    pickSort,
    hasFilters,
    filterCount,
    filtersBody,
    applied,
    sorts = [],
    sort,
    setSort,
    genre,
    setGenre,
}: DiscoverControlsProps<Lens>) {
    const localSearchRef = useRef<HTMLInputElement>(null);
    const inputRef = searchRef || localSearchRef;
    useEffect(() => {
        if (searchRef) {
            return;
        }
        const focus = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                event.key === "/" &&
                !(
                    target instanceof HTMLElement &&
                    (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))
                )
            ) {
                event.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener("keydown", focus);
        return () => window.removeEventListener("keydown", focus);
    }, [searchRef, inputRef]);
    const { open: sortOpen, setOpen: setSortOpen, ref: sortRef, fit: sortPanelRef } = usePopover();
    const {
        open: filtersOpen,
        setOpen: setFiltersOpen,
        ref: filtersRef,
        fit: filtersPanelRef,
    } = usePopover();
    const sortLabel = sortOptions?.find((option) => option.key === sortValue)?.label || "";
    const lensSpan = (index: number) =>
        lenses.length === 5
            ? index < 3
                ? 2
                : 3
            : lenses.length === 4
              ? 3
              : 6 / Math.max(1, lenses.length);
    return (
        <div className="discovery-controls interface-panel mb-7 rounded-2xl p-4 md:p-5">
            {/* The search, what kind, and Surprise me. TV has no search - typing on a remote isn't worth it. */}
            <div className="flex flex-wrap items-center gap-3">
                {!isTV && (
                    <label
                        className="flex h-[52px] min-w-0 flex-1 basis-full items-center gap-3 rounded-2xl pr-3 pl-4 sm:min-w-[16rem] sm:basis-auto"
                        style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                        }}
                    >
                        <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-muted" />
                        <input
                            aria-label="Search"
                            className="min-w-0 flex-1 bg-transparent text-base text-default outline-none"
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                // A sentence rather than a title is a description: Enter
                                // looks for what it describes.
                                if (
                                    e.key === "Enter" &&
                                    onDescribe &&
                                    lens === "titles" &&
                                    searchQuery.trim().split(/\s+/).length >= 4
                                ) {
                                    e.preventDefault();
                                    onDescribe();
                                }
                            }}
                            placeholder={searchPlaceholder}
                            ref={inputRef}
                            value={searchQuery}
                        />
                        {searchQuery ? (
                            <button
                                aria-label="Clear search"
                                className="rounded-md p-1 text-muted hover:text-default"
                                onClick={() => setSearchQuery("")}
                                type="button"
                            >
                                <XMarkIcon className="h-4 w-4" />
                            </button>
                        ) : (
                            <kbd
                                className="hidden h-[22px] min-w-[22px] items-center justify-center rounded-md px-1.5 text-muted text-xs sm:inline-flex"
                                style={{ border: "1px solid var(--color-surface-border)" }}
                            >
                                /
                            </kbd>
                        )}
                    </label>
                )}
                <div
                    aria-label="Kind"
                    className="flex w-full rounded-xl p-1 sm:w-auto"
                    role="group"
                    style={{ background: "var(--color-surface-hover)" }}
                >
                    {KINDS.map((k) => (
                        <Focus key={k.key} onEnter={() => setKind(k.key)} tv={isTV}>
                            <button
                                aria-pressed={kind === k.key}
                                className={`h-10 flex-1 rounded-[10px] px-4 font-medium text-sm transition-colors sm:flex-none ${kind === k.key ? "disc-choice-on text-default" : "text-muted hover:text-default"}`}
                                onClick={() => setKind(k.key)}
                                type="button"
                            >
                                {k.label}
                            </button>
                        </Focus>
                    ))}
                </div>
                <Focus
                    onEnter={() => {
                        void surprise();
                    }}
                    tv={isTV}
                >
                    <button
                        className="hidden h-10 items-center gap-2 rounded-xl px-3.5 font-medium text-default text-sm sm:inline-flex"
                        onClick={() => {
                            void surprise();
                        }}
                        style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                        }}
                        type="button"
                    >
                        <ArrowsRightLeftIcon className="h-4 w-4" />
                        Surprise me
                    </button>
                </Focus>
            </div>

            {/* What you are looking through, and in what order and with what filters. */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
                <div className="grid w-full grid-cols-6 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-2">
                    {lenses.map((l, i) => (
                        <Focus key={l.key} onEnter={() => setLens(l.key)} tv={isTV}>
                            <button
                                aria-pressed={lens === l.key}
                                className={`whitespace-nowrap rounded-full px-1.5 py-2 text-center font-medium text-[14px] transition-colors sm:px-4 sm:py-1.5 sm:text-[15px] ${lens === l.key ? "disc-choice-on text-default" : "text-muted hover:text-default"}`}
                                onClick={() => setLens(l.key)}
                                style={{ gridColumn: `span ${lensSpan(i)}` }}
                                type="button"
                            >
                                {l.label}
                                {l.count ? (
                                    <span
                                        className="ml-1.5 rounded-full px-1.5 py-px text-[11px]"
                                        style={{ background: "rgba(255,255,255,.08)" }}
                                    >
                                        {l.count}
                                    </span>
                                ) : null}
                            </button>
                        </Focus>
                    ))}
                </div>

                {!isTV && (sortOptions || hasFilters) && (
                    <div className="relative flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                        {sortOptions && (
                            <div className="flex-1 sm:relative sm:flex-none" ref={sortRef}>
                                <button
                                    aria-expanded={sortOpen}
                                    className="inline-flex h-10 w-full items-center justify-between gap-1.5 rounded-xl px-3.5 font-medium text-default text-sm sm:h-9 sm:justify-start sm:rounded-[10px] sm:px-3"
                                    onClick={() => setSortOpen(!sortOpen)}
                                    style={{ background: "var(--color-surface-hover)" }}
                                    type="button"
                                >
                                    <span>
                                        <span className="text-muted">Sort</span> {sortLabel}
                                    </span>
                                    <ChevronDownIcon className="h-3.5 w-3.5" />
                                </button>
                                {sortOpen && (
                                    <div
                                        className="absolute top-full right-0 left-0 z-30 mt-2 overflow-y-auto rounded-2xl p-1.5 sm:right-0 sm:left-auto sm:w-52"
                                        ref={sortPanelRef}
                                        style={panelStyle}
                                    >
                                        {sortOptions.map((o) => (
                                            <button
                                                className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm ${sortValue === o.key ? "text-default" : "text-muted hover:bg-surface-hover hover:text-default"}`}
                                                key={o.key}
                                                onClick={() => {
                                                    pickSort(o.key);
                                                    setSortOpen(false);
                                                }}
                                                type="button"
                                            >
                                                {o.label}
                                                {sortValue === o.key && (
                                                    <CheckIcon
                                                        className="h-4 w-4"
                                                        style={{ color: "var(--color-primary)" }}
                                                    />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {hasFilters && (
                            <div
                                className={
                                    sortOptions ? "sm:relative" : "flex-1 sm:relative sm:flex-none"
                                }
                                ref={filtersRef}
                            >
                                <button
                                    aria-expanded={filtersOpen}
                                    aria-label={
                                        filterCount > 0 ? `Filters, ${filterCount} on` : "Filters"
                                    }
                                    className={`relative h-10 sm:h-9 ${sortOptions ? "w-10 justify-center sm:w-auto" : "w-full justify-between sm:w-auto sm:justify-start"} disc-filters-btn inline-flex items-center gap-2 rounded-xl px-3 font-medium text-default text-sm sm:rounded-[10px] sm:pr-2 sm:pl-3 ${filtersOpen ? "is-open" : ""}`}
                                    data-open={filtersOpen || undefined}
                                    onClick={() => setFiltersOpen(!filtersOpen)}
                                    type="button"
                                >
                                    <AdjustmentsHorizontalIcon className="h-5 w-5 sm:h-4 sm:w-4" />
                                    <span className={sortOptions ? "hidden sm:inline" : ""}>
                                        Filters
                                    </span>
                                    {filterCount > 0 && (
                                        <span
                                            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-bold text-[11px] text-white ${sortOptions ? "absolute -top-1.5 -right-1.5 sm:static" : ""}`}
                                            style={{ background: "var(--color-primary)" }}
                                        >
                                            {filterCount}
                                        </span>
                                    )}
                                </button>
                                {filtersOpen && (
                                    <div
                                        className="absolute top-full right-0 left-0 z-30 mt-2 flex flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl p-5 sm:right-0 sm:left-auto sm:w-[min(560px,92vw)]"
                                        data-filters-panel
                                        ref={filtersPanelRef}
                                        style={panelStyle}
                                    >
                                        {filtersBody(() => setFiltersOpen(false))}
                                    </div>
                                )}
                            </div>
                        )}
                        <button
                            aria-label="Surprise me"
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-default sm:hidden"
                            onClick={() => {
                                void surprise();
                            }}
                            style={{ background: "var(--color-surface-hover)" }}
                            type="button"
                        >
                            <ArrowsRightLeftIcon className="h-5 w-5" />
                        </button>
                    </div>
                )}
            </div>

            {/* TV: the order and genre as rows of pills - a remote can't drive a popup. */}
            {isTV && lens === "titles" && (
                <div className="mt-3 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                        {sorts.map((o) => (
                            <Pill
                                key={o.key}
                                on={sort === o.key}
                                onClick={() => setSort?.(o.key)}
                                tv
                            >
                                {o.label}
                            </Pill>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Pill on={!genre} onClick={() => setGenre?.("")} tv>
                            All genres
                        </Pill>
                        {GENRES.map((g) => (
                            <Pill key={g} on={genre === g} onClick={() => setGenre?.(g)} tv>
                                {g}
                            </Pill>
                        ))}
                    </div>
                </div>
            )}

            {applied.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                    {applied.map((a) => (
                        <button
                            aria-label={`Remove ${a.label}`}
                            className="inline-flex h-7 items-center gap-1 rounded-full pr-1.5 pl-3 text-[13px]"
                            key={a.key}
                            onClick={a.clear}
                            style={{
                                background:
                                    "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                                color: "color-mix(in srgb, var(--color-primary) 40%, #ffffff)",
                            }}
                            type="button"
                        >
                            {a.label}
                            <XMarkIcon className="h-3.5 w-3.5" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function DiscoverFilters({
    groups,
    count,
    clear,
    close,
    children,
}: {
    groups: Array<{
        label: string;
        value: string;
        options: Array<{ value: string; label: string }>;
        onChange: (value: string) => void;
    }>;
    count: number;
    clear: () => void;
    close: () => void;
    children?: ReactNode;
}) {
    return (
        <>
            {groups.map((group) => (
                <div className="flex flex-col gap-2" key={group.label}>
                    <span className="font-semibold text-muted text-xs uppercase tracking-[0.08em]">
                        {group.label}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                        <Pill on={!group.value} onClick={() => group.onChange("")}>
                            Any
                        </Pill>
                        {group.options.map((option) => (
                            <Pill
                                key={option.value}
                                on={group.value === option.value}
                                onClick={() => group.onChange(option.value)}
                            >
                                {option.label}
                            </Pill>
                        ))}
                    </div>
                </div>
            ))}
            {children}
            <div
                className="flex items-center justify-between pt-3"
                style={{ borderTop: "1px solid var(--color-surface-border)" }}
            >
                <button
                    className="font-medium text-sm disabled:opacity-40"
                    disabled={!count}
                    onClick={clear}
                    style={{ color: "var(--color-primary)" }}
                    type="button"
                >
                    Clear all
                </button>
                <button
                    className="rounded-lg px-4 py-1.5 font-semibold text-sm text-white"
                    onClick={close}
                    style={{ background: "var(--color-primary)" }}
                    type="button"
                >
                    Done
                </button>
            </div>
        </>
    );
}
