"use client";

import { CircleStackIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Badge,
    Button,
    Card,
    ConfirmModal,
    Input,
    SelectAllCheckbox,
    SelectionCheckbox,
    SlickSyncLogo,
    ToggleSwitch,
} from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { readErrorMessage } from "@/lib/errors";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

// An account counts as "abandoned" once it's been sitting empty (no users,
// groups, or addons set up) and untouched (never logged in past the initial
// registration) for a while - long enough that it's very unlikely someone's
// still mid-setup. Not "email" - that field isn't fetched at all anymore
// (see the server route's own comment on why).
const ABANDONED_AGE_MS = 24 * 60 * 60 * 1000;

interface SuperAdminAccount {
    addonCount: number;
    createdAt: string;
    disabled: boolean;
    // Self-service nickname the account holder set themselves in their own
    // Settings - read-only here, purely so accounts are easier to tell apart
    // than by raw UUID prefix. Superadmin never sets or edits this.
    displayName: string | null;
    groupCount: number;
    id: string;
    lastLoginAt: string | null;
    // Row count across key account-scoped tables (users/groups/addons/
    // catalogs/watch sessions/vault entries) - a proxy for "how much data
    // does this account hold" for spotting heavy vs. empty accounts. Not a
    // byte-accurate size - public mode is one shared Postgres database, not
    // a file per account, so there's no real per-account disk size to report.
    resourceRowCount: number;
    userCount: number;
    uuid: string | null;
}

interface AuditLogEntry {
    action: "disable" | "enable" | "delete";
    bulk: boolean;
    createdAt: string;
    id: string;
    targetAccountId: string;
    targetAccountUuid: string | null;
}

type SortKey = "createdAt" | "lastLoginAt" | "resourceRowCount";

interface MaintenanceState {
    settings?: {
        vacuumEnabled: boolean;
        lastVacuumAt: string | null;
    };
    supported: boolean;
}

function isAbandoned(a: SuperAdminAccount): boolean {
    if (a.lastLoginAt) {
        return false;
    }
    if (a.userCount > 0 || a.groupCount > 0 || a.addonCount > 0) {
        return false;
    }
    return Date.now() - new Date(a.createdAt).getTime() > ABANDONED_AGE_MS;
}

const NEW_ACCOUNT_AGE_MS = 48 * 60 * 60 * 1000;
function isRecentlyRegistered(a: SuperAdminAccount): boolean {
    return Date.now() - new Date(a.createdAt).getTime() < NEW_ACCOUNT_AGE_MS;
}

// Resource quota alerting - flags an account whose resourceRowCount (the
// same usage proxy the "Heaviest usage first" sort already uses) crosses a
// superadmin-set threshold. There's no AppAccount for superadmin itself to
// store a setting on (it's a single shared password, not a tenant), and no
// push-notification identity to deliver an alert to either - so this lives
// as a live-computed, in-panel indicator (mirroring the existing
// "abandoned" pattern exactly: a summary count + quick-select) rather than
// a push/bell notification, which this instance's notification pipeline has
// no way to address to "the superadmin" specifically.
const QUOTA_THRESHOLD_STORAGE_KEY = "slicksync:superadmin:quotaThreshold";
const DEFAULT_QUOTA_THRESHOLD = 500;
function isOverQuota(a: SuperAdminAccount, threshold: number): boolean {
    return threshold > 0 && a.resourceRowCount >= threshold;
}

// Cumulative registrations by day, straight from each account's own
// createdAt - no new tracking/table needed, this is real data already on
// every row fetched for the list above it. Aggregate-only (a count per day),
// same privacy boundary as the rest of this page.
function buildGrowthSeries(
    accounts: SuperAdminAccount[],
    days: number
): { date: string; count: number }[] {
    const now = new Date();
    const buckets: { date: string; day: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        buckets.push({
            date: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
            day: d.getTime(),
        });
    }
    const dayMs = 24 * 60 * 60 * 1000;
    return buckets.map((b) => ({
        count: accounts.filter((a) => new Date(a.createdAt).getTime() < b.day + dayMs).length,
        date: b.date,
    }));
}

