"use client";

import {
    CheckIcon,
    ClockIcon,
    FilmIcon,
    MagnifyingGlassIcon,
    PlayIcon,
    TrashIcon,
    TvIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ViewModeToggle } from "@/components/ui";
import type { PosterCardItem } from "@/components/ui/PosterCard";
import { PersonalMediaDetailModal } from "@/components/user/PersonalMediaDetailModal";
import { UserPageHeader } from "@/components/user/UserPageContainer";
import { buildNuvioAppUrl, buildStremioAppUrl } from "@/lib/appLinks";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { type LibraryItem, userLibrary } from "@/lib/user-api";

type ViewMode = "grid" | "list";
const unchangedLibrary = () => undefined;

// Format watch time from milliseconds to human-readable string
function formatWatchTime(ms: number | undefined | null): string | null {
    if (!ms || ms <= 0) {
        return null;
    }

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m`;
    }
    return null;
}

// Card item component
interface LibraryCardItemProps {
    // Nuvio's API has no library-removal capability (see server/providers/
    // nuvio.js's removeLibraryItem stub) - defaults true so every existing
    // Stremio call site is unaffected.
    canDelete?: boolean;
    isDeleting: boolean;
    isSelected: boolean;
    item: LibraryItem;
    onDelete: () => void;
    onToggle: () => void;
    selecting?: boolean;
    stremioLink: string | null;
    watchTime: string | null;
}

function LibraryCardItem({
    item,
    isSelected,
    isDeleting,
    onToggle,
    onDelete,
    canDelete = true,
    selecting = false,
    stremioLink,
    watchTime,
}: LibraryCardItemProps) {
    const [imageError, setImageError] = useState(false);

    return (
        <motion.div
            animate={{ opacity: 1, scale: 1 }}
            aria-label={`${selecting ? "Select" : "Open"} ${item.name}`}
            aria-pressed={selecting ? isSelected : undefined}
            className="group relative cursor-pointer"
            initial={{ opacity: 0, scale: 0.9 }}
            onClick={onToggle}
            onKeyDown={(event) => {
                if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                ) {
                    event.preventDefault();
                    onToggle();
                }
            }}
            role="button"
            tabIndex={0}
            whileHover={{ y: -4 }}
        >
            {/* Poster Card */}
            <div
                className={`relative aspect-[2/3] overflow-hidden rounded-xl shadow-xl ${isSelected ? "bd3-sel" : "bd-ok"}`}
            >
                {item.poster && !imageError ? (
                    <>
                        <img
                            alt={item.name}
                            className="h-full w-full object-cover transition-all duration-700 group-hover:scale-110"
                            onError={() => setImageError(true)}
                            src={item.poster}
                        />
                        {/* Gradient overlay - subtle */}
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 to-transparent opacity-40 transition-opacity group-hover:opacity-60" />
                    </>
                ) : (
                    <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ background: "var(--color-surface-elevated)" }}
                    >
                        {item.type === "movie" ? (
                            <FilmIcon
                                className="h-12 w-12"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                        ) : (
                            <TvIcon
                                className="h-12 w-12"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                        )}
                    </div>
                )}

                {/* Selection indicator - top left */}
                {isSelected && (
                    <div
                        className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full"
                        style={{ background: "var(--color-primary)" }}
                    >
                        <CheckIcon className="h-4 w-4 text-white" />
                    </div>
                )}

                {/* Stremio link - top right */}
                {stremioLink && (
                    <a
                        className="absolute top-2 right-2 rounded-full p-1.5 opacity-80 transition-opacity hover:opacity-100"
                        href={stremioLink}
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: "rgba(0,0,0,0.7)" }}
                        title="Open"
                    >
                        <PlayIcon className="h-4 w-4 text-white" />
                    </a>
                )}

                {/* Delete button - shows on hover */}
                {canDelete && (
                    <div className="absolute right-2 bottom-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                            className="rounded-full p-2 transition-all"
                            disabled={isDeleting}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            style={{ background: "rgba(239, 68, 68, 0.9)" }}
                            title="Delete"
                        >
                            {isDeleting ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            ) : (
                                <TrashIcon className="h-4 w-4 text-white" />
                            )}
                        </button>
                    </div>
                )}
            </div>

            {/* Content Info - Below the poster */}
            <div className="mt-2 space-y-0.5 text-center">
                {/* Content title */}
                <h4
                    className="line-clamp-2 font-semibold text-sm leading-tight"
                    style={{ color: "var(--color-text-muted)" }}
                    title={item.name}
                >
                    {item.name}
                </h4>

                {/* Watch time */}
                {watchTime && (
                    <div
                        className="flex items-center justify-center gap-1 text-xs"
                        style={{ color: "var(--color-text-subtle)" }}
                    >
                        <ClockIcon className="h-3 w-3" />
                        <span>{watchTime}</span>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

// List item component
interface LibraryListItemProps {
    canDelete?: boolean;
    isDeleting: boolean;
    isSelected: boolean;
    item: LibraryItem;
    onDelete: () => void;
    onToggle: () => void;
    selecting?: boolean;
    stremioLink: string | null;
    watchTime: string | null;
}

function LibraryListItem({
    item,
    isSelected,
    isDeleting,
    onToggle,
    onDelete,
    canDelete = true,
    selecting = false,
    stremioLink,
    watchTime,
}: LibraryListItemProps) {
    const [imageError, setImageError] = useState(false);

    return (
        <motion.div
            animate={{ opacity: 1, x: 0 }}
            aria-label={`${selecting ? "Select" : "Open"} ${item.name}`}
            aria-pressed={selecting ? isSelected : undefined}
            className={`flex cursor-pointer items-start gap-4 rounded-xl p-4 transition-colors ${isSelected ? "bd2-sel" : "bd-ok"}`}
            initial={{ opacity: 0, x: -20 }}
            onClick={onToggle}
            onKeyDown={(event) => {
                if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                ) {
                    event.preventDefault();
                    onToggle();
                }
            }}
            role="button"
            style={{
                background: "var(--color-surface)",
            }}
            tabIndex={0}
            whileHover={{ x: 4 }}
        >
            {/* Poster */}
            <div className="relative h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg">
                {item.poster && !imageError ? (
                    <img
                        alt={item.name}
                        className="h-full w-full object-cover"
                        onError={() => setImageError(true)}
                        src={item.poster}
                    />
                ) : (
                    <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ background: "var(--color-surface-elevated)" }}
                    >
                        {item.type === "movie" ? (
                            <FilmIcon
                                className="h-5 w-5"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                        ) : (
                            <TvIcon
                                className="h-5 w-5"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    {item.type === "movie" ? (
                        <FilmIcon
                            className="h-4 w-4 flex-shrink-0"
                            style={{ color: "var(--color-primary)" }}
                        />
                    ) : (
                        <TvIcon
                            className="h-4 w-4 flex-shrink-0"
                            style={{ color: "var(--color-secondary)" }}
                        />
                    )}
                    <span className="truncate font-medium" style={{ color: "var(--color-text)" }}>
                        {item.name}
                    </span>
                </div>

                {/* Watch time */}
                {watchTime && (
                    <div
                        className="mt-2 flex items-center gap-1 text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                    >
                        <ClockIcon className="h-3 w-3" />
                        <span>{watchTime}</span>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div
                className="flex flex-shrink-0 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
            >
                {stremioLink && (
                    <a
                        className="rounded-lg p-2 transition-colors"
                        href={stremioLink}
                        style={{
                            background: "var(--color-surface-elevated)",
                            color: "var(--color-text-muted)",
                        }}
                        title="Open"
                    >
                        <PlayIcon className="h-4 w-4" />
                    </a>
                )}
                {canDelete && (
                    <button
                        className="rounded-lg p-2 transition-all"
                        disabled={isDeleting}
                        onClick={() => onDelete()}
                        style={{
                            background: "var(--color-error-muted)",
                            color: "var(--color-error)",
                        }}
                        title="Delete"
                    >
                        {isDeleting ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                            <TrashIcon className="h-4 w-4" />
                        )}
                    </button>
                )}
            </div>

            {/* Selection indicator */}
            {isSelected && (
                <div
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--color-primary)" }}
                >
                    <CheckIcon className="h-4 w-4 text-white" />
                </div>
            )}
        </motion.div>
    );
}

// Get watch date from item (used for sorting)
function getWatchDate(item: LibraryItem): Date | null {
    const dates: number[] = [];
    if ((item as any)._mtime) {
        const d = new Date((item as any)._mtime).getTime();
        if (!Number.isNaN(d)) {
            dates.push(d);
        }
    }
    if (item.state?.lastWatched) {
        const d = new Date(item.state.lastWatched).getTime();
        if (!Number.isNaN(d)) {
            dates.push(d);
        }
    }
    if (dates.length === 0) {
        return null;
    }
    return new Date(Math.max(...dates)); // Most recent date
}

export default function UserLibraryPage() {
    const { userId, provider } = useUserAuth();
    const { authKey, isReady } = useUserAuthHeaders();
    // Nuvio's API has no library-removal capability - hide the delete
    // controls entirely for a Nuvio-provider user rather than show them and
    // fail (the server already guards this too, see publicLibrary.js's
    // DELETE /library/:itemId).
    const canDeleteLibraryItems = provider !== "nuvio";
    const [selecting, setSelecting] = useState(false);
    const [detailItem, setDetailItem] = useState<PosterCardItem | null>(null);
    const [library, setLibrary] = useState<LibraryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [isLoaded, setIsLoaded] = useState(false);
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

    // Load view mode preference
    useEffect(() => {
        const saved = localStorage.getItem("user-library-view-mode");
        if (saved === "list" || saved === "grid") {
            setViewMode(saved);
        }
        setIsLoaded(true);
    }, []);

    // Save view mode preference
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem("user-library-view-mode", viewMode);
        }
    }, [viewMode, isLoaded]);

    // Fetch library
    useEffect(() => {
        if (!(isReady && userId)) {
            return;
        }

        const fetchLibrary = async () => {
            setLoading(true);
            setError(null);
            try {
                const result = await userLibrary.getLibrary(userId, authKey || undefined);
                // Filter to only show items that are in the library (not removed)
                // !item.removed handles false, 0, null, undefined
                const activeItems = (result.library || []).filter((item: any) => !item.removed);
                setLibrary(activeItems);
            } catch (err: any) {
                console.error("Failed to load library:", err);
                setError(err.message || "Failed to load library");
            } finally {
                setLoading(false);
            }
        };

        fetchLibrary();
    }, [userId, authKey, isReady]);

    // Filter, search, and sort library (most recent first)
    const filteredLibrary = useMemo(() => {
        let filtered = library.filter((item) => {
            // Only show items with valid IDs (tt* format)
            const itemId = item._id;
            return typeof itemId === "string" && itemId.startsWith("tt");
        });

        if (search) {
            const searchLower = search.toLowerCase();
            filtered = filtered.filter((item) => item.name?.toLowerCase().includes(searchLower));
        }

        // Sort by watch date (most recent first)
        filtered.sort((a, b) => {
            const dateA = getWatchDate(a)?.getTime() || 0;
            const dateB = getWatchDate(b)?.getTime() || 0;
            return dateB - dateA;
        });

        return filtered;
    }, [library, search]);

    // Handle item selection
    const handleItemToggle = useCallback(
        (itemId: string) => {
            if (!(canDeleteLibraryItems && selecting)) {
                return;
            }
            setSelectedItems((prev) =>
                prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
            );
        },
        [canDeleteLibraryItems, selecting]
    );

    // Select/Deselect all
    const handleSelectAll = useCallback(() => {
        const allIds = filteredLibrary.map((item) => item._id).filter(Boolean);
        setSelectedItems(allIds);
    }, [filteredLibrary]);

    const handleDeselectAll = useCallback(() => {
        setSelectedItems([]);
    }, []);

    // Clear selection when search changes
    useEffect(() => {
        setSelectedItems([]);
    }, [search]);

    // Delete single item
    const handleDeleteItem = async (itemId: string) => {
        if (!userId || deletingIds.has(itemId)) {
            return;
        }

        setDeletingIds((prev) => new Set(prev).add(itemId));
        try {
            await userLibrary.deleteItem(userId, itemId, authKey || undefined);
            setLibrary((prev) => prev.filter((item) => item._id !== itemId));
            setSelectedItems((prev) => prev.filter((id) => id !== itemId));
        } catch (err: any) {
            setError(err.message || "Failed to delete item");
        } finally {
            setDeletingIds((prev) => {
                const next = new Set(prev);
                next.delete(itemId);
                return next;
            });
        }
    };

    // Delete selected items
    const handleDeleteSelected = async () => {
        if (!userId || selectedItems.length === 0) {
            return;
        }

        const toDelete = [...selectedItems];
        setDeletingIds(new Set(toDelete));

        try {
            await Promise.all(
                toDelete.map((itemId) =>
                    userLibrary.deleteItem(userId, itemId, authKey || undefined)
                )
            );
            setLibrary((prev) => prev.filter((item) => !toDelete.includes(item._id)));
            setSelectedItems([]);
        } catch (err: any) {
            setError(err.message || "Failed to delete items");
        } finally {
            setDeletingIds(new Set());
        }
    };

    // Open in the user's own provider app
    const getStremioLink = (item: LibraryItem): string | null => {
        const itemId = item._id;
        if (!itemId) {
            return null;
        }
        const type = item.type === "series" ? "series" : "movie";
        // Jellyfin apps share no link scheme to open a title with.
        if (provider === "jellyfin") {
            return null;
        }
        return provider === "nuvio"
            ? buildNuvioAppUrl(itemId, type)
            : buildStremioAppUrl(itemId, type);
    };

    return (
        <div className="p-4 sm:p-8">
            <UserPageHeader
                subtitle={`${filteredLibrary.length} items in your library`}
                title="My Library"
            />

            {/* Toolbar */}
            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 flex flex-col gap-4 sm:flex-row"
                initial={{ opacity: 0, y: 20 }}
            >
                {/* Search */}
                <div className="relative flex-1">
                    <MagnifyingGlassIcon
                        className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
                        style={{ color: "var(--color-text-muted)" }}
                    />
                    <input
                        aria-label="Search your library"
                        className="w-full rounded-xl py-2.5 pr-4 pl-10 text-sm"
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by title..."
                        style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                            color: "var(--color-text)",
                        }}
                        type="text"
                        value={search}
                    />
                </div>

                {/* Selection actions */}
                {selectedItems.length > 0 && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                            {selectedItems.length} selected
                        </span>
                        <button
                            className="rounded-lg px-3 py-2 font-medium text-sm"
                            onClick={handleDeselectAll}
                            style={{
                                background: "var(--color-surface)",
                                color: "var(--color-text-muted)",
                            }}
                        >
                            Clear
                        </button>
                        {canDeleteLibraryItems && (
                            <button
                                className="flex items-center gap-2 rounded-lg px-3 py-2 font-medium text-sm"
                                disabled={deletingIds.size > 0}
                                onClick={handleDeleteSelected}
                                style={{
                                    background: "var(--color-error)",
                                    color: "white",
                                }}
                            >
                                <TrashIcon className="h-4 w-4" />
                                Remove selected
                            </button>
                        )}
                    </div>
                )}

                {/* View toggle */}
                <ViewModeToggle mode={viewMode} onChange={(mode) => setViewMode(mode)} />
            </motion.div>

            {canDeleteLibraryItems && filteredLibrary.length > 0 && (
                <div className="mb-4">
                    <Button
                        onClick={() => {
                            setSelecting((value) => !value);
                            setSelectedItems([]);
                        }}
                        size="sm"
                        variant="secondary"
                    >
                        {selecting ? "Done selecting" : "Select to remove"}
                    </Button>
                </div>
            )}
            {detailItem && userId && authKey && (
                <PersonalMediaDetailModal
                    authKey={authKey}
                    item={detailItem}
                    key={detailItem.id}
                    onChange={unchangedLibrary}
                    onClose={() => setDetailItem(null)}
                    userId={userId}
                />
            )}

            {/* Select all / Deselect all - selection only exists to enable bulk
          delete above, which isn't available for Nuvio users */}
            {canDeleteLibraryItems && selecting && filteredLibrary.length > 0 && (
                <motion.div
                    animate={{ opacity: 1 }}
                    className="mb-4 flex items-center gap-4"
                    initial={{ opacity: 0 }}
                >
                    <button
                        className="font-medium text-sm transition-colors hover:opacity-80"
                        onClick={
                            selectedItems.length === filteredLibrary.length
                                ? handleDeselectAll
                                : handleSelectAll
                        }
                        style={{ color: "var(--color-primary)" }}
                    >
                        {selectedItems.length === filteredLibrary.length
                            ? "Clear selection"
                            : "Select all for removal"}
                    </button>
                    <p className="text-muted text-xs">
                        Select titles to remove them from your library and connected provider.
                    </p>
                </motion.div>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <div
                        className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
                        style={{
                            borderColor: "var(--color-primary)",
                            borderTopColor: "transparent",
                        }}
                    />
                </div>
            )}

            {/* Error */}
            {error && (
                <motion.div
                    animate={{ opacity: 1 }}
                    className="mb-6 rounded-xl p-4 text-center"
                    initial={{ opacity: 0 }}
                    style={{ background: "var(--color-error-muted)", color: "var(--color-error)" }}
                >
                    {error}
                </motion.div>
            )}

            {/* Empty state */}
            {!(loading || error) && filteredLibrary.length === 0 && (
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="py-20 text-center"
                    initial={{ opacity: 0, y: 20 }}
                >
                    <FilmIcon
                        className="mx-auto mb-4 h-16 w-16"
                        style={{ color: "var(--color-text-subtle)" }}
                    />
                    <h3
                        className="mb-2 font-semibold text-lg"
                        style={{ color: "var(--color-text)" }}
                    >
                        {search ? "No matching items" : "Your library is empty"}
                    </h3>
                    <p style={{ color: "var(--color-text-muted)" }}>
                        {search
                            ? "Try adjusting your search terms"
                            : "Start watching content on Stremio to see it here"}
                    </p>
                </motion.div>
            )}

            {/* Library - flat list, no date grouping */}
            {!(loading || error) &&
                filteredLibrary.length > 0 &&
                (viewMode === "grid" ? (
                    <div className="discovery-poster-grid">
                        <AnimatePresence mode="popLayout">
                            {filteredLibrary.map((item) => (
                                <LibraryCardItem
                                    canDelete={canDeleteLibraryItems}
                                    isDeleting={deletingIds.has(item._id)}
                                    isSelected={selectedItems.includes(item._id)}
                                    item={item}
                                    key={item._id}
                                    onDelete={() => handleDeleteItem(item._id)}
                                    onToggle={() =>
                                        selecting && canDeleteLibraryItems
                                            ? handleItemToggle(item._id)
                                            : setDetailItem({
                                                  id: item._id.split(":")[0],
                                                  name: item.name,
                                                  poster: item.poster || null,
                                                  type: item.type,
                                              })
                                    }
                                    selecting={selecting && canDeleteLibraryItems}
                                    stremioLink={getStremioLink(item)}
                                    watchTime={formatWatchTime(item.state?.overallTimeWatched)}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <AnimatePresence mode="popLayout">
                            {filteredLibrary.map((item) => (
                                <LibraryListItem
                                    canDelete={canDeleteLibraryItems}
                                    isDeleting={deletingIds.has(item._id)}
                                    isSelected={selectedItems.includes(item._id)}
                                    item={item}
                                    key={item._id}
                                    onDelete={() => handleDeleteItem(item._id)}
                                    onToggle={() =>
                                        selecting && canDeleteLibraryItems
                                            ? handleItemToggle(item._id)
                                            : setDetailItem({
                                                  id: item._id.split(":")[0],
                                                  name: item.name,
                                                  poster: item.poster || null,
                                                  type: item.type,
                                              })
                                    }
                                    selecting={selecting && canDeleteLibraryItems}
                                    stremioLink={getStremioLink(item)}
                                    watchTime={formatWatchTime(item.state?.overallTimeWatched)}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                ))}
        </div>
    );
}
