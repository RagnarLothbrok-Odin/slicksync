"use client";

import {
    EyeIcon,
    EyeSlashIcon,
    GlobeAltIcon,
    PuzzlePieceIcon,
    ShieldCheckIcon,
    ShieldExclamationIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { UserPageHeader } from "@/components/user/UserPageContainer";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { providerTypeLabel } from "@/lib/providers";
import { type GroupAddon, type StremioAddon, userAddons } from "@/lib/user-api";

type TabType = "group" | "stremio";

export default function UserAddonsPage() {
    const { userId, authKey, provider, isReady } = useUserAuthHeaders();
    const providerLabel = providerTypeLabel(provider);
    const [groupAddons, setGroupAddons] = useState<GroupAddon[]>([]);
    const [stremioAddons, setStremioAddons] = useState<StremioAddon[]>([]);
    const [excludedIds, setExcludedIds] = useState<string[]>([]);
    const [protectedNames, setProtectedNames] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>("group");
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Fetch addons
    useEffect(() => {
        if (!(isReady && userId) || provider === "jellyfin") {
            return;
        }

        const fetchAddons = async () => {
            setLoading(true);
            setError(null);
            try {
                const result = await userAddons.getAddons(userId, authKey || undefined);
                setGroupAddons(result.groupAddons || []);
                setStremioAddons(result.stremioAddons || []);
                setExcludedIds(result.excludedAddonIds || []);
                setProtectedNames(result.protectedAddonNames || []);
            } catch (err: any) {
                setError(err.message || "Failed to load addons");
            } finally {
                setLoading(false);
            }
        };

        fetchAddons();
    }, [userId, authKey, isReady, provider]);

    // Toggle exclude addon
    const handleToggleExclude = async (addonId: string, isExcluded: boolean) => {
        if (!userId || actionLoading) {
            return;
        }

        setActionLoading(addonId);
        try {
            if (isExcluded) {
                await userAddons.includeAddon(userId, addonId);
                setExcludedIds((prev) => prev.filter((id) => id !== addonId));
            } else {
                await userAddons.excludeAddon(userId, addonId);
                setExcludedIds((prev) => [...prev, addonId]);
            }
        } catch (err: any) {
            setError(err.message || "Failed to update addon");
        } finally {
            setActionLoading(null);
        }
    };

    // Toggle protect addon
    const handleToggleProtect = async (addonName: string, _isProtected: boolean) => {
        if (!userId || actionLoading) {
            return;
        }

        setActionLoading(addonName);
        try {
            const result = await userAddons.toggleProtect(userId, addonName);
            if (result.protected) {
                setProtectedNames((prev) => [...prev, addonName]);
            } else {
                setProtectedNames((prev) => prev.filter((n) => n !== addonName));
            }
        } catch (err: any) {
            setError(err.message || "Failed to update protection");
        } finally {
            setActionLoading(null);
        }
    };

    // Remove Stremio addon
    const handleRemoveAddon = async (addonName: string) => {
        if (!userId || actionLoading) {
            return;
        }

        if (!confirm(`Are you sure you want to remove "${addonName}"?`)) {
            return;
        }

        setActionLoading(addonName);
        try {
            await userAddons.removeAddon(userId, addonName);
            setStremioAddons((prev) => prev.filter((a) => a.manifest.name !== addonName));
        } catch (err: any) {
            setError(err.message || "Failed to remove addon");
        } finally {
            setActionLoading(null);
        }
    };

    // A Jellyfin-compatible server keeps no addon list SlickSync can manage.
    if (provider === "jellyfin") {
        return (
            <div className="p-4 sm:p-8">
                <UserPageHeader
                    subtitle="Your server has no addon list for SlickSync to manage"
                    title="Addons"
                />
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    What you watch on your server still shows up in your activity, library and
                    stats.
                </p>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-8">
            <UserPageHeader subtitle={`Manage your ${providerLabel} addons`} title="Addons" />

            {/* Tabs */}
            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 flex w-fit rounded-xl p-1"
                initial={{ opacity: 0, y: 20 }}
                style={{ background: "var(--color-surface)" }}
            >
                <button
                    className={`rounded-lg px-6 py-2.5 font-medium text-sm transition-all ${activeTab === "group" ? "seg-on" : "seg-off"}`}
                    onClick={() => setActiveTab("group")}
                >
                    Group Addons ({groupAddons.length})
                </button>
                <button
                    className={`rounded-lg px-6 py-2.5 font-medium text-sm transition-all ${activeTab === "stremio" ? "seg-on" : "seg-off"}`}
                    onClick={() => setActiveTab("stremio")}
                >
                    {providerLabel} Addons ({stremioAddons.length})
                </button>
            </motion.div>

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

            {/* Group Addons */}
            {!loading && activeTab === "group" && (
                <motion.div animate={{ opacity: 1 }} className="space-y-3" initial={{ opacity: 0 }}>
                    {groupAddons.length === 0 ? (
                        <div className="py-20 text-center">
                            <PuzzlePieceIcon
                                className="mx-auto mb-4 h-16 w-16"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                            <h3
                                className="mb-2 font-semibold text-lg"
                                style={{ color: "var(--color-text)" }}
                            >
                                No group addons
                            </h3>
                            <p style={{ color: "var(--color-text-muted)" }}>
                                Your group doesn't have any addons configured yet
                            </p>
                        </div>
                    ) : (
                        groupAddons.map((addon, index) => {
                            const isExcluded = excludedIds.includes(addon.id);
                            return (
                                <motion.div
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`flex items-center gap-4 rounded-xl p-4 ${isExcluded ? "bd-warn" : "bd-ok"}`}
                                    initial={{ opacity: 0, y: 20 }}
                                    key={addon.id}
                                    style={{
                                        background: "var(--color-surface)",
                                        opacity: isExcluded ? 0.7 : 1,
                                    }}
                                    transition={{ delay: index * 0.05 }}
                                >
                                    {/* Logo */}
                                    <div
                                        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
                                        style={{ background: "var(--color-surface-elevated)" }}
                                    >
                                        {addon.logo ? (
                                            <img
                                                alt={addon.name}
                                                className="h-8 w-8 object-contain"
                                                src={addon.logo}
                                            />
                                        ) : (
                                            <PuzzlePieceIcon
                                                className="h-6 w-6"
                                                style={{ color: "var(--color-text-muted)" }}
                                            />
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="min-w-0 flex-1">
                                        <h3
                                            className="font-semibold"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {addon.name}
                                        </h3>
                                        {addon.description && (
                                            <p
                                                className="truncate text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                {addon.description}
                                            </p>
                                        )}
                                    </div>

                                    {/* Status badges */}
                                    <div className="flex items-center gap-2">
                                        {addon.isProtected && (
                                            <div
                                                className="flex items-center gap-1 rounded px-2 py-1 font-medium text-xs"
                                                style={{
                                                    background: "var(--color-success-muted)",
                                                    color: "var(--color-success)",
                                                }}
                                            >
                                                <ShieldCheckIcon className="h-3.5 w-3.5" />
                                                Protected
                                            </div>
                                        )}
                                        {isExcluded && (
                                            <div
                                                className="flex items-center gap-1 rounded px-2 py-1 font-medium text-xs"
                                                style={{
                                                    background: "var(--color-warning-muted)",
                                                    color: "var(--color-warning)",
                                                }}
                                            >
                                                <EyeSlashIcon className="h-3.5 w-3.5" />
                                                Excluded
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <button
                                        className={`rounded-lg p-2 transition-all ${isExcluded ? "bg-success-muted" : "bg-warning-muted"}`}
                                        disabled={actionLoading === addon.id}
                                        onClick={() => handleToggleExclude(addon.id, isExcluded)}
                                        title={isExcluded ? "Include addon" : "Exclude addon"}
                                    >
                                        {actionLoading === addon.id ? (
                                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                        ) : isExcluded ? (
                                            <EyeIcon
                                                className="h-5 w-5"
                                                style={{ color: "var(--color-success)" }}
                                            />
                                        ) : (
                                            <EyeSlashIcon
                                                className="h-5 w-5"
                                                style={{ color: "var(--color-warning)" }}
                                            />
                                        )}
                                    </button>
                                </motion.div>
                            );
                        })
                    )}

                    {/* Info box */}
                    {groupAddons.length > 0 && (
                        <motion.div
                            animate={{ opacity: 1 }}
                            className="mt-6 rounded-xl p-4"
                            initial={{ opacity: 0 }}
                            style={{ background: "var(--color-primary-muted)" }}
                            transition={{ delay: 0.3 }}
                        >
                            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                                <strong style={{ color: "var(--color-text)" }}>Tip:</strong>{" "}
                                Excluded addons won't be synced to your {providerLabel} account. Use
                                this if you want to opt-out of specific group addons.
                            </p>
                        </motion.div>
                    )}
                </motion.div>
            )}

            {/* Provider Addons */}
            {!loading && activeTab === "stremio" && (
                <motion.div animate={{ opacity: 1 }} className="space-y-3" initial={{ opacity: 0 }}>
                    {stremioAddons.length === 0 ? (
                        <div className="py-20 text-center">
                            <GlobeAltIcon
                                className="mx-auto mb-4 h-16 w-16"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                            <h3
                                className="mb-2 font-semibold text-lg"
                                style={{ color: "var(--color-text)" }}
                            >
                                No {providerLabel} addons
                            </h3>
                            <p style={{ color: "var(--color-text-muted)" }}>
                                Addons installed in your {providerLabel} account will appear here
                            </p>
                        </div>
                    ) : (
                        stremioAddons.map((addon, index) => {
                            const isProtected = (protectedNames || []).includes(
                                addon.manifest?.name || ""
                            );
                            const isOfficial = addon.flags?.official;
                            return (
                                <motion.div
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex items-center gap-4 rounded-xl p-4"
                                    initial={{ opacity: 0, y: 20 }}
                                    key={addon.manifest.id}
                                    style={{
                                        background: "var(--color-surface)",
                                        border: "1px solid var(--color-surface-border)",
                                    }}
                                    transition={{ delay: index * 0.05 }}
                                >
                                    {/* Logo */}
                                    <div
                                        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
                                        style={{ background: "var(--color-surface-elevated)" }}
                                    >
                                        {addon.manifest.logo ? (
                                            <img
                                                alt={addon.manifest.name}
                                                className="h-8 w-8 object-contain"
                                                src={addon.manifest.logo}
                                            />
                                        ) : (
                                            <GlobeAltIcon
                                                className="h-6 w-6"
                                                style={{ color: "var(--color-text-muted)" }}
                                            />
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="min-w-0 flex-1">
                                        <h3
                                            className="font-semibold"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {addon.manifest.name}
                                        </h3>
                                        {addon.manifest.description && (
                                            <p
                                                className="truncate text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                {addon.manifest.description}
                                            </p>
                                        )}
                                        {addon.manifest.version && (
                                            <p
                                                className="mt-1 text-xs"
                                                style={{ color: "var(--color-text-subtle)" }}
                                            >
                                                v{addon.manifest.version}
                                            </p>
                                        )}
                                    </div>

                                    {/* Status badges */}
                                    <div className="flex items-center gap-2">
                                        {isOfficial && (
                                            <div
                                                className="rounded px-2 py-1 font-medium text-xs"
                                                style={{
                                                    background: "var(--color-primary-muted)",
                                                    color: "var(--color-primary)",
                                                }}
                                            >
                                                Official
                                            </div>
                                        )}
                                        {isProtected && (
                                            <div
                                                className="flex items-center gap-1 rounded px-2 py-1 font-medium text-xs"
                                                style={{
                                                    background: "var(--color-success-muted)",
                                                    color: "var(--color-success)",
                                                }}
                                            >
                                                <ShieldCheckIcon className="h-3.5 w-3.5" />
                                                Protected
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            className={`rounded-lg p-2 transition-all ${isProtected ? "bg-warning-muted" : "bg-success-muted"}`}
                                            disabled={actionLoading === addon.manifest.name}
                                            onClick={() =>
                                                handleToggleProtect(
                                                    addon.manifest.name,
                                                    isProtected
                                                )
                                            }
                                            title={
                                                isProtected ? "Remove protection" : "Protect addon"
                                            }
                                        >
                                            {actionLoading === addon.manifest.name ? (
                                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                            ) : isProtected ? (
                                                <ShieldExclamationIcon
                                                    className="h-5 w-5"
                                                    style={{ color: "var(--color-warning)" }}
                                                />
                                            ) : (
                                                <ShieldCheckIcon
                                                    className="h-5 w-5"
                                                    style={{ color: "var(--color-success)" }}
                                                />
                                            )}
                                        </button>

                                        {!(isProtected || isOfficial) && (
                                            <button
                                                className="rounded-lg p-2 transition-all"
                                                disabled={actionLoading === addon.manifest.name}
                                                onClick={() =>
                                                    handleRemoveAddon(addon.manifest.name)
                                                }
                                                style={{ background: "var(--color-error-muted)" }}
                                                title="Remove addon"
                                            >
                                                <TrashIcon
                                                    className="h-5 w-5"
                                                    style={{ color: "var(--color-error)" }}
                                                />
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })
                    )}

                    {/* Info box */}
                    {stremioAddons.length > 0 && (
                        <motion.div
                            animate={{ opacity: 1 }}
                            className="mt-6 rounded-xl p-4"
                            initial={{ opacity: 0 }}
                            style={{ background: "var(--color-primary-muted)" }}
                            transition={{ delay: 0.3 }}
                        >
                            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                                <strong style={{ color: "var(--color-text)" }}>Tip:</strong>{" "}
                                Protected addons won't be removed during sync. Use this to keep
                                personal addons that aren't part of your group.
                            </p>
                        </motion.div>
                    )}
                </motion.div>
            )}
        </div>
    );
}
