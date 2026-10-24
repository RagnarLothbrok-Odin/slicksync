"use client";

import {
    BookmarkIcon,
    CheckIcon,
    ChevronDownIcon,
    FilmIcon,
    FunnelIcon,
    InboxIcon,
    MagnifyingGlassIcon,
    PaperAirplaneIcon,
    PlayIcon,
    TrashIcon,
    TvIcon,
    UserGroupIcon,
} from "@heroicons/react/24/outline";
import {
    BookmarkIcon as BookmarkIconSolid,
    CheckIcon as CheckIconSolid,
} from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ViewModeToggle } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { UserPageHeader } from "@/components/user/UserPageContainer";
import { buildNuvioAppUrl, buildStremioAppUrl } from "@/lib/appLinks";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { type GroupMember, type Share, userLibrary, userShares } from "@/lib/user-api";

type TabType = "received" | "sent";
type ViewMode = "grid" | "list";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function UserSharesPage() {
    const { userId, userInfo, provider } = useUserAuth();
    const { authKey } = useUserAuthHeaders();
    const [sentShares, setSentShares] = useState<Share[]>([]);
    const [receivedShares, setReceivedShares] = useState<Share[]>([]);
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    const [libraryItemIds, setLibraryItemIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>("received");
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // New UI states
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [isLoaded, setIsLoaded] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedShares, setSelectedShares] = useState<Set<string>>(new Set());
    const [userFilter, setUserFilter] = useState<string>("all");
    const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);

    // Load view mode from localStorage
    useEffect(() => {
        const saved = localStorage.getItem("user-shares-view-mode");
        if (saved === "list" || saved === "grid") {
            setViewMode(saved as ViewMode);
        }
        setIsLoaded(true);
    }, []);

    // Save view mode to localStorage
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem("user-shares-view-mode", viewMode);
        }
    }, [viewMode, isLoaded]);

    // Fetch shares and library
    useEffect(() => {
        if (!userId) {
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const [sharesResult, membersResult, libraryResult] = await Promise.all([
                    userShares.getShares(userId, authKey || undefined),
                    userShares.getGroupMembers(userId, authKey || undefined),
                    userLibrary.getLibrary(userId, authKey || undefined),
                ]);
                setSentShares(sharesResult.sent || []);
                setReceivedShares(sharesResult.received || []);
                setGroupMembers((membersResult.members || []).filter((m) => m.id !== userId));

                // Build set of library item IDs for quick lookup
                const libraryIds = new Set<string>();
                (libraryResult.library || []).forEach((item: any) => {
                    const id = item._id || item.id;
                    if (id && item.removed !== true) {
                        libraryIds.add(id);
                        // Also add base ID (without episode info)
                        const baseId = id.split(":")[0];
                        if (baseId) {
                            libraryIds.add(baseId);
                        }
                    }
                });
                setLibraryItemIds(libraryIds);
            } catch (err: any) {
                setError(err.message || "Failed to load shares");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [userId, authKey]);

    // Get unique users for filter
    const filterUsers = useMemo(() => {
        const users = new Map<string, { username: string; colorIndex: number }>();
        receivedShares.forEach((s) => {
            if (s.fromUsername && !users.has(s.fromUsername)) {
                users.set(s.fromUsername, { colorIndex: 0, username: s.fromUsername });
            }
        });
        sentShares.forEach((s) => {
            if (s.toUsername && !users.has(s.toUsername)) {
                users.set(s.toUsername, { colorIndex: 0, username: s.toUsername });
            }
        });
        return Array.from(users.values()).sort((a, b) => a.username.localeCompare(b.username));
    }, [receivedShares, sentShares]);

    // Filtered shares
    const filteredReceived = useMemo(
        () =>
            receivedShares.filter((share) => {
                const matchesSearch =
                    !searchTerm || share.itemName.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesUser = userFilter === "all" || share.fromUsername === userFilter;
                return matchesSearch && matchesUser;
            }),
        [receivedShares, searchTerm, userFilter]
    );

    const filteredSent = useMemo(
        () =>
            sentShares.filter((share) => {
                const matchesSearch =
                    !searchTerm || share.itemName.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesUser = userFilter === "all" || share.toUsername === userFilter;
                return matchesSearch && matchesUser;
            }),
        [sentShares, searchTerm, userFilter]
    );

    // Check if item is in library
    const isInLibrary = (itemId: string) => {
        if (!itemId) {
            return false;
        }
        if (libraryItemIds.has(itemId)) {
            return true;
        }
        const baseId = itemId.split(":")[0];
        return baseId ? libraryItemIds.has(baseId) : false;
    };

    // Selection handlers
    const handleToggleSelect = (shareId: string) => {
        setSelectedShares((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(shareId)) {
                newSet.delete(shareId);
            } else {
                newSet.add(shareId);
            }
            return newSet;
        });
    };

    const handleSelectAll = () => {
        const currentShares = activeTab === "received" ? filteredReceived : filteredSent;
        setSelectedShares(new Set(currentShares.map((s) => s.id)));
    };

    const handleDeselectAll = () => {
        setSelectedShares(new Set());
    };

    // Mark as viewed
    const handleMarkViewed = async (shareId: string) => {
        if (!userId || actionLoading) {
            return;
        }

        setActionLoading(shareId);
        try {
            await userShares.markAsViewed(userId, shareId);
            setReceivedShares((prev) =>
                prev.map((s) =>
                    s.id === shareId ? { ...s, viewedAt: new Date().toISOString() } : s
                )
            );
            toast.success("Marked as viewed");
        } catch (err: any) {
            toast.error(err.message || "Failed to mark as viewed");
        } finally {
            setActionLoading(null);
        }
    };

    // Remove single share
    const handleRemoveShare = async (shareId: string, type: "sent" | "received") => {
        if (!userId || actionLoading) {
            return;
        }

        setActionLoading(shareId);
        try {
            await userShares.removeShare(userId, shareId);
            if (type === "sent") {
                setSentShares((prev) => prev.filter((s) => s.id !== shareId));
            } else {
                setReceivedShares((prev) => prev.filter((s) => s.id !== shareId));
            }
            selectedShares.delete(shareId);
            setSelectedShares(new Set(selectedShares));
            toast.success("Share removed");
        } catch (err: any) {
            toast.error(err.message || "Failed to remove share");
        } finally {
            setActionLoading(null);
        }
    };

    // Bulk delete
    const handleBulkDelete = async () => {
        if (!userId || selectedShares.size === 0) {
            return;
        }

        setActionLoading("bulk");
        try {
            await Promise.all(
                Array.from(selectedShares).map((shareId) => userShares.removeShare(userId, shareId))
            );
            setSentShares((prev) => prev.filter((s) => !selectedShares.has(s.id)));
            setReceivedShares((prev) => prev.filter((s) => !selectedShares.has(s.id)));
            toast.success(`${selectedShares.size} share(s) removed`);
            setSelectedShares(new Set());
        } catch (err: any) {
            toast.error(err.message || "Failed to delete shares");
        } finally {
            setActionLoading(null);
        }
    };

    // Add to library
    const handleAddToLibrary = async (share: Share) => {
        if (!userId) {
            return;
        }

        setActionLoading(share.id);
        try {
            const response = await fetch(`${API_BASE}/users/${userId}/toggle-library`, {
                body: JSON.stringify({
                    items: [
                        {
                            addToLibrary: true,
                            itemId: share.itemId,
                            itemName: share.itemName,
                            itemType: share.itemType || "movie",
                            poster: share.poster,
                        },
                    ],
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });

            if (!response.ok) {
                throw new Error("Failed to add to library");
            }

            // Update local state
            setLibraryItemIds((prev) => {
                const newSet = new Set(prev);
                newSet.add(share.itemId);
                return newSet;
            });
            toast.success(`Added "${share.itemName}" to library`);
        } catch (err: any) {
            toast.error(err.message || "Failed to add to library");
        } finally {
            setActionLoading(null);
        }
    };

    // Bulk add to library
    const handleBulkAddToLibrary = async () => {
        if (!userId || selectedShares.size === 0) {
            return;
        }

        const sharesToAdd = receivedShares.filter(
            (s) => selectedShares.has(s.id) && !isInLibrary(s.itemId)
        );

        if (sharesToAdd.length === 0) {
            toast.error("No shares to add (already in library or not received shares)");
            return;
        }

        setActionLoading("bulk");
        try {
            const response = await fetch(`${API_BASE}/users/${userId}/toggle-library`, {
                body: JSON.stringify({
                    items: sharesToAdd.map((share) => ({
                        addToLibrary: true,
                        itemId: share.itemId,
                        itemName: share.itemName,
                        itemType: share.itemType || "movie",
                        poster: share.poster,
                    })),
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });

            if (!response.ok) {
                throw new Error("Failed to add to library");
            }

            // Update local state
            setLibraryItemIds((prev) => {
                const newSet = new Set(prev);
                sharesToAdd.forEach((s) => newSet.add(s.itemId));
                return newSet;
            });
            toast.success(`${sharesToAdd.length} item(s) added to library`);
            setSelectedShares(new Set());
        } catch (err: any) {
            toast.error(err.message || "Failed to add to library");
        } finally {
            setActionLoading(null);
        }
    };

    // Format relative time
    const formatRelativeTime = (timestamp: string) => {
        const diff = Date.now() - new Date(timestamp).getTime();
        const minutes = Math.floor(diff / 60_000);
        const hours = Math.floor(diff / 3_600_000);
        const days = Math.floor(diff / 86_400_000);

        if (minutes < 1) {
            return "Just now";
        }
        if (minutes < 60) {
            return `${minutes}m ago`;
        }
        if (hours < 24) {
            return `${hours}h ago`;
        }
        if (days < 7) {
            return `${days}d ago`;
        }
        return new Date(timestamp).toLocaleDateString();
    };

    const unviewedCount = receivedShares.filter((s) => !s.viewedAt).length;
    const currentShares = activeTab === "received" ? filteredReceived : filteredSent;

    // Render share card (card view)
    const renderShareCard = (share: Share, type: "sent" | "received") => {
        const isSelected = selectedShares.has(share.id);
        const inLibrary = isInLibrary(share.itemId);
        const stremioLink =
            provider === "nuvio"
                ? buildNuvioAppUrl(share.itemId, share.itemType === "series" ? "series" : "movie")
                : buildStremioAppUrl(
                      share.itemId,
                      share.itemType === "series" ? "series" : "movie"
                  );

        return (
            <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className={`group relative cursor-pointer overflow-hidden rounded-xl ${isSelected ? "bd2-sel" : "bd2-off"}`}
                initial={{ opacity: 0, scale: 0.95 }}
                key={share.id}
                onClick={() => handleToggleSelect(share.id)}
                style={{
                    background: "var(--color-surface)",
                }}
            >
                {/* Selection indicator */}
                {isSelected && (
                    <div
                        className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full"
                        style={{ background: "var(--color-primary)" }}
                    >
                        <CheckIconSolid className="h-4 w-4 text-white" />
                    </div>
                )}

                {/* Poster */}
                <div className="relative aspect-[2/3] overflow-hidden">
                    {share.poster ? (
                        <img
                            alt={share.itemName}
                            className="h-full w-full object-cover"
                            src={share.poster}
                        />
                    ) : (
                        <div
                            className="flex h-full w-full items-center justify-center"
                            style={{ background: "var(--color-surface-elevated)" }}
                        >
                            {share.itemType === "series" ? (
                                <TvIcon
                                    className="h-12 w-12"
                                    style={{ color: "var(--color-text-subtle)" }}
                                />
                            ) : (
                                <FilmIcon
                                    className="h-12 w-12"
                                    style={{ color: "var(--color-text-subtle)" }}
                                />
                            )}
                        </div>
                    )}

                    {/* Stremio link overlay */}
                    <a
                        className="absolute top-2 left-2 rounded-full p-1.5 opacity-80 transition-opacity hover:opacity-100"
                        href={stremioLink}
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: "rgba(0,0,0,0.7)" }}
                        title="Open"
                    >
                        <PlayIcon className="h-4 w-4 text-white" />
                    </a>

                    {/* New badge */}
                    {type === "received" && !share.viewedAt && (
                        <div
                            className="absolute bottom-2 left-2 rounded px-2 py-0.5 font-medium text-xs"
                            style={{ background: "var(--color-primary)", color: "white" }}
                        >
                            New
                        </div>
                    )}

                    {/* Type badge */}
                    <div
                        className="absolute right-2 bottom-2 rounded px-2 py-0.5 font-medium text-xs"
                        style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
                    >
                        {share.itemType === "series" ? "Series" : "Movie"}
                    </div>
                </div>

                {/* Action buttons */}
                <div
                    className="flex items-center border-t"
                    onClick={(e) => e.stopPropagation()}
                    style={{ borderColor: "var(--color-surface-border)" }}
                >
                    <button
                        className={`flex flex-1 items-center justify-center py-2 transition-colors hover:bg-surface-hover ${inLibrary ? "text-primary" : "text-muted"}`}
                        disabled={actionLoading === share.id}
                        onClick={() => handleAddToLibrary(share)}
                        title={inLibrary ? "In library" : "Add to library"}
                    >
                        {inLibrary ? (
                            <BookmarkIconSolid className="h-4 w-4" />
                        ) : (
                            <BookmarkIcon className="h-4 w-4" />
                        )}
                    </button>
                    {type === "received" && !share.viewedAt && (
                        <button
                            className="flex flex-1 items-center justify-center py-2 transition-colors hover:bg-surface-hover"
                            disabled={actionLoading === share.id}
                            onClick={() => handleMarkViewed(share.id)}
                            style={{ color: "var(--color-success)" }}
                            title="Mark as viewed"
                        >
                            <CheckIcon className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        className="flex flex-1 items-center justify-center py-2 transition-colors hover:bg-surface-hover"
                        disabled={actionLoading === share.id}
                        onClick={() => handleRemoveShare(share.id, type)}
                        style={{ color: "var(--color-error)" }}
                        title="Remove"
                    >
                        <TrashIcon className="h-4 w-4" />
                    </button>
                </div>

                {/* Info */}
                <div className="p-2 text-center">
                    <p className="truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {type === "received" ? share.fromUsername : share.toUsername}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-text-subtle)" }}>
                        {formatRelativeTime(share.createdAt)}
                    </p>
                </div>
            </motion.div>
        );
    };

    // Render share row (list view)
    const renderShareRow = (share: Share, type: "sent" | "received") => {
        const isSelected = selectedShares.has(share.id);
        const inLibrary = isInLibrary(share.itemId);
        const stremioLink =
            provider === "nuvio"
                ? buildNuvioAppUrl(share.itemId, share.itemType === "series" ? "series" : "movie")
                : buildStremioAppUrl(
                      share.itemId,
                      share.itemType === "series" ? "series" : "movie"
                  );

        return (
            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className={`flex cursor-pointer items-center gap-4 rounded-xl p-3 ${isSelected ? "bd2-sel" : "bd2-off"}`}
                initial={{ opacity: 0, y: 10 }}
                key={share.id}
                onClick={() => handleToggleSelect(share.id)}
                style={{
                    background: "var(--color-surface)",
                }}
            >
                {/* Poster */}
                <div className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-lg">
                    {share.poster ? (
                        <img
                            alt={share.itemName}
                            className="h-full w-full object-cover"
                            src={share.poster}
                        />
                    ) : (
                        <div
                            className="flex h-full w-full items-center justify-center"
                            style={{ background: "var(--color-surface-elevated)" }}
                        >
                            {share.itemType === "series" ? (
                                <TvIcon
                                    className="h-6 w-6"
                                    style={{ color: "var(--color-text-subtle)" }}
                                />
                            ) : (
                                <FilmIcon
                                    className="h-6 w-6"
                                    style={{ color: "var(--color-text-subtle)" }}
                                />
                            )}
                        </div>
                    )}
                    <a
                        className="absolute top-1 right-1 rounded-full p-1"
                        href={stremioLink}
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: "rgba(0,0,0,0.7)" }}
                        title="Open"
                    >
                        <PlayIcon className="h-3 w-3 text-white" />
                    </a>
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                            {type === "received" ? "From" : "To"}
                        </span>
                        <span className="font-medium" style={{ color: "var(--color-text)" }}>
                            {type === "received" ? share.fromUsername : share.toUsername}
                        </span>
                        {type === "received" && !share.viewedAt && (
                            <span
                                className="rounded px-2 py-0.5 font-medium text-xs"
                                style={{
                                    background: "var(--color-primary-muted)",
                                    color: "var(--color-primary)",
                                }}
                            >
                                New
                            </span>
                        )}
                        {type === "sent" && share.viewedAt && (
                            <span
                                className="flex items-center gap-1 rounded px-2 py-0.5 font-medium text-xs"
                                style={{
                                    background: "var(--color-success-muted)",
                                    color: "var(--color-success)",
                                }}
                            >
                                <CheckIcon className="h-3 w-3" />
                                Viewed
                            </span>
                        )}
                    </div>
                    <h3 className="truncate font-semibold" style={{ color: "var(--color-text)" }}>
                        {share.itemName}
                    </h3>
                    <div className="mt-1 flex items-center gap-2">
                        <span
                            className="rounded px-1.5 py-0.5 text-xs"
                            style={{
                                background: "var(--color-surface-elevated)",
                                color: "var(--color-text-muted)",
                            }}
                        >
                            {share.itemType === "series" ? "Series" : "Movie"}
                        </span>
                        <span className="text-xs" style={{ color: "var(--color-text-subtle)" }}>
                            {formatRelativeTime(share.createdAt)}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                        className={`rounded-lg p-2 transition-colors ${inLibrary ? "text-primary" : "text-muted"}`}
                        disabled={actionLoading === share.id}
                        onClick={() => handleAddToLibrary(share)}
                        style={{
                            background: "var(--color-surface-elevated)",
                        }}
                        title={inLibrary ? "In library" : "Add to library"}
                    >
                        {inLibrary ? (
                            <BookmarkIconSolid className="h-5 w-5" />
                        ) : (
                            <BookmarkIcon className="h-5 w-5" />
                        )}
                    </button>
                    {type === "received" && !share.viewedAt && (
                        <button
                            className="rounded-lg p-2 transition-colors"
                            disabled={actionLoading === share.id}
                            onClick={() => handleMarkViewed(share.id)}
                            style={{
                                background: "var(--color-success-muted)",
                                color: "var(--color-success)",
                            }}
                            title="Mark as viewed"
                        >
                            <CheckIcon className="h-5 w-5" />
                        </button>
                    )}
                    <button
                        className="rounded-lg p-2 transition-colors"
                        disabled={actionLoading === share.id}
                        onClick={() => handleRemoveShare(share.id, type)}
                        style={{
                            background: "var(--color-error-muted)",
                            color: "var(--color-error)",
                        }}
                        title="Remove"
                    >
                        <TrashIcon className="h-5 w-5" />
                    </button>
                </div>

                {/* Selection indicator */}
                {isSelected && (
                    <div
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                        style={{ background: "var(--color-primary)" }}
                    >
                        <CheckIconSolid className="h-4 w-4 text-white" />
                    </div>
                )}
            </motion.div>
        );
    };

    return (
        <div className="p-4 sm:p-8">
            <UserPageHeader subtitle="Media shared with you and by you" title="Shares" />

            {/* Toolbar */}
            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 flex flex-wrap items-center gap-3"
                initial={{ opacity: 0, y: 20 }}
            >
                {/* Tabs */}
                <div className="flex rounded-xl p-1" style={{ background: "var(--color-surface)" }}>
                    <button
                        className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-sm transition-all ${activeTab === "received" ? "seg-on" : "seg-off"}`}
                        onClick={() => {
                            setActiveTab("received");
                            setSelectedShares(new Set());
                        }}
                    >
                        <InboxIcon className="h-4 w-4" />
                        Received
                        {unviewedCount > 0 && (
                            <span
                                className={`rounded-full px-1.5 py-0.5 font-bold text-xs ${activeTab === "received" ? "badge-flip" : "seg-on"}`}
                            >
                                {unviewedCount}
                            </span>
                        )}
                    </button>
                    <button
                        className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-sm transition-all ${activeTab === "sent" ? "seg-on" : "seg-off"}`}
                        onClick={() => {
                            setActiveTab("sent");
                            setSelectedShares(new Set());
                        }}
                    >
                        <PaperAirplaneIcon className="h-4 w-4" />
                        Sent ({sentShares.length})
                    </button>
                </div>

                {/* Search */}
                <div
                    className="flex min-w-48 flex-1 items-center gap-2 rounded-lg px-3 py-2"
                    style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-surface-border)",
                    }}
                >
                    <MagnifyingGlassIcon
                        className="h-4 w-4"
                        style={{ color: "var(--color-text-muted)" }}
                    />
                    <input
                        className="flex-1 bg-transparent text-sm outline-none"
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search by title..."
                        style={{ color: "var(--color-text)" }}
                        type="text"
                        value={searchTerm}
                    />
                </div>

                {/* User Filter */}
                {filterUsers.length > 0 && (
                    <div className="relative">
                        <button
                            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                            onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                            style={{
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                        >
                            <FunnelIcon className="h-4 w-4" />
                            {userFilter === "all" ? "All Users" : userFilter}
                            <ChevronDownIcon className="h-4 w-4" />
                        </button>
                        {isFilterDropdownOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setIsFilterDropdownOpen(false)}
                                />
                                <div
                                    className="absolute top-full right-0 z-20 mt-1 min-w-40 rounded-lg py-1 shadow-lg"
                                    style={{
                                        background: "var(--color-surface)",
                                        border: "1px solid var(--color-surface-border)",
                                    }}
                                >
                                    <button
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover"
                                        onClick={() => {
                                            setUserFilter("all");
                                            setIsFilterDropdownOpen(false);
                                        }}
                                        style={{
                                            color:
                                                userFilter === "all"
                                                    ? "var(--color-primary)"
                                                    : "var(--color-text)",
                                        }}
                                    >
                                        All Users
                                    </button>
                                    {filterUsers.map((user) => (
                                        <button
                                            className="w-full px-4 py-2 text-left text-sm hover:bg-surface-hover"
                                            key={user.username}
                                            onClick={() => {
                                                setUserFilter(user.username);
                                                setIsFilterDropdownOpen(false);
                                            }}
                                            style={{
                                                color:
                                                    userFilter === user.username
                                                        ? "var(--color-primary)"
                                                        : "var(--color-text)",
                                            }}
                                        >
                                            {user.username}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* View Mode Toggle */}
                <ViewModeToggle mode={viewMode} onChange={(mode) => setViewMode(mode)} />
            </motion.div>

            {/* Selection Bar */}
            {selectedShares.size > 0 && (
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 flex items-center gap-3 rounded-xl p-3"
                    initial={{ opacity: 0, y: -10 }}
                    style={{ background: "var(--color-primary-muted)" }}
                >
                    <span className="font-medium text-sm" style={{ color: "var(--color-text)" }}>
                        {selectedShares.size} selected
                    </span>
                    <button
                        className="text-sm underline"
                        onClick={handleSelectAll}
                        style={{ color: "var(--color-primary)" }}
                    >
                        Select All
                    </button>
                    <button
                        className="text-sm underline"
                        onClick={handleDeselectAll}
                        style={{ color: "var(--color-text-muted)" }}
                    >
                        Deselect All
                    </button>
                    <div className="flex-1" />
                    {activeTab === "received" && (
                        <button
                            className="flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-sm"
                            disabled={actionLoading === "bulk"}
                            onClick={handleBulkAddToLibrary}
                            style={{ background: "var(--color-primary)", color: "white" }}
                        >
                            <BookmarkIcon className="h-4 w-4" />
                            Add to Library
                        </button>
                    )}
                    <button
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-sm"
                        disabled={actionLoading === "bulk"}
                        onClick={handleBulkDelete}
                        style={{ background: "var(--color-error)", color: "white" }}
                    >
                        <TrashIcon className="h-4 w-4" />
                        Delete
                    </button>
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
                    className="mb-6 rounded-xl p-4"
                    initial={{ opacity: 0 }}
                    style={{ background: "var(--color-error-muted)", color: "var(--color-error)" }}
                >
                    {error}
                    <button
                        className="ml-2 underline hover:no-underline"
                        onClick={() => setError(null)}
                    >
                        Dismiss
                    </button>
                </motion.div>
            )}

            {/* Content */}
            {!loading && (
                <AnimatePresence mode="wait">
                    {currentShares.length === 0 ? (
                        <motion.div
                            animate={{ opacity: 1 }}
                            className="py-20 text-center"
                            exit={{ opacity: 0 }}
                            initial={{ opacity: 0 }}
                            key="empty"
                        >
                            {activeTab === "received" ? (
                                <InboxIcon
                                    className="mx-auto mb-4 h-16 w-16"
                                    style={{ color: "var(--color-text-subtle)" }}
                                />
                            ) : (
                                <PaperAirplaneIcon
                                    className="mx-auto mb-4 h-16 w-16"
                                    style={{ color: "var(--color-text-subtle)" }}
                                />
                            )}
                            <h3
                                className="mb-2 font-semibold text-lg"
                                style={{ color: "var(--color-text)" }}
                            >
                                {searchTerm || userFilter !== "all"
                                    ? "No matches found"
                                    : activeTab === "received"
                                      ? "No shared media"
                                      : "No sent shares"}
                            </h3>
                            <p style={{ color: "var(--color-text-muted)" }}>
                                {searchTerm || userFilter !== "all"
                                    ? "Try adjusting your search or filter"
                                    : activeTab === "received"
                                      ? "When someone shares media with you, it will appear here"
                                      : "Share media from your library to recommend to others"}
                            </p>
                        </motion.div>
                    ) : viewMode === "grid" ? (
                        <motion.div
                            animate={{ opacity: 1 }}
                            className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
                            exit={{ opacity: 0 }}
                            initial={{ opacity: 0 }}
                            key="card-grid"
                        >
                            {currentShares.map((share) => renderShareCard(share, activeTab))}
                        </motion.div>
                    ) : (
                        <motion.div
                            animate={{ opacity: 1 }}
                            className="space-y-3"
                            exit={{ opacity: 0 }}
                            initial={{ opacity: 0 }}
                            key="list"
                        >
                            {currentShares.map((share) => renderShareRow(share, activeTab))}
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {/* Group Members Info */}
            {!loading && groupMembers.length > 0 && (
                <motion.div
                    animate={{ opacity: 1 }}
                    className="mt-8 rounded-xl p-4"
                    initial={{ opacity: 0 }}
                    style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-surface-border)",
                    }}
                    transition={{ delay: 0.3 }}
                >
                    <div className="mb-3 flex items-center gap-2">
                        <UserGroupIcon
                            className="h-5 w-5"
                            style={{ color: "var(--color-text-muted)" }}
                        />
                        <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>
                            Group Members ({groupMembers.length})
                        </h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {groupMembers.map((member) => (
                            <div
                                className="flex items-center gap-2 rounded-full px-3 py-1.5"
                                key={member.id}
                                style={{ background: "var(--color-surface-elevated)" }}
                            >
                                <div
                                    className="flex h-6 w-6 items-center justify-center rounded-full font-medium text-white text-xs"
                                    style={{
                                        background: `hsl(${(member.colorIndex || 0) * 60}, 70%, 50%)`,
                                    }}
                                >
                                    {member.username.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm" style={{ color: "var(--color-text)" }}>
                                    {member.username}
                                </span>
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}