function GrowthSparkline({ series }: { series: { date: string; count: number }[] }) {
    if (series.length < 2) {
        return null;
    }
    const width = 100;
    const height = 32;
    const max = Math.max(...series.map((s) => s.count), 1);
    const min = Math.min(...series.map((s) => s.count));
    const range = Math.max(max - min, 1);
    const points = series.map((s, i) => {
        const x = (i / (series.length - 1)) * width;
        const y = height - ((s.count - min) / range) * (height - 4) - 2;
        return `${x},${y}`;
    });
    const last = series.at(-1);
    if (!last) {
        return null;
    }
    const first = series[0];
    const delta = last.count - first.count;
    return (
        <div className="flex items-center gap-3">
            <svg
                className="h-8 w-24 overflow-visible"
                preserveAspectRatio="none"
                viewBox={`0 0 ${width} ${height}`}
            >
                <polyline
                    fill="none"
                    points={points.join(" ")}
                    stroke="var(--color-primary)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                />
                <circle
                    cx={width}
                    cy={height - ((last.count - min) / range) * (height - 4) - 2}
                    fill="var(--color-primary)"
                    r="2.5"
                />
            </svg>
            <div>
                <p className="font-semibold text-default text-sm">
                    {last.count} <span className="font-normal text-muted text-xs">total</span>
                </p>
                <p className="text-subtle text-xs">
                    {delta >= 0 ? "+" : ""}
                    {delta} in {series.length}d
                </p>
            </div>
        </div>
    );
}

