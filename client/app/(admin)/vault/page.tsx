"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import {
    ArrowPathIcon,
    ArrowTopRightOnSquareIcon,
    BanknotesIcon,
    Bars3Icon,
    BellSlashIcon,
    CalendarDaysIcon,
    ChevronDownIcon,
    ClockIcon,
    CreditCardIcon,
    DocumentDuplicateIcon,
    EyeIcon,
    EyeSlashIcon,
    PencilIcon,
    PlusIcon,
    PuzzlePieceIcon,
    ShieldCheckIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import Head from "next/head";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Header } from "@/components/layout/Header";
import {
    NEBULA_GLASS_CLASS,
    NebulaGlassStripe,
    NebulaPageHeading,
    nebulaGlassStyle,
} from "@/components/layout/NebulaTopbar";
import { StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import { SIDEBAR_ADDONS_DROPZONE_ID, useVaultDrag } from "@/components/providers/VaultDragContext";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { TVPageProvider } from "@/components/tv/TVPageProvider";
import {
    Badge,
    Button,
    Card,
    ContextMenu,
    FilterTabsResponsive,
    Input,
    Modal,
    ToggleSwitch,
    useContextMenu,
} from "@/components/ui";
import { useSortableDragState } from "@/components/ui/DragSortable";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { api, type VaultCategory, type VaultEntry, type VaultTestType } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";
import { useIsTV } from "@/lib/hooks/useIsTV";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { useLayoutMode } from "@/lib/layout-mode";

const CATEGORY_LABELS: Record<VaultCategory, string> = {
    ai: "AI Services",
    aiostreams: "AIOStreams",
    custom: "Custom",
    debrid: "Debrid Services",
    metadata: "Metadata & Trackers",
    nuvio: "Nuvio",
    stremio: "Stremio",
    usenet_indexer: "Usenet Indexers",
    usenet_provider: "Usenet Providers",
    vpn: "VPN",
};

// AI Services also has its own dedicated front door in Settings -> External
// API Keys (with a real verify-on-save check this generic Vault form
// doesn't run) - but it's still the same underlying VaultEntry row
// (category: 'ai'), so it stays visible here too rather than hidden from
// Vault's own tabs/Add Entry picker. Managing it from Settings gets you
// live verification; managing it here gets you the same expiry/cost
// tracking and drag-to-reorder every other entry has - both write to the
// same place.
const VAULT_UI_CATEGORY_LABELS = CATEGORY_LABELS;

const TEST_TYPE_LABELS: Record<VaultTestType, string> = {
    generic_http: "Generic HTTP request",
    manual: "Manual (no automated check)",
    newznab_caps: "Newznab indexer",
    nuvio_auth: "Nuvio login",
    openai_compatible: "AI provider (OpenAI-compatible)",
    real_debrid: "Real-Debrid",
    stremio_auth: "Stremio login",
    tcp_reachability: "TCP reachability",
    torbox: "TorBox",
};

// Common currency codes for the Vault cost selector. Intl.NumberFormat
// renders the correct symbol/placement for each, so only the ISO code is
// stored - no hardcoded "$".
const CURRENCY_OPTIONS = [
    "USD",
    "EUR",
    "GBP",
    "CAD",
    "AUD",
    "JPY",
    "CHF",
    "CNY",
    "INR",
    "BRL",
    "MXN",
    "SEK",
    "NOK",
    "DKK",
    "PLN",
    "NZD",
    "ZAR",
];

function daysUntil(dateStr?: string | null): number | null {
    if (!dateStr) {
        return null;
    }
    return Math.round((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ entry }: { entry: VaultEntry }) {
    if (entry.testType === "manual" || !entry.lastCheckStatus) {
        return (
            <Badge size="sm" variant="neutral">
                Not checked
            </Badge>
        );
    }
    if (entry.lastCheckStatus === "ok") {
        return (
            <Badge size="sm" variant="success">
                Active
            </Badge>
        );
    }
    if (entry.lastCheckStatus === "error") {
        return (
            <Badge size="sm" variant="error">
                Error
            </Badge>
        );
    }
    return (
        <Badge size="sm" variant="neutral">
            Unknown
        </Badge>
    );
}

// Whether this entry's expiry-warning alert is currently snoozed (7-day
// window set via the Snooze button - see handleSnooze).
function isSnoozed(entry: VaultEntry): boolean {
    return !!entry.snoozedUntil && new Date(entry.snoozedUntil) > new Date();
}

function ExpiryBadge({ entry }: { entry: VaultEntry }) {
    const days = daysUntil(entry.expiresAt);
    if (days === null) {
        return null;
    }
    if (isSnoozed(entry)) {
        return (
            <Badge className="!text-sm" size="md" variant="neutral">
                Snoozed
            </Badge>
        );
    }
    if (days < 0) {
        return (
            <Badge className="!text-sm" size="md" variant="error">
                Expired
            </Badge>
        );
    }
    if (days <= entry.notifyDaysBefore) {
        return (
            <Badge className="!text-sm" size="md" variant="warning">
                {days}d left
            </Badge>
        );
    }
    return (
        <Badge className="!text-sm" size="md" variant="outline">
            {days}d left
        </Badge>
    );
}

// Live Real-Debrid/TorBox usage (active downloads, premium days left) plus
// the auto-remove toggle - own component (not inlined in renderEntryCard, a
// plain function that can't hold hooks - see SortableEntryCard's own
// comment on the same constraint) so each debrid card fetches independently
// on mount without re-fetching every OTHER card whenever any one entry's
// state changes.
function DebridUsageBadge({
    entry,
    onEntryUpdated,
}: {
    entry: VaultEntry;
    onEntryUpdated: (id: string, patch: Partial<VaultEntry>) => void;
}) {
    const [usage, setUsage] = useState<
        { premiumDaysLeft: number | null; activeDownloads: number | null } | null | undefined
    >(undefined);
    const [savingAutoRemove, setSavingAutoRemove] = useState(false);
    // Controlled (was uncontrolled + save-on-blur only) - clicking the
    // native spin-button arrows changes the value without ever blurring the
    // input, so a blur-only save silently dropped the change if the user
    // then refreshed or navigated away before clicking elsewhere. Saving on
    // every change (typed or via the arrows) instead of only on blur means
    // there's never a window where a real change sits unsaved.
    const [daysValue, setDaysValue] = useState(String(entry.autoRemoveAfterDays || 7));

    useEffect(() => {
        if (entry.testType !== "real_debrid" && entry.testType !== "torbox") {
            return;
        }
        let cancelled = false;
        api.getVaultEntryUsage(entry.id)
            .then((r) => {
                if (!cancelled) {
                    setUsage(r.usage);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setUsage(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [entry.id, entry.testType]);

    if (entry.testType !== "real_debrid" && entry.testType !== "torbox") {
        return null;
    }

    const parts: string[] = [];
    if (usage) {
        if (typeof usage.activeDownloads === "number") {
            parts.push(
                `${usage.activeDownloads} active download${usage.activeDownloads === 1 ? "" : "s"}`
            );
        }
        if (typeof usage.premiumDaysLeft === "number") {
            parts.push(`${usage.premiumDaysLeft}d premium left`);
        }
    }

    const handleToggleAutoRemove = async () => {
        const next = !entry.autoRemoveEnabled;
        setSavingAutoRemove(true);
        try {
            await api.updateVaultEntry(entry.id, { autoRemoveEnabled: next });
            onEntryUpdated(entry.id, { autoRemoveEnabled: next });
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update auto-remove"));
        } finally {
            setSavingAutoRemove(false);
        }
    };

    const handleChangeAutoRemoveDays = async (days: number) => {
        if (!Number.isFinite(days) || days < 1) {
            return;
        }
        try {
            await api.updateVaultEntry(entry.id, { autoRemoveAfterDays: days });
            onEntryUpdated(entry.id, { autoRemoveAfterDays: days });
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update auto-remove"));
        }
    };

    return (
        <div className="mb-3 space-y-1.5">
            {parts.length > 0 && (
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {parts.join(" · ")}
                </p>
            )}
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Auto-remove finished torrents
                </span>
                <ToggleSwitch
                    checked={!!entry.autoRemoveEnabled}
                    disabled={savingAutoRemove}
                    onChange={handleToggleAutoRemove}
                    size="sm"
                />
            </div>
            {/* Day-count control only shown once auto-remove is actually on -
          confirmed cramped/mismatched on both PC and mobile when it was
          always inline next to the toggle regardless of state (a size="md"
          toggle next to text-xs text plus a number input, all fighting for
          space on an already-narrow card). */}
            {entry.autoRemoveEnabled && (
                <div
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                >
                    <span>After</span>
                    <input
                        className="w-12 rounded px-1.5 py-0.5 text-center text-xs"
                        min={1}
                        onBlur={(e) => {
                            // Safety net: if what's left in the field on blur never
                            // resolved to a valid save above (e.g. the user left it
                            // empty), fall back to the last known-good value instead of
                            // leaving the field blank.
                            const parsed = Number.parseInt(e.target.value, 10);
                            if (!Number.isFinite(parsed) || parsed < 1) {
                                setDaysValue(String(entry.autoRemoveAfterDays || 7));
                            }
                        }}
                        onChange={(e) => {
                            setDaysValue(e.target.value);
                            const parsed = Number.parseInt(e.target.value, 10);
                            // Saves on every valid change (typing a digit or clicking a
                            // spin-button arrow) - not just on blur, so a value changed
                            // via the arrows and never blurred (e.g. the user immediately
                            // refreshes or navigates away) still persists. An empty or
                            // mid-edit value (e.g. briefly clearing the field to retype)
                            // just doesn't save yet, rather than saving a bad number.
                            if (Number.isFinite(parsed) && parsed >= 1) {
                                handleChangeAutoRemoveDays(parsed);
                            }
                        }}
                        style={{
                            background: "var(--color-subtle)",
                            border: "1px solid var(--color-surface-border)",
                            color: "var(--color-text)",
                        }}
                        type="number"
                        value={daysValue}
                    />
                    <span>days idle</span>
                </div>
            )}
        </div>
    );
}

// Failover partner picker. Every credential can nominate another entry on
// the account as its backup: when this key's own health check comes back
// failing, consumers (debrid auto-remove, usenet, AI catalog, the metadata
// key resolvers) transparently use the backup instead of just breaking.
// Scoped to the same category on purpose - a debrid key backed by an OMDb
// key would be accepted by the schema but is never what anyone means.
function BackupKeySelect({
    entry,
    allEntries,
    onEntryUpdated,
}: {
    entry: VaultEntry;
    allEntries: VaultEntry[];
    onEntryUpdated: (id: string, patch: Partial<VaultEntry>) => void;
}) {
    const [saving, setSaving] = useState(false);

    // An entry cannot back up itself (the server rejects it too), and only
    // same-category entries are offered.
    const candidates = allEntries.filter(
        (e) => e.id !== entry.id && e.category === entry.category && e.isActive
    );

    // Nothing to fail over TO - showing an empty dropdown on every card in a
    // one-key-per-category vault would be pure noise.
    if (candidates.length === 0 && !entry.backupEntryId) {
        return null;
    }

    const handleChange = async (value: string) => {
        setSaving(true);
        try {
            await api.updateVaultEntry(entry.id, { backupEntryId: value || null });
            onEntryUpdated(entry.id, { backupEntryId: value || null });
            toast.success(value ? "Backup key set" : "Backup key cleared");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to set backup key"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mb-3 flex items-center justify-between gap-2">
            <span className="shrink-0 text-xs" style={{ color: "var(--color-text-muted)" }}>
                Backup key
            </span>
            <select
                className="min-w-0 max-w-[60%] rounded px-1.5 py-1 text-xs"
                disabled={saving}
                onChange={(e) => handleChange(e.target.value)}
                style={{
                    background: "var(--color-subtle)",
                    border: "1px solid var(--color-surface-border)",
                    color: "var(--color-text)",
                }}
                value={entry.backupEntryId || ""}
            >
                <option value="">None</option>
                {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
        </div>
    );
}

interface EntryFormState {
    // "ai" category only - the endpoint/model an entry's key talks to (see
    // server/utils/nlCatalog.js, which reads these back out of testConfig for
    // natural-language Catalogs). Optional: left blank, the server defaults to
    // OpenAI's own endpoint + a small fast model - only needs filling in for a
    // different OpenAI-compatible provider (OpenRouter, Groq, a local proxy).
    aiBaseUrl: string;
    aiModel: string;
    category: VaultCategory;
    cost: string;
    costCycle: "monthly" | "yearly";
    dashboardUrl: string;
    expiresAt: string;
    name: string;
    notifyDaysBefore: string;
    provider: string;
    secret: string;
    secretLabel: string;
    secretUsername: string; // only used for usenet_provider mode (combined into JSON on save)
    testDataCap: string;
    testHost: string;
    testPort: string;
    testSsl: boolean;
    testType: VaultTestType;
    testUrl: string;
}

const EMPTY_FORM: EntryFormState = {
    aiBaseUrl: "",
    aiModel: "",
    category: "custom",
    cost: "",
    costCycle: "monthly",
    dashboardUrl: "",
    expiresAt: "",
    name: "",
    notifyDaysBefore: "3",
    provider: "",
    secret: "",
    secretLabel: "API Key",
    secretUsername: "",
    testDataCap: "",
    testHost: "",
    testPort: "",
    testSsl: true,
    testType: "manual",
    testUrl: "",
};

// Which specialized form to show for a given category
function categoryFieldMode(
    category: VaultCategory
): "credentials" | "indexer" | "provider" | "generic" {
    if (category === "stremio" || category === "nuvio") {
        return "credentials";
    }
    if (category === "usenet_indexer") {
        return "indexer";
    }
    if (category === "usenet_provider") {
        return "provider";
    }
    return "generic";
}

// Sensible defaults applied automatically when switching to a specialized category
function categoryDefaults(category: VaultCategory): Partial<EntryFormState> {
    if (category === "ai") {
        return { secretLabel: "API Key", testType: "manual" };
    }
    switch (categoryFieldMode(category)) {
        case "credentials":
            return {
                secretLabel: "Password",
                testType: category === "nuvio" ? "nuvio_auth" : "stremio_auth",
            };
        case "indexer":
            return { secretLabel: "API Key", testType: "newznab_caps" };
        case "provider":
            return { secretLabel: "Password", testType: "tcp_reachability" };
        default:
            return {};
    }
}

// Wraps a card with dnd-kit's sortable drag state AND a right-click context
// menu — both live here (rather than in renderEntryCard) since hooks can't
// be called conditionally or inside a .map() callback directly.
function SortableEntryCard({
    entry,
    renderEntryCard,
    onTest,
    onEdit,
    onMoveToAddons,
    onDelete,
}: {
    entry: VaultEntry;
    renderEntryCard: (
        entry: VaultEntry,
        dragHandleProps?: Record<string, unknown>,
        isDragging?: boolean
    ) => React.ReactNode;
    onTest: (entry: VaultEntry) => void;
    onEdit: (entry: VaultEntry) => void;
    onMoveToAddons: (entry: VaultEntry) => void;
    onDelete: (entry: VaultEntry) => void;
}) {
    const { dragHandleProps, itemProps, isDragging } = useSortableDragState(entry.id);
    const { isOpen, position, handleContextMenu, close } = useContextMenu();
    // onContextMenu alone only covers a real desktop right-click - iOS Safari
    // doesn't reliably synthesize that DOM event from a touch-and-hold, so
    // this menu (Run Check Now/Edit/Move to Addons/Delete) was effectively
    // unreachable by holding on mobile. See useLongPress's own comment.
    const longPress = useLongPress({ onLongPress: handleContextMenu });

    return (
        <div
            className={`${itemProps.className} tap-card`}
            onContextMenu={handleContextMenu}
            ref={itemProps.ref}
            role="none"
            style={itemProps.style}
            {...longPress}
        >
            {renderEntryCard(entry, dragHandleProps, isDragging)}

            <ContextMenu isOpen={isOpen} onClose={close} position={position}>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover disabled:opacity-40"
                    disabled={entry.testType === "manual"}
                    onClick={() => {
                        close();
                        onTest(entry);
                    }}
                    type="button"
                >
                    <ArrowPathIcon className="h-4 w-4" />
                    Run Check Now
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={() => {
                        close();
                        onEdit(entry);
                    }}
                    type="button"
                >
                    <PencilIcon className="h-4 w-4" />
                    Edit
                </button>
                {entry.dashboardUrl && (
                    <a
                        className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                        href={entry.dashboardUrl}
                        onClick={close}
                        rel="noreferrer"
                        target="_blank"
                    >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                        Open Dashboard
                    </a>
                )}
                {entry.dashboardUrl && (
                    <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                        onClick={() => {
                            close();
                            window.open(
                                entry.dashboardUrl || undefined,
                                "_blank",
                                "noopener,noreferrer"
                            );
                            onEdit(entry);
                        }}
                        title="Open the provider's dashboard and this entry's edit form together"
                        type="button"
                    >
                        <ArrowPathIcon className="h-4 w-4" />
                        Rotate Now
                    </button>
                )}
                <div className="my-1 border-default border-t" />
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={() => {
                        close();
                        onMoveToAddons(entry);
                    }}
                    type="button"
                >
                    <PuzzlePieceIcon className="h-4 w-4" />
                    Move to Addons
                </button>
                <div className="my-1 border-default border-t" />
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-error text-sm transition-colors hover:bg-error-muted"
                    onClick={() => {
                        close();
                        onDelete(entry);
                    }}
                    type="button"
                >
                    <TrashIcon className="h-4 w-4" />
                    Delete
                </button>
            </ContextMenu>
        </div>
    );
}

// useSearchParams (for the ?edit= deep link below) requires a Suspense
// boundary above it in the App Router - same pattern Activity's page
// already uses for its own search-param-driven state.
function VaultPageContent() {
    const accessibleFieldId1 = useId();
    const fieldId1 = useId();
    const { layoutMode } = useLayoutMode();
    const isTV = useIsTV();
    const Wrapper = isTV ? TVPageProvider : Fragment;
    const searchParams = useSearchParams();
    const router = useRouter();
    const [entries, setEntries] = useState<VaultEntry[]>([]);
    const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
    const [total, setTotal] = useState(0);
    const [activeCategory, setActiveCategory] = useState("debrid"); // 'all' tab removed - defaults to first real category
    const [isLoading, setIsLoading] = useState(true);

    // Instant navigation: the last-known entries of the category this page
    // opens on, shown at once while load() below refreshes them.
    useLastKnown<{ entries: VaultEntry[]; categories: Record<string, number>; total: number }>(
        "/vault?category=debrid",
        (cached) => {
            setEntries(cached.entries);
            setCategoryCounts(cached.categories);
            setTotal(cached.total);
            setIsLoading(false);
        }
    );
    const [revealed, setRevealed] = useState<Record<string, string>>({});
    const [testingId, setTestingId] = useState<string | null>(null);
    const [movingToAddonsId, setMovingToAddonsId] = useState<string | null>(null);

    const [isAddOpen, setIsAddOpen] = useState(false);
    // Set only when the edit modal was opened via an alert's deep link
    // (?edit=<id>), so the "rotate now" banner (open the dashboard right from
    // inside the form) only shows in that context, not on every manual edit.
    const [arrivedViaAlert, setArrivedViaAlert] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<EntryFormState>(EMPTY_FORM);
    const [isSaving, setIsSaving] = useState(false);

    // Cost summary - needs ALL entries (not just the active category tab's) plus
    // recent watch hours, so it's a separate fetch from the tab-scoped `load()`.
    // Re-fetched via `costRefreshKey` whenever an entry is saved/deleted so the
    // summary stays in sync with edits.
    const [allCostEntries, setAllCostEntries] = useState<VaultEntry[]>([]);
    const [hoursLast30, setHoursLast30] = useState<number | null>(null);
    const [currency, setCurrency] = useState("USD");
    const [costRefreshKey, setCostRefreshKey] = useState(0);
    // Renewal calendar starts collapsed to just its one summary line - the
    // detail list of every individual upcoming renewal is worth having but
    // not worth always taking up vertical space for.
    const [renewalExpanded, setRenewalExpanded] = useState(false);

    useEffect(() => {
        api.getVaultEntries()
            .then((d) => {
                setAllCostEntries(d.entries);
                if (d.currency) {
                    setCurrency(d.currency);
                }
            })
            .catch(() => undefined);
        // Sum hours from the last 30 days of watchTime.byDay - a monthly spend
        // figure divided by ~a month of hours keeps cost/hour dimensionally
        // honest (a monthly $ over all-time hours would keep shrinking as history
        // piles up, which reads as "getting cheaper" when nothing changed).
        api.getMetrics("all")
            .then((m) => {
                const byDay = m.watchTime?.byDay || [];
                const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                    .toISOString()
                    .slice(0, 10);
                const sum = byDay
                    .filter((d) => d.date >= cutoff)
                    .reduce((acc, d) => acc + (d.hours || 0), 0);
                setHoursLast30(sum);
            })
            .catch(() => undefined);
    }, [costRefreshKey]);

    // Format any amount in the account's chosen currency - Intl handles the
    // symbol, placement, and decimal conventions for whatever code is set, so
    // there's no hardcoded "$". Falls back to a plain prefix if the code is
    // somehow invalid.
    const fmtMoney = useCallback(
        (amount: number) => {
            try {
                return new Intl.NumberFormat(undefined, { currency, style: "currency" }).format(
                    amount
                );
            } catch {
                return `${currency} ${amount.toFixed(2)}`;
            }
        },
        [currency]
    );

    const handleCurrencyChange = async (next: string) => {
        setCurrency(next);
        try {
            await api.updateSyncSettings({ vaultCurrency: next });
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to update currency"));
        }
    };

    // Normalize each entry to a monthly figure (yearly ÷ 12) before totaling, so
    // monthly and yearly-billed services sum correctly together.
    const toMonthly = (e: VaultEntry) => (e.cost || 0) / (e.costCycle === "yearly" ? 12 : 1);
    const monthlyTotal = allCostEntries.reduce((sum, e) => sum + toMonthly(e), 0);
    const trackedCount = allCostEntries.filter((e) => e.cost != null && e.cost > 0).length;
    const costPerHour = hoursLast30 && hoursLast30 > 0 ? monthlyTotal / hoursLast30 : null;

    // Renewal calendar: projects each cost-tracked entry's OWN renewal cycle
    // forward from its current expiresAt (not just a single "next renewal"
    // check) - a monthly service renews up to 3 times within a 90-day window,
    // and each occurrence is a real, separate charge, not one. expiresAt is
    // kept current either by Real-Debrid/TorBox's own auto-check (see
    // vaultCheckers.js) or manually whenever the admin renews something else -
    // this only ever projects forward from whatever that value currently is,
    // never guesses at a renewal that hasn't happened.
    const FORECAST_WINDOW_DAYS = 90;
    const upcomingRenewals = useMemo(() => {
        const now = Date.now();
        const windowEnd = now + FORECAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const occurrences: Array<{ entryId: string; name: string; date: Date; amount: number }> =
            [];
        for (const e of allCostEntries) {
            if (!e.cost || e.cost <= 0 || !e.expiresAt || !e.isActive) {
                continue;
            }
            const cycleDays = e.costCycle === "yearly" ? 365 : 30;
            let next = new Date(e.expiresAt).getTime();
            // Catch up past-due entries (expiresAt already passed but never
            // updated) to the next real occurrence instead of skipping the
            // window entirely or double-counting a stale date.
            while (next < now) {
                next += cycleDays * 24 * 60 * 60 * 1000;
            }
            while (next <= windowEnd) {
                occurrences.push({
                    amount: e.cost,
                    date: new Date(next),
                    entryId: e.id,
                    name: e.name,
                });
                next += cycleDays * 24 * 60 * 60 * 1000;
            }
        }
        return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [allCostEntries]);
    const forecastTotal = upcomingRenewals.reduce((sum, r) => sum + r.amount, 0);

    const load = useCallback(async () => {
        try {
            const data = await api.getVaultEntries(activeCategory);
            setEntries(data.entries);
            setCategoryCounts(data.categories);
            setTotal(data.total);
            // Keep the (all-category) cost summary in sync with any edit that
            // triggered this reload.
            setCostRefreshKey((k) => k + 1);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to load vault entries"));
        } finally {
            setIsLoading(false);
        }
    }, [activeCategory]);

    useEffect(() => {
        load();
    }, [load]);

    const openAddModal = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setArrivedViaAlert(false);
        setIsAddOpen(true);
    };

    const openEditModal = async (entry: VaultEntry) => {
        setEditingId(entry.id);
        setArrivedViaAlert(false);
        const cfg = entry.testConfig || {};
        setForm({
            aiBaseUrl: cfg.baseUrl || "",
            aiModel: cfg.model || "",
            category: entry.category,
            cost: entry.cost === null ? "" : String(entry.cost),
            costCycle: entry.costCycle === "yearly" ? "yearly" : "monthly",
            dashboardUrl: entry.dashboardUrl || "",
            expiresAt: entry.expiresAt ? entry.expiresAt.split("T")[0] : "",
            name: entry.name,
            notifyDaysBefore: String(entry.notifyDaysBefore ?? 3),
            provider: entry.provider || "",
            secret: "", // left blank — only sent if user types a new value
            secretLabel: entry.secretLabel,
            secretUsername: "", // same — usenet_provider username isn't returned decrypted either
            testDataCap: cfg.dataCapGB ? String(cfg.dataCapGB) : "",
            testHost: cfg.host || "",
            testPort: cfg.port ? String(cfg.port) : "",
            testSsl: cfg.ssl ?? true,
            testType: entry.testType,
            testUrl: cfg.url || "",
        });
        setIsAddOpen(true);
    };

    // Deep link from a Vault alert's "Fix now" button (?edit=<entryId>) - jump
    // straight into that entry's edit form instead of leaving someone to hunt
    // through categories for whichever one just failed. Fetches the entry
    // directly by id rather than relying on `entries` (which is filtered by
    // activeCategory and may not include it), and switches the active category
    // tab to match so the page behind the modal isn't left showing an
    // unrelated filter. Strips the param once handled so a refresh or closing
    // and reopening the modal manually doesn't reopen it again.
    useEffect(() => {
        const editId = searchParams.get("edit");
        if (!editId) {
            return;
        }
        api.getVaultEntry(editId)
            .then((entry) => {
                setActiveCategory(entry.category);
                openEditModal(entry);
                setArrivedViaAlert(true);
            })
            .catch(() => toast.error("Could not find that Vault entry"))
            .finally(() => router.replace("/vault"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // ?open=add - deep link from the Guides pages straight into Add Entry,
    // rather than landing on Vault with a "now click Add Entry" instruction.
    // Same strip-the-param behaviour as ?edit= above.
    useEffect(() => {
        if (searchParams.get("open") !== "add") {
            return;
        }
        setIsAddOpen(true);
        router.replace("/vault");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const handleCategoryChange = (category: VaultCategory) => {
        setForm((f) => ({ ...f, category, ...categoryDefaults(category) }));
    };

    const buildTestConfig = (f: EntryFormState) => {
        const mode = categoryFieldMode(f.category);
        if (f.category === "ai") {
            return f.aiBaseUrl.trim() || f.aiModel.trim()
                ? { baseUrl: f.aiBaseUrl.trim() || undefined, model: f.aiModel.trim() || undefined }
                : undefined;
        }
        if (mode === "indexer") {
            return f.testUrl ? { url: f.testUrl } : undefined;
        }
        if (mode === "provider") {
            return f.testHost && f.testPort
                ? {
                      dataCapGB: f.testDataCap ? Number(f.testDataCap) : undefined,
                      host: f.testHost,
                      port: Number(f.testPort),
                      ssl: f.testSsl,
                  }
                : undefined;
        }
        // generic mode falls back to the manually-picked testType
        if (f.testType === "generic_http" || f.testType === "newznab_caps") {
            return f.testUrl ? { url: f.testUrl } : undefined;
        }
        if (f.testType === "tcp_reachability") {
            return f.testHost && f.testPort
                ? { host: f.testHost, port: Number(f.testPort) }
                : undefined;
        }
    };

    const handleSave = async () => {
        const mode = categoryFieldMode(form.category);

        if (!(form.name.trim() && form.category)) {
            toast.error("Name and category are required");
            return;
        }
        // Mode-specific required-field validation
        if (mode === "credentials" && !editingId && !(form.provider.trim() && form.secret.trim())) {
            toast.error("Email/username and password are required");
            return;
        }
        if (
            mode === "provider" &&
            !editingId &&
            !(
                form.testHost.trim() &&
                form.testPort.trim() &&
                form.secretUsername.trim() &&
                form.secret.trim()
            )
        ) {
            toast.error("Host, port, username, and password are required");
            return;
        }
        if (mode === "indexer" && !editingId && !(form.testUrl.trim() && form.secret.trim())) {
            toast.error("Newznab URL and API key are required");
            return;
        }
        if (mode === "generic" && !editingId && !form.secret.trim()) {
            toast.error("Secret is required");
            return;
        }

        setIsSaving(true);
        try {
            const payload: any = {
                category: form.category,
                cost:
                    form.cost.trim() !== "" && Number(form.cost) >= 0
                        ? Number(form.cost)
                        : undefined,
                costCycle: form.costCycle,
                dashboardUrl: form.dashboardUrl.trim() || undefined,
                expiresAt: form.expiresAt || undefined,
                name: form.name.trim(),
                notifyDaysBefore: form.notifyDaysBefore ? Number(form.notifyDaysBefore) : 3,
                secretLabel: form.secretLabel.trim() || "API Key",
                testConfig: buildTestConfig(form),
                testType: form.testType,
            };

            if (mode === "provider") {
                // Host/port already live in testConfig; provider field stays free for a friendly label
                payload.provider = form.provider.trim() || undefined;
                if (form.secretUsername.trim() || form.secret.trim()) {
                    payload.secret = JSON.stringify({
                        password: form.secret,
                        username: form.secretUsername.trim(),
                    });
                }
            } else {
                payload.provider = form.provider.trim() || undefined;
                if (form.secret.trim()) {
                    payload.secret = form.secret.trim();
                }
            }

            if (editingId) {
                const result = await api.updateVaultEntry(editingId, payload);
                // Rotation propagation ran (opt-in) and touched something - say
                // exactly what, since addon configs and user accounts just changed
                // as a side effect of saving a key.
                const aio = result?.rotation?.aioConfigsUpdated?.length || 0;
                const aioNote = aio ? `${aio} AIOStreams setup${aio === 1 ? "" : "s"}` : "";
                if (result?.rotation && result.rotation.addonsUpdated.length > 0) {
                    const r = result.rotation;
                    toast.success(
                        `Key rotated - updated ${r.addonsUpdated.length} addon${r.addonsUpdated.length === 1 ? "" : "s"}${aioNote ? `, ${aioNote}` : ""} and re-synced ${r.usersSynced} user${r.usersSynced === 1 ? "" : "s"}${r.userFailures.length ? ` (${r.userFailures.length} sync failure${r.userFailures.length === 1 ? "" : "s"} - see notifications)` : ""}`
                    );
                } else if (aioNote) {
                    toast.success(`Key rotated - updated ${aioNote}`);
                } else {
                    toast.success("Vault entry updated");
                }
            } else {
                await api.createVaultEntry(payload);
                toast.success("Vault entry added");
            }
            setIsAddOpen(false);
            load();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to save vault entry"));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (entry: VaultEntry) => {
        if (
            !confirm(
                `Delete "${entry.name}"? It goes to the Trash on the Tasks page and can be restored for 30 days.`
            )
        ) {
            return;
        }
        try {
            await api.deleteVaultEntry(entry.id);
            toast.success("Deleted");
            load();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to delete"));
        }
    };

    const handleMoveToAddons = async (entry: VaultEntry) => {
        if (!confirm(`Move "${entry.name}" to Addons? This removes it from the Vault.`)) {
            return;
        }
        setMovingToAddonsId(entry.id);
        try {
            const { secret } = await api.revealVaultSecret(entry.id);
            if (!(secret && /^https?:\/\//i.test(secret.trim()))) {
                toast.error(
                    "This entry's secret doesn't look like an addon manifest URL (must start with http:// or https://)"
                );
                return;
            }
            await api.createAddon({ manifestUrl: secret.trim(), name: entry.name });
            await api.deleteVaultEntry(entry.id);
            toast.success(`Moved "${entry.name}" to Addons`);
            load();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to move to Addons"));
        } finally {
            setMovingToAddonsId(null);
        }
    };

    const handleRecategorize = async (entry: VaultEntry, newCategory: string) => {
        if (entry.category === newCategory) {
            return;
        }
        // Optimistic update
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        try {
            await api.updateVaultEntry(entry.id, { category: newCategory as VaultCategory });
            toast.success(
                `Moved "${entry.name}" to ${CATEGORY_LABELS[newCategory as VaultCategory] || newCategory}`
            );
            load();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to recategorize"));
            load();
        }
    };

    // Register this page's drag-end logic with the layout-level DndContext —
    // it's the one that actually owns the DndContext (see AdminClientLayout),
    // since dragging onto the Sidebar's Addons link requires a context that
    // spans both the page and the sidebar.
    const { registerDragEndHandler } = useVaultDrag();
    useEffect(() => {
        const handleDragEnd = (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over) {
                return;
            }
            const entry = entries.find((e) => e.id === active.id);
            if (!entry) {
                return;
            }

            if (over.id === SIDEBAR_ADDONS_DROPZONE_ID) {
                handleMoveToAddons(entry);
                return;
            }

            if (typeof over.id === "string" && over.id.startsWith("vault-category-")) {
                const newCategory = over.id.replace("vault-category-", "");
                if (newCategory !== "all") {
                    handleRecategorize(entry, newCategory);
                }
                return;
            }

            // Otherwise: dropped on another entry card -> reorder within the same category
            if (active.id !== over.id) {
                const oldIndex = entries.findIndex((e) => e.id === active.id);
                const newIndex = entries.findIndex((e) => e.id === over.id);
                if (oldIndex === -1 || newIndex === -1) {
                    return;
                }
                const target = entries[newIndex];
                if (target.category !== entry.category) {
                    return; // don't reorder across categories
                }
                const reordered = arrayMove(entries, oldIndex, newIndex);
                setEntries(reordered);
                api.reorderVaultEntries(
                    entry.category,
                    reordered.filter((e) => e.category === entry.category).map((e) => e.id)
                ).catch((err: unknown) => {
                    toast.error(readErrorMessage(err, "Failed to save new order"));
                    load();
                });
            }
        };

        return registerDragEndHandler(handleDragEnd);
    }, [entries, registerDragEndHandler]);

    const handleTest = async (entry: VaultEntry) => {
        setTestingId(entry.id);
        try {
            const result = await api.testVaultEntry(entry.id);
            if (result.ok === true) {
                toast.success(`${entry.name}: ${result.message}`);
            } else if (result.ok === false) {
                toast.error(`${entry.name}: ${result.message}`);
            } else {
                toast(result.message);
            }
            load();
        } catch (err) {
            toast.error(readErrorMessage(err, "Test failed"));
        } finally {
            setTestingId(null);
        }
    };

    const handleReveal = async (entry: VaultEntry) => {
        if (revealed[entry.id]) {
            setRevealed((prev) => {
                const next = { ...prev };
                delete next[entry.id];
                return next;
            });
            return;
        }
        try {
            const result = await api.revealVaultSecret(entry.id);
            setRevealed((prev) => ({ ...prev, [entry.id]: result.secret }));
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to reveal secret"));
        }
    };

    // Lazy-fills the edit form's Secret field with the real stored value the
    // first time its eye icon is clicked to reveal (see Input's own
    // onRevealClick comment) - only when the field is still exactly the
    // placeholder-blank "leave empty to keep current" state, so it never
    // clobbers something the user already started typing to replace it with.
    const handleRevealInEditForm = async () => {
        if (!editingId || form.secret) {
            return;
        }
        try {
            const result = await api.revealVaultSecret(editingId);
            setForm((f) => ({ ...f, secret: result.secret }));
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to reveal secret"));
        }
    };

    // Copies the secret without requiring "Reveal" first - reuses whatever's
    // already revealed on screen if present, otherwise fetches it quietly
    // (never stores it into `revealed`, so the card stays masked).
    const handleCopy = async (entry: VaultEntry) => {
        try {
            const value = revealed[entry.id] ?? (await api.revealVaultSecret(entry.id)).secret;
            await copyToClipboard(value);
            toast.success("Copied to clipboard");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to copy"));
        }
    };

    // Silences the expiry-warning alert for 7 days without dismissing the
    // entry or touching its notifyDaysBefore setting - a check-failure alert
    // (something's actually broken right now) is a different signal and still
    // fires normally.
    const handleSnooze = async (entry: VaultEntry) => {
        try {
            const updated = await api.snoozeVaultEntry(entry.id);
            setEntries((prev) =>
                prev.map((e) =>
                    e.id === entry.id ? { ...e, snoozedUntil: updated.snoozedUntil } : e
                )
            );
            toast.success(`Snoozed "${entry.name}" for 7 days`);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to snooze"));
        }
    };

    const filterOptions = [
        ...Object.entries(VAULT_UI_CATEGORY_LABELS).map(([key, label]) => ({
            count: categoryCounts[key] || 0,
            key,
            label,
        })),
    ];

    const renderEntryCard = (
        entry: VaultEntry,
        dragHandleProps?: Record<string, unknown>,
        isDragging?: boolean
    ) => (
        <Card
            className={`flex h-full flex-col ${isDragging ? "scale-[1.01] shadow-lg shadow-primary/25" : ""}`}
            variant="bordered"
        >
            <div className="mb-3 flex items-start justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    {dragHandleProps && (
                        <button
                            aria-label="Drag to reorder"
                            type="button"
                            {...dragHandleProps}
                            className="-ml-1 shrink-0 cursor-grab rounded border-0 bg-transparent p-0 p-1 hover:bg-surface-hover active:cursor-grabbing"
                        >
                            <Bars3Icon
                                className="h-4 w-4"
                                style={{ color: "var(--color-text-muted)" }}
                            />
                        </button>
                    )}
                    <div className="min-w-0">
                        <h3
                            className="truncate font-semibold"
                            style={{ color: "var(--color-text)" }}
                        >
                            {entry.name}
                        </h3>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                            {CATEGORY_LABELS[entry.category]}
                            {entry.provider ? ` • ${entry.provider}` : ""}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge entry={entry} />
                    <ExpiryBadge entry={entry} />
                    {/* Only worth offering once the badge is actually alert-worthy
              (expired, or inside the warning window) and not already
              snoozed - a plain "12d left" badge has nothing to snooze. */}
                    {(() => {
                        const days = daysUntil(entry.expiresAt);
                        const alertWorthy =
                            days !== null && (days < 0 || days <= entry.notifyDaysBefore);
                        if (!alertWorthy || isSnoozed(entry)) {
                            return null;
                        }
                        const btn = (
                            <button
                                className="shrink-0"
                                onClick={() => handleSnooze(entry)}
                                style={{ color: "var(--color-text-muted)" }}
                                title="Snooze this expiry alert for 7 days"
                                type="button"
                            >
                                <BellSlashIcon className="h-3.5 w-3.5" />
                            </button>
                        );
                        return isTV ? (
                            <TVFocusable onEnterPress={() => handleSnooze(entry)}>
                                {btn}
                            </TVFocusable>
                        ) : (
                            btn
                        );
                    })()}
                </div>
            </div>

            <div
                className="mb-3 flex items-center justify-between gap-2 rounded-lg p-3"
                style={{ background: "var(--color-subtle)" }}
            >
                <code className="truncate text-xs" style={{ color: "var(--color-text)" }}>
                    {revealed[entry.id] || "••••••••••••••••"}
                </code>
                <div className="flex shrink-0 items-center gap-2">
                    {(() => {
                        const btn = (
                            <button
                                onClick={() => handleCopy(entry)}
                                style={{ color: "var(--color-text-muted)" }}
                                title="Copy to clipboard"
                                type="button"
                            >
                                <DocumentDuplicateIcon className="h-4 w-4" />
                            </button>
                        );
                        return isTV ? (
                            <TVFocusable onEnterPress={() => handleCopy(entry)}>{btn}</TVFocusable>
                        ) : (
                            btn
                        );
                    })()}
                    {(() => {
                        const btn = (
                            <button
                                aria-label={revealed[entry.id] ? "Hide value" : "Reveal value"}
                                onClick={() => handleReveal(entry)}
                                style={{ color: "var(--color-text-muted)" }}
                                title={revealed[entry.id] ? "Hide value" : "Reveal value"}
                                type="button"
                            >
                                {revealed[entry.id] ? (
                                    <EyeSlashIcon className="h-4 w-4" />
                                ) : (
                                    <EyeIcon className="h-4 w-4" />
                                )}
                            </button>
                        );
                        return isTV ? (
                            <TVFocusable onEnterPress={() => handleReveal(entry)}>
                                {btn}
                            </TVFocusable>
                        ) : (
                            btn
                        );
                    })()}
                </div>
            </div>

            {entry.lastCheckMessage && (
                <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {entry.lastCheckMessage}
                </p>
            )}

            <DebridUsageBadge
                entry={entry}
                onEntryUpdated={(id, patch) =>
                    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
                }
            />

            <BackupKeySelect
                allEntries={entries}
                entry={entry}
                onEntryUpdated={(id, patch) =>
                    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
                }
            />

            <div
                className="mt-auto flex flex-wrap items-center gap-2 pt-2"
                style={{ borderTop: "1px solid var(--color-surface-border)" }}
            >
                {(() => {
                    const btn = (
                        <button
                            className="rounded-lg p-2 transition-colors disabled:opacity-40"
                            disabled={testingId === entry.id || entry.testType === "manual"}
                            onClick={() => handleTest(entry)}
                            style={{ background: "var(--color-surface-hover)" }}
                            title={
                                entry.testType === "manual"
                                    ? "No automated check configured"
                                    : "Run check now"
                            }
                            type="button"
                        >
                            <ArrowPathIcon
                                className={`h-4 w-4 ${testingId === entry.id ? "animate-spin" : ""}`}
                                style={{ color: "var(--color-text)" }}
                            />
                        </button>
                    );
                    return isTV && entry.testType !== "manual" ? (
                        <TVFocusable onEnterPress={() => handleTest(entry)}>{btn}</TVFocusable>
                    ) : (
                        btn
                    );
                })()}
                {(() => {
                    const btn = (
                        <button
                            aria-label="Edit"
                            className="rounded-lg p-2 transition-colors"
                            onClick={() => openEditModal(entry)}
                            style={{ background: "var(--color-surface-hover)" }}
                            title="Edit"
                            type="button"
                        >
                            <PencilIcon
                                className="h-4 w-4"
                                style={{ color: "var(--color-text)" }}
                            />
                        </button>
                    );
                    return isTV ? (
                        <TVFocusable onEnterPress={() => openEditModal(entry)}>{btn}</TVFocusable>
                    ) : (
                        btn
                    );
                })()}
                {entry.dashboardUrl &&
                    (() => {
                        const link = (
                            <a
                                className="rounded-lg p-2 transition-colors"
                                href={entry.dashboardUrl}
                                rel="noreferrer"
                                style={{ background: "var(--color-surface-hover)" }}
                                target="_blank"
                            >
                                <ArrowTopRightOnSquareIcon
                                    className="h-4 w-4"
                                    style={{ color: "var(--color-text)" }}
                                />
                            </a>
                        );
                        return isTV ? (
                            <TVFocusable
                                onEnterPress={() =>
                                    window.open(
                                        entry.dashboardUrl || undefined,
                                        "_blank",
                                        "noopener,noreferrer"
                                    )
                                }
                            >
                                {link}
                            </TVFocusable>
                        ) : (
                            link
                        );
                    })()}
                {(() => {
                    const btn = (
                        <button
                            className="rounded-lg p-2 transition-colors disabled:opacity-40"
                            disabled={movingToAddonsId === entry.id}
                            onClick={() => handleMoveToAddons(entry)}
                            style={{ background: "var(--color-surface-hover)" }}
                            title="Move to Addons"
                            type="button"
                        >
                            <PuzzlePieceIcon
                                className="h-4 w-4"
                                style={{ color: "var(--color-text)" }}
                            />
                        </button>
                    );
                    return isTV ? (
                        <TVFocusable onEnterPress={() => handleMoveToAddons(entry)}>
                            {btn}
                        </TVFocusable>
                    ) : (
                        btn
                    );
                })()}
                {(() => {
                    const btn = (
                        <button
                            aria-label="Delete"
                            className="ml-auto rounded-lg p-2 transition-colors"
                            onClick={() => handleDelete(entry)}
                            style={{ background: "var(--color-surface-hover)" }}
                            title="Delete"
                            type="button"
                        >
                            <TrashIcon
                                className="h-4 w-4"
                                style={{ color: "var(--color-error)" }}
                            />
                        </button>
                    );
                    return isTV ? (
                        <TVFocusable onEnterPress={() => handleDelete(entry)}>{btn}</TVFocusable>
                    ) : (
                        btn
                    );
                })()}
            </div>
        </Card>
    );

    return (
        <Wrapper>
            <Head>
                <title>SlickSync - Vault</title>
            </Head>
            {layoutMode !== "nebula" && (
                <Header
                    actions={
                        <Button
                            leftIcon={<PlusIcon className="h-5 w-5" />}
                            onClick={openAddModal}
                            variant="primary"
                        >
                            Add Entry
                        </Button>
                    }
                    subtitle={
                        isLoading ? "Loading..." : `${total} ${total === 1 ? "entry" : "entries"}`
                    }
                    title="Vault"
                />
            )}

            <div
                className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "px-4 pb-6 md:px-6"}
            >
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={
                        layoutMode === "nebula"
                            ? { maxWidth: "var(--interface-content-width)" }
                            : undefined
                    }
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            actions={(() => {
                                const btn = (
                                    <Button
                                        leftIcon={<PlusIcon className="h-5 w-5" />}
                                        onClick={openAddModal}
                                        variant="primary"
                                    >
                                        Add Entry
                                    </Button>
                                );
                                return isTV ? (
                                    <TVFocusable onEnterPress={openAddModal}>{btn}</TVFocusable>
                                ) : (
                                    btn
                                );
                            })()}
                            subtitle={
                                isLoading
                                    ? "Loading..."
                                    : `${total} ${total === 1 ? "entry" : "entries"}`
                            }
                            title="Vault"
                        />
                    )}
                    {/* Cost summary - only once at least one entry has a cost set. Debrid,
          usenet, and every other category count equally; whatever you tagged
          with a cost is in the total. Monthly and yearly-billed entries are
          normalized before summing. */}
                    {trackedCount > 0 && (
                        <>
                            <div className="mb-2 flex items-center justify-end">
                                <label
                                    className="mr-2 text-muted text-xs"
                                    htmlFor={`${accessibleFieldId1}-1`}
                                >
                                    Currency
                                </label>
                                {/* Explicit narrow width - the shared input-base class forces
                width:100%, which stretched this three-letter selector across
                the whole page. */}
                                <select
                                    className="input-base rounded-lg px-2 py-1 text-xs"
                                    id={`${accessibleFieldId1}-1`}
                                    onChange={(e) => handleCurrencyChange(e.target.value)}
                                    style={{ width: "6rem" }}
                                    title="Currency for all cost figures"
                                    value={currency}
                                >
                                    {CURRENCY_OPTIONS.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-4">
                                {[
                                    {
                                        icon: <BanknotesIcon className="h-4 w-4 md:h-6 md:w-6" />,
                                        label: `Monthly Spend · ${trackedCount} service${trackedCount === 1 ? "" : "s"}`,
                                        value: fmtMoney(monthlyTotal),
                                    },
                                    {
                                        icon: <CreditCardIcon className="h-4 w-4 md:h-6 md:w-6" />,
                                        label: "Yearly",
                                        value: fmtMoney(monthlyTotal * 12),
                                    },
                                    {
                                        icon: <ClockIcon className="h-4 w-4 md:h-6 md:w-6" />,
                                        label:
                                            costPerHour === null
                                                ? "Per Hour Watched"
                                                : "Per Hour Watched (30d)",
                                        value: costPerHour === null ? "—" : fmtMoney(costPerHour),
                                    },
                                ].map((s, i) => {
                                    const isPrimary = i % 2 === 0;
                                    return (
                                        <div
                                            className={`${NEBULA_GLASS_CLASS} flex min-w-0 items-center gap-2 p-2.5 sm:p-3 md:gap-4 md:p-5`}
                                            key={s.label}
                                            style={nebulaGlassStyle}
                                        >
                                            <NebulaGlassStripe />
                                            <div
                                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg md:h-11 md:w-11 md:rounded-xl"
                                                style={{
                                                    background: isPrimary
                                                        ? "var(--color-primary-muted)"
                                                        : "var(--color-secondary-muted)",
                                                    color: isPrimary
                                                        ? "var(--color-primary)"
                                                        : "var(--color-secondary)",
                                                }}
                                            >
                                                {s.icon}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="truncate font-bold font-display text-base text-default leading-none sm:text-lg md:text-3xl">
                                                    {s.value}
                                                </p>
                                                <p className="mt-1 truncate text-[10px] text-muted md:text-sm">
                                                    {s.label}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {upcomingRenewals.length > 0 && (
                                <div
                                    className={`${NEBULA_GLASS_CLASS} mb-4 p-4 sm:p-5`}
                                    style={nebulaGlassStyle}
                                >
                                    <NebulaGlassStripe />
                                    <button
                                        className="flex w-full items-center gap-2 text-left"
                                        onClick={() => setRenewalExpanded((v) => !v)}
                                        type="button"
                                    >
                                        <CalendarDaysIcon
                                            className="h-5 w-5 shrink-0"
                                            style={{ color: "var(--color-primary)" }}
                                        />
                                        <h3 className="flex-1 font-semibold text-default text-sm">
                                            Next {FORECAST_WINDOW_DAYS} days:{" "}
                                            {fmtMoney(forecastTotal)} across{" "}
                                            {upcomingRenewals.length} renewal
                                            {upcomingRenewals.length === 1 ? "" : "s"}
                                        </h3>
                                        <ChevronDownIcon
                                            className="h-4 w-4 shrink-0 transition-transform"
                                            style={{
                                                color: "var(--color-text-muted)",
                                                transform: renewalExpanded
                                                    ? "rotate(180deg)"
                                                    : undefined,
                                            }}
                                        />
                                    </button>
                                    {renewalExpanded && (
                                        <div
                                            className="mt-3 max-h-48 space-y-1.5 overflow-y-auto pt-3"
                                            style={{
                                                borderTop: "1px solid var(--color-surface-border)",
                                            }}
                                        >
                                            {upcomingRenewals.map((r, i) => {
                                                const days = Math.max(
                                                    0,
                                                    Math.round(
                                                        (r.date.getTime() - Date.now()) /
                                                            (1000 * 60 * 60 * 24)
                                                    )
                                                );
                                                return (
                                                    <div
                                                        className="flex items-center justify-between py-1 text-xs"
                                                        key={`${r.entryId}-${i}`}
                                                    >
                                                        <span className="truncate text-default">
                                                            {r.name}
                                                        </span>
                                                        <span className="ml-2 shrink-0 text-muted">
                                                            {days === 0 ? "today" : `in ${days}d`} ·{" "}
                                                            {fmtMoney(r.amount)}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    <div className="interface-management-content">
                        {layoutMode === "nebula" && <NebulaGlassStripe />}
                        <div className="mb-5">
                            <FilterTabsResponsive
                                activeKey={activeCategory}
                                enableDropTargets
                                fill
                                layoutId="vault-filter"
                                onChange={setActiveCategory}
                                options={filterOptions}
                            />
                        </div>

                        {isLoading ? (
                            <div
                                className="py-16 text-center"
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                Loading vault...
                            </div>
                        ) : entries.length === 0 ? (
                            <EmptyState
                                action={
                                    <Button onClick={openAddModal} variant="primary">
                                        Add your first entry
                                    </Button>
                                }
                                description="Keep track of accounts, renewal dates, and credentials, with a reminder before anything expires."
                                icon={<ShieldCheckIcon className="h-6 w-6" />}
                                title="Everything important, in one place"
                            />
                        ) : (
                            <>
                                <p
                                    className="mb-3 text-xs"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    Drag the handle to reorder within a category, drop onto a
                                    category tab above to recategorize, or drop onto "Addons" in the
                                    sidebar to move it there.
                                </p>
                                <SortableContext
                                    items={entries.map((e) => e.id)}
                                    strategy={rectSortingStrategy}
                                >
                                    <StaggerContainer className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                                        {entries.map((entry) => (
                                            <StaggerItem key={entry.id}>
                                                <SortableEntryCard
                                                    entry={entry}
                                                    onDelete={handleDelete}
                                                    onEdit={openEditModal}
                                                    onMoveToAddons={handleMoveToAddons}
                                                    onTest={handleTest}
                                                    renderEntryCard={renderEntryCard}
                                                />
                                            </StaggerItem>
                                        ))}
                                    </StaggerContainer>
                                </SortableContext>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Add/Edit Modal */}
            <Modal
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                size="lg"
                title={editingId ? "Edit Vault Entry" : "Add Vault Entry"}
            >
                <div className="space-y-4">
                    {arrivedViaAlert && form.dashboardUrl && (
                        <button
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors"
                            onClick={() =>
                                window.open(form.dashboardUrl, "_blank", "noopener,noreferrer")
                            }
                            style={{
                                background: "var(--color-primaryMuted)",
                                border: "1px solid var(--color-primary)",
                            }}
                            type="button"
                        >
                            <span
                                className="font-medium text-sm"
                                style={{ color: "var(--color-primary)" }}
                            >
                                Get the new value from the provider, then paste it below
                            </span>
                            <ArrowTopRightOnSquareIcon
                                className="h-4 w-4 shrink-0"
                                style={{ color: "var(--color-primary)" }}
                            />
                        </button>
                    )}
                    <Input
                        label="Name"
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Newshosting account"
                        value={form.name}
                    />

                    <div>
                        <label
                            className="mb-2 block font-medium text-sm"
                            htmlFor={`${fieldId1}-2`}
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            Category
                        </label>
                        <select
                            className="w-full rounded-xl px-4 py-3 focus:outline-none"
                            id={`${fieldId1}-2`}
                            onChange={(e) => handleCategoryChange(e.target.value as VaultCategory)}
                            style={{
                                background: "var(--color-surface-hover)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            value={form.category}
                        >
                            {Object.entries(VAULT_UI_CATEGORY_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {categoryFieldMode(form.category) === "credentials" && (
                        <>
                            <p
                                className="-mt-2 text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                Stored credentials are validated by logging into{" "}
                                {form.category === "nuvio" ? "Nuvio" : "Stremio"} directly when you
                                hit Test.
                            </p>
                            <Input
                                label="Email or Username"
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, provider: e.target.value }))
                                }
                                placeholder="you@example.com"
                                value={form.provider}
                            />
                            <Input
                                label={
                                    editingId
                                        ? "Password (leave blank to keep current)"
                                        : "Password"
                                }
                                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                                onRevealClick={editingId ? handleRevealInEditForm : undefined}
                                placeholder={editingId ? "••••••••" : "Account password"}
                                type="password"
                                value={form.secret}
                            />
                        </>
                    )}

                    {categoryFieldMode(form.category) === "indexer" && (
                        <>
                            <Input
                                label="Newznab URL"
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, testUrl: e.target.value }))
                                }
                                placeholder="https://indexer.example.com"
                                value={form.testUrl}
                            />
                            <Input
                                label={
                                    editingId ? "API Key (leave blank to keep current)" : "API Key"
                                }
                                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                                onRevealClick={editingId ? handleRevealInEditForm : undefined}
                                placeholder={editingId ? "••••••••" : "Indexer API key"}
                                type="password"
                                value={form.secret}
                            />
                        </>
                    )}

                    {categoryFieldMode(form.category) === "provider" && (
                        <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Input
                                    label="Host"
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, testHost: e.target.value }))
                                    }
                                    placeholder="news.example.com"
                                    value={form.testHost}
                                />
                                <Input
                                    label="Port"
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, testPort: e.target.value }))
                                    }
                                    placeholder="563"
                                    value={form.testPort}
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Input
                                    label="Username"
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, secretUsername: e.target.value }))
                                    }
                                    placeholder="Account username"
                                    value={form.secretUsername}
                                />
                                <Input
                                    label={
                                        editingId
                                            ? "Password (leave blank to keep current)"
                                            : "Password"
                                    }
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, secret: e.target.value }))
                                    }
                                    onRevealClick={editingId ? handleRevealInEditForm : undefined}
                                    placeholder={editingId ? "••••••••" : "Account password"}
                                    type="password"
                                    value={form.secret}
                                />
                            </div>
                            <div
                                className="flex items-center justify-between rounded-xl p-3"
                                style={{ background: "var(--color-subtle)" }}
                            >
                                <span className="text-sm" style={{ color: "var(--color-text)" }}>
                                    Use SSL
                                </span>
                                <ToggleSwitch
                                    checked={form.testSsl}
                                    onChange={() => setForm((f) => ({ ...f, testSsl: !f.testSsl }))}
                                />
                            </div>
                            <Input
                                label="Data cap in GB (optional)"
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, testDataCap: e.target.value }))
                                }
                                placeholder="Leave blank for no cap"
                                value={form.testDataCap}
                            />
                        </>
                    )}

                    {categoryFieldMode(form.category) === "generic" && (
                        <>
                            <Input
                                label="Provider (optional)"
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, provider: e.target.value }))
                                }
                                placeholder="e.g. Newshosting, Real-Debrid"
                                value={form.provider}
                            />
                            <Input
                                label="Secret label"
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, secretLabel: e.target.value }))
                                }
                                placeholder="API Key"
                                value={form.secretLabel}
                            />
                            <Input
                                label={
                                    editingId ? "Secret (leave blank to keep current)" : "Secret"
                                }
                                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                                onRevealClick={editingId ? handleRevealInEditForm : undefined}
                                placeholder={
                                    editingId ? "••••••••" : "Paste API key / password / token"
                                }
                                type="password"
                                value={form.secret}
                            />

                            {form.category === "ai" ? (
                                // No automated checker exists for an LLM key (unlike the other
                                // generic-mode categories) - these two feed natural-language
                                // Catalogs (server/utils/nlCatalog.js) directly instead of a
                                // check config. Both optional: blank means OpenAI's default
                                // endpoint + a small fast model.
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <Input
                                        label="API base URL (optional)"
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, aiBaseUrl: e.target.value }))
                                        }
                                        placeholder="https://api.openai.com/v1"
                                        value={form.aiBaseUrl}
                                    />
                                    <Input
                                        label="Model (optional)"
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, aiModel: e.target.value }))
                                        }
                                        placeholder="gpt-4o-mini"
                                        value={form.aiModel}
                                    />
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label
                                            className="mb-2 block font-medium text-sm"
                                            htmlFor={`${fieldId1}-3`}
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            Active check
                                        </label>
                                        <select
                                            className="w-full rounded-xl px-4 py-3 focus:outline-none"
                                            id={`${fieldId1}-3`}
                                            onChange={(e) =>
                                                setForm((f) => ({
                                                    ...f,
                                                    testType: e.target.value as VaultTestType,
                                                }))
                                            }
                                            style={{
                                                background: "var(--color-surface-hover)",
                                                border: "1px solid var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            value={form.testType}
                                        >
                                            {Object.entries(TEST_TYPE_LABELS).map(
                                                ([key, label]) => (
                                                    <option key={key} value={key}>
                                                        {label}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                    </div>

                                    {(form.testType === "generic_http" ||
                                        form.testType === "newznab_caps") && (
                                        <Input
                                            label="Test URL"
                                            onChange={(e) =>
                                                setForm((f) => ({ ...f, testUrl: e.target.value }))
                                            }
                                            placeholder="https://..."
                                            value={form.testUrl}
                                        />
                                    )}
                                    {form.testType === "tcp_reachability" && (
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <Input
                                                label="Host"
                                                onChange={(e) =>
                                                    setForm((f) => ({
                                                        ...f,
                                                        testHost: e.target.value,
                                                    }))
                                                }
                                                placeholder="news.example.com"
                                                value={form.testHost}
                                            />
                                            <Input
                                                label="Port"
                                                onChange={(e) =>
                                                    setForm((f) => ({
                                                        ...f,
                                                        testPort: e.target.value,
                                                    }))
                                                }
                                                placeholder="563"
                                                value={form.testPort}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    <Input
                        label={
                            form.category === "aiostreams"
                                ? "UUID (optional)"
                                : "Dashboard URL (optional)"
                        }
                        onChange={(e) => setForm((f) => ({ ...f, dashboardUrl: e.target.value }))}
                        placeholder={
                            form.category === "aiostreams"
                                ? "e.g. 00000000-0000-4000-8000-000000000000"
                                : "https://provider.com/dashboard"
                        }
                        value={form.dashboardUrl}
                    />

                    <div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Input
                                id={`${accessibleFieldId1}-2`}
                                label="Cost (optional)"
                                onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                                placeholder="e.g. 5.00"
                                type="number"
                                value={form.cost}
                            />
                            <div>
                                <label
                                    className="mb-2 block font-medium text-sm"
                                    htmlFor={`${accessibleFieldId1}-2`}
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    Billed
                                </label>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={() =>
                                            setForm((f) => ({ ...f, costCycle: "monthly" }))
                                        }
                                        size="sm"
                                        type="button"
                                        variant={
                                            form.costCycle === "monthly" ? "primary" : "secondary"
                                        }
                                    >
                                        Monthly
                                    </Button>
                                    <Button
                                        onClick={() =>
                                            setForm((f) => ({ ...f, costCycle: "yearly" }))
                                        }
                                        size="sm"
                                        type="button"
                                        variant={
                                            form.costCycle === "yearly" ? "primary" : "secondary"
                                        }
                                    >
                                        Yearly
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <p className="mt-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                            Feeds the cost/hour summary at the top of the Vault. Set the currency
                            there.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                            label="Expires on (optional)"
                            onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                            type="date"
                            value={form.expiresAt}
                        />
                        <Input
                            label="Notify days before"
                            onChange={(e) =>
                                setForm((f) => ({ ...f, notifyDaysBefore: e.target.value }))
                            }
                            type="number"
                            value={form.notifyDaysBefore}
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            className="flex-1 rounded-xl py-3 font-medium text-sm transition-colors"
                            onClick={() => setIsAddOpen(false)}
                            style={{
                                background: "var(--color-surface-hover)",
                                color: "var(--color-text)",
                            }}
                            type="button"
                        >
                            Cancel
                        </button>
                        <Button
                            className="flex-1"
                            isLoading={isSaving}
                            onClick={handleSave}
                            variant="primary"
                        >
                            {editingId ? "Save Changes" : "Add Entry"}
                        </Button>
                    </div>
                </div>
            </Modal>
        </Wrapper>
    );
}

export default function VaultPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
            }
        >
            <VaultPageContent />
        </Suspense>
    );
}
