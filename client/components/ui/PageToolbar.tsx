"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import { Card } from "./Card";
import { type FilterTabOption, FilterTabs } from "./FilterTabs";
import { SearchInput } from "./Input";
import { SelectAllCheckbox } from "./SelectAllCheckbox";

export interface PageToolbarSelectionConfig {
    onDeselectAll: () => void;
    onSelectAll: () => void;
    selectedCount: number;
    totalCount: number;
}

export interface PageToolbarSearchConfig {
    onChange: (value: string) => void;
    /** Fired on Enter. For searches too expensive to run per keystroke - an
     *  AI-backed lookup, say - where typing must not fire the request. */
    onSubmit?: () => void;
    placeholder?: string;
    value: string;
}

export interface PageToolbarFilterConfig {
    activeKey: string;
    /** Droppable-id prefix, passed through to FilterTabs when enableDropTargets is set. */
    dropTargetPrefix?: string;
    /** When true, each tab becomes a dnd-kit drop target — must be rendered
     *  inside a DndContext. See FilterTabs' matching prop. */
    enableDropTargets?: boolean;
    /** Stretch the tabs across the space between search and actions. */
    fill?: boolean;
    /** Unique layout ID for Framer Motion (use different IDs for multiple toolbars) */
    layoutId?: string;
    onChange: (key: string) => void;
    options: FilterTabOption[];
    /** Control visibility for animated show/hide (defaults to true) */
    visible?: boolean;
}

export interface PageToolbarPrimaryTabsConfig {
    activeKey: string;
    /** Unique layout ID for Framer Motion */
    layoutId?: string;
    onChange: (key: string) => void;
    options: FilterTabOption[];
}

export interface PageToolbarViewConfig {
    mode: "grid" | "list";
    onChange: (mode: "grid" | "list") => void;
    showLabels?: boolean;
}

export interface PageToolbarProps {
    /** Whether to animate on mount */
    animate?: boolean;

    /** Animation delay (in seconds) */
    animationDelay?: number;

    /** Custom content for the center section (replaces filter tabs) */
    centerContent?: React.ReactNode;

    /** Additional CSS classes */
    className?: string;

    /** Filter tabs configuration (smaller, can be conditionally shown) */
    filterTabs?: PageToolbarFilterConfig;

    /** Custom content for the left section (replaces selection + search) */
    leftContent?: React.ReactNode;

    /** Primary action button (e.g., "Add" button) */
    primaryAction?: React.ReactNode;

    /** Primary navigation tabs (larger, always visible) - used for top-level view switching */
    primaryTabs?: PageToolbarPrimaryTabsConfig;

    /** Additional actions to render on the right side (before view toggle) */
    rightActions?: React.ReactNode;

    /** Custom content for the right section (replaces view toggle + actions) */
    rightContent?: React.ReactNode;

    /** Search input configuration */
    searchConfig?: PageToolbarSearchConfig;
    /** Selection checkbox configuration */
    selectionConfig?: PageToolbarSelectionConfig;

    /** Visual variant */
    variant?: "default" | "card";

    /** View mode toggle configuration (grid/list) */
    viewModeConfig?: PageToolbarViewConfig;
}

/**
 * PageToolbar - A unified toolbar component for management pages
 *
 * Features:
 * - 3-column responsive grid layout
 * - Optional selection checkbox with count
 * - Search input with consistent sizing
 * - Primary tabs for top-level navigation (larger, with icons)
 * - Filter tabs with animated sliding indicator (smaller, contextual)
 * - Grid/List view toggle
 * - Support for custom content in any section
 * - Card variant for visual separation
 *
 * @example
 * ```tsx
 * <PageToolbar
 *   searchConfig={{
 *     value: searchQuery,
 *     onChange: setSearchQuery,
 *     placeholder: "Search items...",
 *   }}
 *   primaryTabs={{
 *     options: [
 *       { key: 'watch', label: 'Watch', icon: <PlayIcon /> },
 *       { key: 'tasks', label: 'Tasks', icon: <ClockIcon /> },
 *     ],
 *     activeKey: viewMode,
 *     onChange: setViewMode,
 *   }}
 *   filterTabs={{
 *     options: [{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }],
 *     activeKey: filter,
 *     onChange: setFilter,
 *     visible: viewMode === 'watch', // Only show when watch is active
 *   }}
 *   viewModeConfig={{
 *     mode: viewMode,
 *     onChange: setViewMode,
 *   }}
 * />
 * ```
 */