// Operator-only cross-account panel for public multi-tenant mode. Deliberately
// its own route with its own auth (a separate sfm_superadmin cookie, never an
// account login) - see server/routes/superadmin.js for the full reasoning.
// This page never requests or displays anything from inside a tenant's own
// data (their addons, Vault, watch history) - only whether the account
// exists, when it registered/last logged in, and coarse counts.
export default function SuperAdminPage() {
    const [signedIn, setSignedIn] = useState<boolean | null>(null);
    const [password, setPassword] = useState("");
    const [signingIn, setSigningIn] = useState(false);
    const [accounts, setAccounts] = useState<SuperAdminAccount[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<SuperAdminAccount | null>(null);
    const [search, setSearch] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
    const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
    const [showAuditLog, setShowAuditLog] = useState(false);
    const [loadingAuditLog, setLoadingAuditLog] = useState(false);
    const [sortBy, setSortBy] = useState<SortKey>("createdAt");
    // Lazy-init from localStorage (client-only, safe here since this whole
    // page is 'use client' and this runs during render on first mount, not SSR).
    const [quotaThreshold, setQuotaThreshold] = useState<number>(() => {
        if (typeof window === "undefined") {
            return DEFAULT_QUOTA_THRESHOLD;
        }
        const stored = Number(window.localStorage.getItem(QUOTA_THRESHOLD_STORAGE_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_QUOTA_THRESHOLD;
    });
    const updateQuotaThreshold = (value: number) => {
        setQuotaThreshold(value);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(QUOTA_THRESHOLD_STORAGE_KEY, String(value));
        }
    };

    const filteredAccounts = useMemo(() => {
        const q = search.trim().toLowerCase();
        const base = q
            ? accounts.filter(
                  (a) =>
                      (a.uuid || a.id).toLowerCase().includes(q) ||
                      (a.displayName || "").toLowerCase().includes(q)
              )
            : accounts;
        const sorted = [...base];
        if (sortBy === "resourceRowCount") {
            sorted.sort((a, b) => b.resourceRowCount - a.resourceRowCount);
        } else if (sortBy === "lastLoginAt") {
            // Never-logged-in accounts sort last, not first (as they would with a
            // naive null-as-epoch-0 comparison) - "most recently active" is the
            // useful ordering here, and "never" isn't recent.
            sorted.sort((a, b) => {
                if (!(a.lastLoginAt || b.lastLoginAt)) {
                    return 0;
                }
                if (!a.lastLoginAt) {
                    return 1;
                }
                if (!b.lastLoginAt) {
                    return -1;
                }
                return new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime();
            });
        } else {
            sorted.sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        }
        return sorted;
    }, [accounts, search, sortBy]);

    const growthSeries = useMemo(() => buildGrowthSeries(accounts, 30), [accounts]);
    const recentCount = useMemo(() => accounts.filter(isRecentlyRegistered).length, [accounts]);

    // Health summary - counts over ALL accounts, not just the filtered view,
    // so it reads as a stable overview regardless of what's currently searched.
    const summary = useMemo(
        () => ({
            abandoned: accounts.filter(isAbandoned).length,
            active: accounts.filter((a) => !a.disabled).length,
            disabled: accounts.filter((a) => a.disabled).length,
            neverLoggedIn: accounts.filter((a) => !a.lastLoginAt).length,
            overQuota: accounts.filter((a) => isOverQuota(a, quotaThreshold)).length,
        }),
        [accounts, quotaThreshold]
    );

    const loadAccounts = useCallback(async () => {
        setLoadingAccounts(true);
        try {
            const res = await fetch(`${API_BASE}/superadmin/accounts`, { credentials: "include" });
            if (!res.ok) {
                throw new Error("Failed to load accounts");
            }
            const data = await res.json();
            setAccounts(data.accounts || []);
        } catch {
            toast.error("Failed to load accounts");
        } finally {
            setLoadingAccounts(false);
        }
    }, []);

    const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
    const [loadingMaintenance, setLoadingMaintenance] = useState(true);
    const [vacuumBusy, setVacuumBusy] = useState(false);
    const [savingMaintenanceSetting, setSavingMaintenanceSetting] = useState(false);

    const loadMaintenance = useCallback(async () => {
        setLoadingMaintenance(true);
        try {
            const res = await fetch(`${API_BASE}/superadmin/db-maintenance`, {
                credentials: "include",
            });
            if (!res.ok) {
                throw new Error("Failed");
            }
            const data = await res.json();
            setMaintenance(data);
        } catch {
            // Best-effort - the card just renders nothing (see !maintenance?.supported below)
        } finally {
            setLoadingMaintenance(false);
        }
    }, []);

    const updateMaintenanceSetting = async (patch: { vacuumEnabled?: boolean }) => {
        setSavingMaintenanceSetting(true);
        try {
            const res = await fetch(`${API_BASE}/superadmin/db-maintenance`, {
                body: JSON.stringify(patch),
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                method: "PUT",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || "Failed to save");
            }
            await loadMaintenance();
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to save setting"));
        } finally {
            setSavingMaintenanceSetting(false);
        }
    };

    const handleRunVacuum = async () => {
        setVacuumBusy(true);
        try {
            const res = await fetch(`${API_BASE}/superadmin/db-maintenance/vacuum`, {
                credentials: "include",
                method: "POST",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || "VACUUM failed");
            }
            toast.success("VACUUM completed - disk space reclaimed");
            await loadMaintenance();
        } catch (e) {
            toast.error(readErrorMessage(e, "VACUUM failed"));
        } finally {
            setVacuumBusy(false);
        }
    };

    useEffect(() => {
        fetch(`${API_BASE}/superadmin/session`, { credentials: "include" })
            .then((res) => {
                setSignedIn(res.ok);
                if (res.ok) {
                    loadAccounts();
                    loadMaintenance();
                }
            })
            .catch(() => setSignedIn(false));
    }, [loadAccounts, loadMaintenance]);

    // Lazy-loaded on first expand, not on page load - this is a secondary,
    // occasionally-checked view, no reason to pay for it on every visit.
    const loadAuditLog = useCallback(async () => {
        setLoadingAuditLog(true);
        try {
            const res = await fetch(`${API_BASE}/superadmin/audit-log`, { credentials: "include" });
            if (!res.ok) {
                throw new Error("Failed to load audit log");
            }
            const data = await res.json();
            setAuditLog(data.entries || []);
        } catch {
            toast.error("Failed to load audit log");
        } finally {
            setLoadingAuditLog(false);
        }
    }, []);

    const toggleAuditLog = () => {
        const next = !showAuditLog;
        setShowAuditLog(next);
        if (next && auditLog.length === 0) {
            loadAuditLog();
        }
    };

    const handleLogin = async () => {
        if (!password.trim()) {
            return;
        }
        setSigningIn(true);
        try {
            const res = await fetch(`${API_BASE}/superadmin/login`, {
                body: JSON.stringify({ password }),
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || "Login failed");
            }
            setSignedIn(true);
            setPassword("");
            loadAccounts();
        } catch (e) {
            toast.error(readErrorMessage(e, "Login failed"));
        } finally {
            setSigningIn(false);
        }
    };

    const handleLogout = async () => {
        await fetch(`${API_BASE}/superadmin/logout`, {
            credentials: "include",
            method: "POST",
        }).catch(() => undefined);
        setSignedIn(false);
        setAccounts([]);
    };

    const handleToggleDisabled = async (account: SuperAdminAccount, confirmed = false) => {
        setBusyId(account.id);
        try {
            const url = `${API_BASE}/superadmin/accounts/${account.id}/${account.disabled ? "enable" : "disable"}${confirmed ? "?confirm=true" : ""}`;
            const res = await fetch(url, { credentials: "include", method: "POST" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                if (res.status === 409 && data.requiresConfirmation) {
                    if (
                        window.confirm(
                            data.message || "This is the last enabled account. Disable it anyway?"
                        )
                    ) {
                        return await handleToggleDisabled(account, true);
                    }
                    return;
                }
                throw new Error(data.message || "Failed");
            }
            setAccounts((prev) =>
                prev.map((a) => (a.id === account.id ? { ...a, disabled: !a.disabled } : a))
            );
            toast.success(account.disabled ? "Account re-enabled" : "Account disabled");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to update account"));
        } finally {
            setBusyId(null);
        }
    };

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const selectAbandoned = () => {
        setSelectedIds(new Set(filteredAccounts.filter(isAbandoned).map((a) => a.id)));
    };

    const selectOverQuota = () => {
        setSelectedIds(
            new Set(filteredAccounts.filter((a) => isOverQuota(a, quotaThreshold)).map((a) => a.id))
        );
    };

    const handleBulkToggleDisabled = async (disable: boolean, confirmed = false) => {
        if (selectedIds.size === 0) {
            return;
        }
        setBulkBusy(true);
        try {
            const ids = Array.from(selectedIds);
            const url = `${API_BASE}/superadmin/accounts/bulk-${disable ? "disable" : "enable"}${confirmed ? "?confirm=true" : ""}`;
            const res = await fetch(url, {
                body: JSON.stringify({ ids }),
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                if (res.status === 409 && data.requiresConfirmation) {
                    if (
                        window.confirm(
                            data.message ||
                                "This would disable every enabled account. Proceed anyway?"
                        )
                    ) {
                        return await handleBulkToggleDisabled(disable, true);
                    }
                    return;
                }
                throw new Error(data.message || "Failed");
            }
            setAccounts((prev) =>
                prev.map((a) => (selectedIds.has(a.id) ? { ...a, disabled: disable } : a))
            );
            toast.success(
                `${ids.length} account${ids.length === 1 ? "" : "s"} ${disable ? "disabled" : "re-enabled"}`
            );
            setSelectedIds(new Set());
        } catch (e) {
            toast.error(readErrorMessage(e, "Bulk update failed"));
        } finally {
            setBulkBusy(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) {
            return;
        }
        setBulkBusy(true);
        try {
            const ids = Array.from(selectedIds);
            const res = await fetch(`${API_BASE}/superadmin/accounts/bulk-delete`, {
                body: JSON.stringify({ ids }),
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            if (!res.ok) {
                throw new Error("Failed");
            }
            const data = await res.json();
            setAccounts((prev) =>
                prev.filter((a) => !selectedIds.has(a.id) || data.failed?.includes(a.id))
            );
            if (data.deleted > 0) {
                toast.success(`${data.deleted} account${data.deleted === 1 ? "" : "s"} deleted`);
            }
            if (data.failed?.length > 0) {
                toast.error(
                    `${data.failed.length} account${data.failed.length === 1 ? "" : "s"} failed to delete`
                );
            }
            setSelectedIds(new Set());
            setConfirmBulkDelete(false);
        } catch {
            toast.error("Bulk delete failed");
        } finally {
            setBulkBusy(false);
        }
    };

    const [showBroadcast, setShowBroadcast] = useState(false);
    const [broadcastTitle, setBroadcastTitle] = useState("");
    const [broadcastBody, setBroadcastBody] = useState("");
    const [broadcastTarget, setBroadcastTarget] = useState<"all" | "selected">("all");
    const [broadcasting, setBroadcasting] = useState(false);

    const handleBroadcast = async () => {
        const title = broadcastTitle.trim();
        if (!title || broadcasting) {
            return;
        }
        setBroadcasting(true);
        try {
            const body: { title: string; body: string; all?: boolean; ids?: string[] } = {
                body: broadcastBody.trim(),
                title,
            };
            if (broadcastTarget === "selected" && selectedIds.size > 0) {
                body.ids = Array.from(selectedIds);
            } else {
                body.all = true;
            }
            const res = await fetch(`${API_BASE}/superadmin/accounts/broadcast`, {
                body: JSON.stringify(body),
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || "Failed to send");
            }
            toast.success(`Notified ${data.notified} account${data.notified === 1 ? "" : "s"}`);
            setShowBroadcast(false);
            setBroadcastTitle("");
            setBroadcastBody("");
        } catch (e) {
            toast.error(readErrorMessage(e, "Broadcast failed"));
        } finally {
            setBroadcasting(false);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) {
            return;
        }
        setBusyId(confirmDelete.id);
        try {
            const res = await fetch(`${API_BASE}/superadmin/accounts/${confirmDelete.id}`, {
                credentials: "include",
                method: "DELETE",
            });
            if (!res.ok) {
                throw new Error("Failed");
            }
            setAccounts((prev) => prev.filter((a) => a.id !== confirmDelete.id));
            toast.success("Account deleted");
            setConfirmDelete(null);
        } catch {
            toast.error("Failed to delete account");
        } finally {
            setBusyId(null);
        }
    };

    if (signedIn === null) {
        return (
            <div className="flex min-h-screen items-center justify-center text-muted text-sm">
                Loading…
            </div>
        );
    }

    if (!signedIn) {
        return (
            <div className="flex min-h-screen items-center justify-center p-4">
                <Card className="w-full max-w-sm" padding="lg">
                    <div className="mb-6 flex flex-col items-center">
                        <SlickSyncLogo className="mb-3 h-10 w-10" />
                        <h1 className="font-semibold text-default text-lg">Superadmin</h1>
                        <p className="mt-1 text-center text-muted text-xs">
                            Operator access only — not a tenant account login.
                        </p>
                    </div>
                    <div className="space-y-3">
                        <Input
                            autoFocus
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    handleLogin();
                                }
                            }}
                            placeholder="Operator password"
                            type="password"
                            value={password}
                        />
                        <Button
                            className="w-full"
                            isLoading={signingIn}
                            onClick={handleLogin}
                            variant="primary"
                        >
                            Sign in
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-6 md:p-10">
            <div className="mx-auto max-w-5xl">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="font-semibold text-default text-xl">Superadmin</h1>
                        <p className="text-muted text-sm">
                            {accounts.length} registered account{accounts.length === 1 ? "" : "s"}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            isLoading={loadingAccounts}
                            onClick={loadAccounts}
                            size="sm"
                            variant="ghost"
                        >
                            Refresh
                        </Button>
                        <Button onClick={handleLogout} size="sm" variant="ghost">
                            Sign out
                        </Button>
                    </div>
                </div>

                {/* Health summary - counts only, same privacy boundary as everything
            else on this page (nothing from inside a tenant's own data). */}
                {accounts.length > 0 && (
                    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <Card padding="md">
                            <p className="mb-2 text-muted text-xs">Growth (30d)</p>
                            <GrowthSparkline series={growthSeries} />
                        </Card>
                        <Card padding="md">
                            <p className="mb-1 text-muted text-xs">Active</p>
                            <p className="font-semibold text-2xl text-default">{summary.active}</p>
                        </Card>
                        <Card padding="md">
                            <p className="mb-1 text-muted text-xs">Disabled</p>
                            <p className="font-semibold text-2xl text-default">
                                {summary.disabled}
                            </p>
                        </Card>
                        <Card padding="md">
                            <p className="mb-1 text-muted text-xs">New (48h)</p>
                            <p
                                className={`font-semibold text-2xl ${recentCount > 0 ? "text-primary" : "text-default"}`}
                            >
                                {recentCount}
                            </p>
                        </Card>
                    </div>
                )}

                {!loadingMaintenance && maintenance?.supported && maintenance.settings && (
                    <Card className="mb-4" padding="md">
                        <div className="mb-3 flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                                <CircleStackIcon className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-default text-sm">
                                    Database maintenance
                                </h3>
                                <p className="text-muted text-xs">
                                    Instance-level - one shared SQLite file, not per-account. Off by
                                    default.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-default border-t py-2.5">
                            <div>
                                <p className="text-default text-sm">Scheduled VACUUM</p>
                                <p className="text-muted text-xs">
                                    Reclaims disk space SQLite never auto-shrinks after deletes.
                                    Weekly, no data touched.
                                    {maintenance.settings.lastVacuumAt &&
                                        ` Last ran ${new Date(maintenance.settings.lastVacuumAt).toLocaleString()}.`}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <Button
                                    isLoading={vacuumBusy}
                                    onClick={handleRunVacuum}
                                    size="sm"
                                    variant="ghost"
                                >
                                    Run now
                                </Button>
                                <ToggleSwitch
                                    checked={maintenance.settings.vacuumEnabled}
                                    disabled={savingMaintenanceSetting}
                                    onChange={() =>
                                        updateMaintenanceSetting({
                                            vacuumEnabled: !maintenance!.settings!.vacuumEnabled,
                                        })
                                    }
                                />
                            </div>
                        </div>
                    </Card>
                )}

                {accounts.length > 0 &&
                    (summary.neverLoggedIn > 0 ||
                        summary.abandoned > 0 ||
                        summary.overQuota > 0) && (
                        <div className="mb-4 flex flex-wrap items-center gap-4 text-muted text-xs">
                            <span>
                                <span className="font-semibold text-default">
                                    {summary.neverLoggedIn}
                                </span>{" "}
                                never logged in
                            </span>
                            {summary.abandoned > 0 && (
                                <>
                                    <span>·</span>
                                    <span>
                                        <span className="font-semibold text-warning">
                                            {summary.abandoned}
                                        </span>{" "}
                                        abandoned
                                    </span>
                                </>
                            )}
                            {summary.overQuota > 0 && (
                                <>
                                    <span>·</span>
                                    <span>
                                        <span className="font-semibold text-error">
                                            {summary.overQuota}
                                        </span>{" "}
                                        over the {quotaThreshold}-record quota
                                    </span>
                                </>
                            )}
                        </div>
                    )}

                <div className="mb-3 flex flex-wrap items-center gap-3">
                    {accounts.length > 0 && (
                        <SelectAllCheckbox
                            onDeselectAll={() => setSelectedIds(new Set())}
                            onSelectAll={() =>
                                setSelectedIds(new Set(filteredAccounts.map((a) => a.id)))
                            }
                            selectedCount={selectedIds.size}
                            totalCount={filteredAccounts.length}
                        />
                    )}
                    <div className="relative min-w-[220px] max-w-sm flex-1">
                        <MagnifyingGlassIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
                        <input
                            className="w-full rounded-lg border border-transparent bg-surface-hover py-2 pr-3 pl-9 text-default text-sm focus:border-primary focus:outline-none"
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by UUID or label..."
                            type="text"
                            value={search}
                        />
                    </div>
                    {search && (
                        <span className="text-subtle text-xs">
                            {filteredAccounts.length} of {accounts.length}
                        </span>
                    )}
                    {summary.abandoned > 0 && (
                        <Button onClick={selectAbandoned} size="sm" variant="ghost">
                            Select {summary.abandoned} abandoned
                        </Button>
                    )}
                    {summary.overQuota > 0 && (
                        <Button onClick={selectOverQuota} size="sm" variant="ghost">
                            Select {summary.overQuota} over quota
                        </Button>
                    )}
                    {accounts.length > 0 && (
                        <Button
                            onClick={() => {
                                setBroadcastTarget(selectedIds.size > 0 ? "selected" : "all");
                                setShowBroadcast(true);
                            }}
                            size="sm"
                            variant="secondary"
                        >
                            Broadcast
                        </Button>
                    )}
                    <div
                        className="flex items-center gap-1.5 text-muted text-xs"
                        title="An account at or above this many total records (users/groups/addons/catalogs/watch sessions/vault entries) is flagged as over quota - saved on this device only"
                    >
                        <span>Quota</span>
                        <input
                            className="w-20 rounded-lg border border-transparent bg-surface-hover px-2 py-1.5 text-default text-xs focus:border-primary focus:outline-none"
                            min={0}
                            onChange={(e) =>
                                updateQuotaThreshold(
                                    Math.max(0, Number.parseInt(e.target.value, 10) || 0)
                                )
                            }
                            step={50}
                            type="number"
                            value={quotaThreshold}
                        />
                    </div>
                    <select
                        className="rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                        onChange={(e) => setSortBy(e.target.value as SortKey)}
                        value={sortBy}
                    >
                        <option value="createdAt">Newest first</option>
                        <option value="lastLoginAt">Most recently active</option>
                        <option value="resourceRowCount">Heaviest usage first</option>
                    </select>
                </div>

                <Card padding="none">
                    <div className="divide-y divide-default">
                        {accounts.length === 0 && !loadingAccounts ? (
                            <p className="p-6 text-center text-muted text-sm">
                                No accounts registered yet.
                            </p>
                        ) : filteredAccounts.length === 0 ? (
                            <p className="p-6 text-center text-muted text-sm">
                                No accounts match &quot;{search}&quot;.
                            </p>
                        ) : (
                            filteredAccounts.map((a) => (
                                <div
                                    className={`flex items-center justify-between gap-4 p-4 transition-colors ${selectedIds.has(a.id) ? "bg-primary-muted" : "hover:bg-surface-hover"}`}
                                    key={a.id}
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-3">
                                        <SelectionCheckbox
                                            checked={selectedIds.has(a.id)}
                                            onChange={() => toggleSelect(a.id)}
                                            visible={selectedIds.has(a.id)}
                                        />
                                        <div
                                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-semibold text-xs ${a.disabled ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"}`}
                                        >
                                            {a.displayName
                                                ? a.displayName.slice(0, 2).toUpperCase()
                                                : (a.uuid || a.id).slice(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                {a.displayName ? (
                                                    <>
                                                        <span
                                                            className="truncate font-semibold text-default text-sm"
                                                            title="Set by the account holder in their own Settings"
                                                        >
                                                            {a.displayName}
                                                        </span>
                                                        <span className="truncate font-mono text-subtle text-xs">
                                                            {a.uuid || a.id}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="truncate font-mono text-default text-sm">
                                                        {a.uuid || a.id}
                                                    </span>
                                                )}
                                                {isRecentlyRegistered(a) && (
                                                    <Badge size="sm" variant="primary">
                                                        New
                                                    </Badge>
                                                )}
                                                {a.disabled && (
                                                    <Badge size="sm" variant="warning">
                                                        Disabled
                                                    </Badge>
                                                )}
                                                {isAbandoned(a) && (
                                                    <Badge
                                                        size="sm"
                                                        title="Registered a while ago, empty, never logged in"
                                                        variant="muted"
                                                    >
                                                        Abandoned
                                                    </Badge>
                                                )}
                                                {isOverQuota(a, quotaThreshold) && (
                                                    <Badge
                                                        size="sm"
                                                        title={`At or above the ${quotaThreshold}-record quota`}
                                                        variant="error"
                                                    >
                                                        Over quota
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="mt-0.5 text-muted text-xs">
                                                {a.userCount} user{a.userCount === 1 ? "" : "s"} ·{" "}
                                                {a.groupCount} group{a.groupCount === 1 ? "" : "s"}{" "}
                                                · {a.addonCount} addon
                                                {a.addonCount === 1 ? "" : "s"}
                                                <span
                                                    className="text-subtle"
                                                    title="Row count across users/groups/addons/catalogs/watch sessions/vault entries - a usage proxy, not a byte-accurate size"
                                                >
                                                    {" "}
                                                    · {a.resourceRowCount} record
                                                    {a.resourceRowCount === 1 ? "" : "s"} total
                                                </span>
                                            </p>
                                            <p className="mt-0.5 text-subtle text-xs">
                                                Registered{" "}
                                                {new Date(a.createdAt).toLocaleDateString()} · Last
                                                login{" "}
                                                {a.lastLoginAt
                                                    ? new Date(a.lastLoginAt).toLocaleString()
                                                    : "never"}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-shrink-0 items-center gap-2">
                                        <Button
                                            isLoading={busyId === a.id}
                                            onClick={() => handleToggleDisabled(a)}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            {a.disabled ? "Enable" : "Disable"}
                                        </Button>
                                        <Button
                                            onClick={() => setConfirmDelete(a)}
                                            size="sm"
                                            variant="danger"
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </Card>

                {/* Operator action trail - who got disabled/enabled/deleted and
            when. Collapsed by default and lazy-loaded, same reasoning as
            above. Never shows anything from inside a tenant's own data. */}
                <div className="mt-6">
                    <button
                        className="font-medium text-muted text-sm transition-colors hover:text-default"
                        onClick={toggleAuditLog}
                        type="button"
                    >
                        {showAuditLog ? "▾" : "▸"} Audit log
                    </button>
                    {showAuditLog && (
                        <Card className="mt-2" padding="none">
                            {loadingAuditLog ? (
                                <p className="p-6 text-center text-muted text-sm">Loading...</p>
                            ) : auditLog.length === 0 ? (
                                <p className="p-6 text-center text-muted text-sm">
                                    No operator actions recorded yet.
                                </p>
                            ) : (
                                <div className="divide-y divide-default">
                                    {auditLog.map((e) => (
                                        <div
                                            className="flex items-center justify-between gap-4 p-3 text-sm"
                                            key={e.id}
                                        >
                                            <div className="min-w-0">
                                                <span className="truncate font-mono text-default">
                                                    {e.targetAccountUuid || e.targetAccountId}
                                                </span>
                                                <span className="text-muted"> — {e.action}</span>
                                                {e.bulk && (
                                                    <Badge
                                                        className="ml-2"
                                                        size="sm"
                                                        variant="muted"
                                                    >
                                                        Bulk
                                                    </Badge>
                                                )}
                                            </div>
                                            <span className="shrink-0 text-subtle text-xs">
                                                {new Date(e.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    )}
                </div>
            </div>

            {/* Floating bulk-action bar - same pattern used across the rest of the
          app's own bulk-select flows. */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2">
                    <div className="flex items-center gap-4 rounded-2xl border border-default bg-surface px-6 py-4 shadow-2xl backdrop-blur-xl">
                        <div className="flex items-center gap-2 border-default border-r pr-4">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted">
                                <span className="font-bold text-primary text-sm">
                                    {selectedIds.size}
                                </span>
                            </div>
                            <span className="text-muted text-sm">selected</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={() => {
                                    setBroadcastTarget("selected");
                                    setShowBroadcast(true);
                                }}
                                size="sm"
                                variant="secondary"
                            >
                                Notify
                            </Button>
                            <Button
                                isLoading={bulkBusy}
                                onClick={() => handleBulkToggleDisabled(true)}
                                size="sm"
                                variant="secondary"
                            >
                                Disable
                            </Button>
                            <Button
                                isLoading={bulkBusy}
                                onClick={() => handleBulkToggleDisabled(false)}
                                size="sm"
                                variant="secondary"
                            >
                                Enable
                            </Button>
                            <Button
                                isLoading={bulkBusy}
                                onClick={() => setConfirmBulkDelete(true)}
                                size="sm"
                                variant="danger"
                            >
                                Delete
                            </Button>
                        </div>
                        <button
                            className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover"
                            onClick={() => setSelectedIds(new Set())}
                            type="button"
                        >
                            <XMarkIcon className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            )}

            {confirmDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <Card className="w-full max-w-sm" padding="lg">
                        <h3 className="mb-2 font-semibold text-base text-default">
                            Delete this account?
                        </h3>
                        <p className="mb-4 text-muted text-sm">
                            Permanently deletes{" "}
                            <span className="font-mono text-default">
                                {confirmDelete.uuid || confirmDelete.id}
                            </span>{" "}
                            and everything in it — users, groups, addons, watch history, Vault
                            entries. This cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button
                                onClick={() => setConfirmDelete(null)}
                                size="sm"
                                variant="ghost"
                            >
                                Cancel
                            </Button>
                            <Button
                                isLoading={busyId === confirmDelete.id}
                                onClick={handleDelete}
                                size="sm"
                                variant="danger"
                            >
                                Delete permanently
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {showBroadcast && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <Card className="w-full max-w-md" padding="lg">
                        <h3 className="mb-1 font-semibold text-base text-default">
                            Broadcast announcement
                        </h3>
                        <p className="mb-4 text-muted text-xs">
                            Sends a bell notification, plus a push alert to any subscribed device,
                            to the targeted accounts - the same delivery pipeline every other
                            notification here uses.
                        </p>
                        {selectedIds.size > 0 && (
                            <div className="mb-3 flex items-center gap-2 rounded-lg bg-surface-hover p-1">
                                <button
                                    className={`flex-1 rounded-md py-1.5 font-medium text-xs transition-colors ${broadcastTarget === "all" ? "bg-primary text-white" : "text-muted"}`}
                                    onClick={() => setBroadcastTarget("all")}
                                    type="button"
                                >
                                    All accounts ({accounts.filter((a) => !a.disabled).length})
                                </button>
                                <button
                                    className={`flex-1 rounded-md py-1.5 font-medium text-xs transition-colors ${broadcastTarget === "selected" ? "bg-primary text-white" : "text-muted"}`}
                                    onClick={() => setBroadcastTarget("selected")}
                                    type="button"
                                >
                                    Selected only ({selectedIds.size})
                                </button>
                            </div>
                        )}
                        <div className="space-y-3">
                            <Input
                                autoFocus
                                onChange={(e) => setBroadcastTitle(e.target.value.slice(0, 120))}
                                placeholder="Title (e.g. Maintenance window tonight)"
                                value={broadcastTitle}
                            />
                            <textarea
                                className="w-full resize-none rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                                onChange={(e) => setBroadcastBody(e.target.value.slice(0, 500))}
                                placeholder="Message (optional)"
                                rows={4}
                                value={broadcastBody}
                            />
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                            <Button
                                onClick={() => setShowBroadcast(false)}
                                size="sm"
                                variant="ghost"
                            >
                                Cancel
                            </Button>
                            <Button
                                disabled={!broadcastTitle.trim()}
                                isLoading={broadcasting}
                                onClick={handleBroadcast}
                                size="sm"
                                variant="primary"
                            >
                                Send
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            <ConfirmModal
                confirmText={bulkBusy ? "Deleting..." : "Delete permanently"}
                description={`Permanently delete ${selectedIds.size} account${selectedIds.size === 1 ? "" : "s"} and everything in them — users, groups, addons, watch history, Vault entries. This cannot be undone.`}
                isLoading={bulkBusy}
                isOpen={confirmBulkDelete}
                onClose={() => setConfirmBulkDelete(false)}
                onConfirm={handleBulkDelete}
                title="Delete accounts"
                variant="danger"
            />
        </div>
    );
}