export function PageToolbar({
    selectionConfig,
    searchConfig,
    primaryTabs,
    filterTabs,
    viewModeConfig,
    primaryAction,
    rightActions,
    leftContent,
    centerContent,
    rightContent,
    variant = "default",
    className = "",
    animate = true,
    animationDelay = 0,
}: PageToolbarProps) {
    const _hasLeftSection = leftContent || selectionConfig || searchConfig;
    const _hasCenterSection = centerContent || primaryTabs || filterTabs;
    const _hasRightSection = rightContent || rightActions || viewModeConfig;

    // Determine if filter tabs should be visible
    const showFilterTabs = filterTabs && filterTabs.visible !== false;

    // On a phone every page's tabs are the same sliding row - full names,
    // dragged, swiped or moved with the edge arrow - on a line of their own
    // under the search and actions, instead of a drop-down. Only one row is
    // ever mounted, so drop targets on the tabs (Addons' Protected) exist once.
    const isMobile = useIsMobile();
    const rowOnPhone = !!filterTabs;
    const phoneRow = rowOnPhone && isMobile;

    // flex-wrap so the actions drop to their own line rather than overflowing
    // on a narrow screen. Both sections used to be shrink-0 on a non-wrapping
    // row, so at phone widths the action buttons were pushed past the right
    // edge and clipped by the panel's overflow-x:hidden - rendered, but
    // literally unreachable (verified at 375px: the Add button sat at x=389 on
    // a 375px viewport and failed hit-testing).
    const toolbarContent = (
        <div className="relative flex min-h-[44px] flex-wrap items-center justify-between gap-3 md:gap-2">
            {/* Left Section: Selection + Search */}
            <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
                {leftContent ? (
                    leftContent
                ) : (
                    <>
                        {selectionConfig && (
                            <SelectAllCheckbox
                                onDeselectAll={selectionConfig.onDeselectAll}
                                onSelectAll={selectionConfig.onSelectAll}
                                selectedCount={selectionConfig.selectedCount}
                                title={
                                    selectionConfig.selectedCount === 0
                                        ? "Select all"
                                        : selectionConfig.selectedCount ===
                                            selectionConfig.totalCount
                                          ? "Deselect all"
                                          : "Deselect all"
                                }
                                totalCount={selectionConfig.totalCount}
                            />
                        )}
                        {searchConfig && (
                            <div
                                className={`flex h-11 items-center ${filterTabs?.fill ? "w-40" : "w-40 md:w-48 lg:w-56"}`}
                            >
                                <SearchInput
                                    onChange={(e) => searchConfig.onChange(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && searchConfig.onSubmit) {
                                            e.preventDefault();
                                            searchConfig.onSubmit();
                                        }
                                    }}
                                    placeholder={searchConfig.placeholder || "Search..."}
                                    size="sm"
                                    value={searchConfig.value}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Center Section: Primary Tabs + Filter Tabs. Fills the space between
          the search and the actions, the same gap on each side; it used to
          float centered over the row, which capped it at half the width. */}
            {!phoneRow && (
                <div
                    className={`hidden min-w-0 flex-1 items-center gap-3 md:flex ${filterTabs?.fill ? "" : "justify-center"}`}
                >
                    {centerContent ? (
                        centerContent
                    ) : (
                        <>
                            {/* Primary Tabs (larger, always visible) */}
                            {primaryTabs && (
                                <FilterTabs
                                    activeKey={primaryTabs.activeKey}
                                    layoutId={primaryTabs.layoutId || "primary-tabs"}
                                    onChange={primaryTabs.onChange}
                                    options={primaryTabs.options}
                                    size="md"
                                />
                            )}

                            {/* Divider + Filter Tabs (animated visibility) */}
                            <AnimatePresence mode="wait">
                                {showFilterTabs && (
                                    <motion.div
                                        animate={{
                                            marginLeft: primaryTabs ? 12 : 0,
                                            opacity: 1,
                                            width: "auto",
                                        }}
                                        className={`flex min-w-0 flex-1 items-center gap-3 overflow-hidden ${filterTabs.fill ? "" : "justify-center"}`}
                                        exit={{ marginLeft: 0, opacity: 0, width: 0 }}
                                        initial={{ marginLeft: 0, opacity: 0, width: 0 }}
                                        transition={{ duration: 0.2, ease: "easeInOut" }}
                                    >
                                        {/* Subtle divider between primary and filter tabs */}
                                        {primaryTabs && (
                                            <div className="h-6 w-px shrink-0 bg-default/50" />
                                        )}

                                        <FilterTabs
                                            activeKey={filterTabs.activeKey}
                                            dropTargetPrefix={filterTabs.dropTargetPrefix}
                                            enableDropTargets={filterTabs.enableDropTargets}
                                            fill={filterTabs.fill}
                                            layoutId={filterTabs.layoutId || "filter-tabs"}
                                            onChange={filterTabs.onChange}
                                            options={filterTabs.options}
                                            size="sm"
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Fallback: Show filter tabs without animation if no primaryTabs */}
                            {!primaryTabs &&
                                filterTabs &&
                                filterTabs.visible !== false &&
                                !showFilterTabs && (
                                    <FilterTabs
                                        activeKey={filterTabs.activeKey}
                                        dropTargetPrefix={filterTabs.dropTargetPrefix}
                                        enableDropTargets={filterTabs.enableDropTargets}
                                        fill={filterTabs.fill}
                                        layoutId={filterTabs.layoutId}
                                        onChange={filterTabs.onChange}
                                        options={filterTabs.options}
                                        size="sm"
                                    />
                                )}
                        </>
                    )}
                </div>
            )}

            {/* Right Section: Actions */}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-3">
                {/* Shown at every width. This used to be `hidden md:block`, which
            meant the main action of a page - Add user, Add group, Create
            invitation, Add/Browse addon - simply did not exist on a phone.
            The only way in was the empty-state button, so once a list had
            anything in it the page became read-only on mobile. */}
                {primaryAction && <div>{primaryAction}</div>}
                {rightContent ? rightContent : rightActions}
            </div>

            {/* Phone: the full-name tab row on a line of its own. */}
            {phoneRow && filterTabs && showFilterTabs && (
                <div className="min-w-0 basis-full">
                    <FilterTabs
                        activeKey={filterTabs.activeKey}
                        dropTargetPrefix={filterTabs.dropTargetPrefix}
                        enableDropTargets={filterTabs.enableDropTargets}
                        fill
                        layoutId={filterTabs.layoutId || "filter-tabs"}
                        onChange={filterTabs.onChange}
                        options={filterTabs.options}
                        size="sm"
                    />
                </div>
            )}
        </div>
    );

    // Wrap in motion div for animation
    const animatedContent = animate ? (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={`mb-8 ${className}`}
            initial={{ opacity: 0, y: 20 }}
            transition={{ delay: animationDelay }}
        >
            {toolbarContent}
        </motion.div>
    ) : (
        <div className={`mb-8 ${className}`}>{toolbarContent}</div>
    );

    // Wrap in Card if variant is 'card'
    if (variant === "card") {
        return (
            <div className={`mb-6 ${className}`}>
                {animate ? (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        initial={{ opacity: 0, y: 20 }}
                        transition={{ delay: animationDelay }}
                    >
                        <Card padding="md">{toolbarContent}</Card>
                    </motion.div>
                ) : (
                    <Card padding="md">{toolbarContent}</Card>
                )}
            </div>
        );
    }

    return animatedContent;
}

/**
 * PageToolbarCompact - A simplified single-row toolbar for pages with minimal filtering needs
 */
export function PageToolbarCompact({
    searchConfig,
    viewModeConfig: _viewModeConfig,
    rightActions,
    className = "",
}: Pick<PageToolbarProps, "searchConfig" | "viewModeConfig" | "rightActions" | "className">) {
    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={`mb-8 flex items-center justify-between gap-4 ${className}`}
            initial={{ opacity: 0, y: 20 }}
        >
            {/* Search */}
            {searchConfig && (
                <div className="flex-1" style={{ maxWidth: "448px" }}>
                    <SearchInput
                        onChange={(e) => searchConfig.onChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && searchConfig.onSubmit) {
                                e.preventDefault();
                                searchConfig.onSubmit();
                            }
                        }}
                        placeholder={searchConfig.placeholder || "Search..."}
                        size="sm"
                        value={searchConfig.value}
                    />
                </div>
            )}

            {/* Right side */}
            <div className="flex items-center gap-2">{rightActions}</div>
        </motion.div>
    );
}
