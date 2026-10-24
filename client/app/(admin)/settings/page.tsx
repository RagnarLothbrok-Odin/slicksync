"use client";

import {
    ArrowPathIcon,
    ArrowTopRightOnSquareIcon,
    BellIcon,
    CheckIcon,
    ChevronRightIcon,
    ClipboardDocumentIcon,
    CogIcon,
    ComputerDesktopIcon,
    DevicePhoneMobileIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    EyeSlashIcon,
    FingerPrintIcon,
    GlobeAltIcon,
    InformationCircleIcon,
    KeyIcon,
    PencilIcon,
    ShieldCheckIcon,
    SparklesIcon,
    Squares2X2Icon,
    SwatchIcon,
    TrashIcon,
    UserCircleIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { AvatarPickerModal } from "@/components/modals/AvatarPickerModal";
import { openOnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { AboutPanel } from "@/components/settings/AboutPanel";
import { LumiereDbField } from "@/components/settings/LumiereDbField";
import { ProfilePictureSettings } from "@/components/settings/ProfilePictureSettings";
import { SettingRow, ToggleSwitch } from "@/components/settings/SettingRow";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import { ShortcutRecipes } from "@/components/settings/ShortcutRecipes";
import { ThemesPanel } from "@/components/settings/ThemesPanel";
import { WatchTrackingSettings } from "@/components/settings/WatchTrackingSettings";
import {
    Badge,
    Button,
    Card,
    ComboBox,
    ConfirmModal,
    Modal,
    ProviderKeyHealthBadge,
    ProviderKeyHealthUnchecked,
} from "@/components/ui";
import { PushNotificationToggle } from "@/components/ui/PushNotificationToggle";
import { showToast, toast } from "@/components/ui/Toast";
import {
    type AccountStats,
    api,
    type PasskeyRow,
    type PushDevice,
    type SyncSettings,
} from "@/lib/api";
import { isBeginnerMode, setBeginnerMode as setBeginnerModePref } from "@/lib/beginnerMode";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage, readErrorName } from "@/lib/errors";
import { invalidatePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { useLayoutMode } from "@/lib/layout-mode";
import { SETTINGS_INDEX } from "@/lib/settingsIndex";
import { useTheme } from "@/lib/theme";

// Small curated fallback for environments without Intl.supportedValuesOf
// ('timeZone') - a fairly recent addition (Baseline 2023), not guaranteed
// everywhere this might render (including Next.js server-side rendering on
// an older Node build).
const FALLBACK_TIMEZONES = [
    "UTC",
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Moscow",
    "Africa/Cairo",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Sydney",
    "Pacific/Auckland",
];

function getSupportedTimezones(): string[] {
    try {
        if (typeof Intl.supportedValuesOf === "function") {
            return Intl.supportedValuesOf("timeZone");
        }
    } catch {
        // fall through to the curated list below
    }
    return FALLBACK_TIMEZONES;
}

const TIMEZONES = getSupportedTimezones();

// Best-effort friendly guess from a stored User-Agent string, for a device
// that's never been given a custom label. Rough on purpose - this is a
// fallback shown alongside a rename control, not a full UA parser.
function guessDeviceName(userAgent: string | null): string {
    if (!userAgent) {
        return "Unknown device";
    }
    const ua = userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    const isMac = /Macintosh/.test(ua);
    const isWindows = /Windows/.test(ua);
    const browser = /Firefox/.test(ua)
        ? "Firefox"
        : /Edg\//.test(ua)
          ? "Edge"
          : /Chrome/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "Browser";
    if (isIOS) {
        return `${/iPad/.test(ua) ? "iPad" : "iPhone"} - ${browser}`;
    }
    if (isAndroid) {
        return `Android - ${browser}`;
    }
    if (isMac) {
        return `Mac - ${browser}`;
    }
    if (isWindows) {
        return `Windows - ${browser}`;
    }
    return browser;
}

function isMobileDevice(userAgent: string | null): boolean {
    return !!userAgent && /iPhone|iPad|iPod|Android/.test(userAgent);
}

function formatLastSeen(dateStr: string | null): string {
    if (!dateStr) {
        return "Never notified";
    }
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffMins < 1) {
        return "Active just now";
    }
    if (diffMins < 60) {
        return `Active ${diffMins}m ago`;
    }
    if (diffHours < 24) {
        return `Active ${diffHours}h ago`;
    }
    return `Active ${diffDays}d ago`;
}

// Toggle switch component
// Locates the on-page element for a settings deep-link target: exact
// data-setting match first (every SettingRow), then a text scan over the
// labelled blocks and section headers that aren't SettingRows. Returns the
// enclosing box so the flash outlines something meaningful, not bare text.
function findSettingElement(target: string): HTMLElement | null {
    const exact = document.querySelector(`[data-setting="${CSS.escape(target)}"]`);
    if (exact) {
        return exact as HTMLElement;
    }
    const t = target.trim().toLowerCase();
    for (const el of Array.from(document.querySelectorAll("label, h3, p"))) {
        const txt = (el.textContent || "").trim().toLowerCase();
        if (txt === t || txt.startsWith(t)) {
            return (el.closest("div") || el) as HTMLElement;
        }
    }
    return null;
}

// Suggestions for the AI Services ComboBoxes below - never the only valid
// values (both still take arbitrary text), just the common cases someone
// shouldn't have to remember/retype from a provider's docs.
const AI_BASE_URL_OPTIONS = [
    { label: "OpenAI", value: "https://api.openai.com/v1" },
    { label: "OpenRouter", value: "https://openrouter.ai/api/v1" },
    { label: "Groq", value: "https://api.groq.com/openai/v1" },
    { label: "Google Gemini", value: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { label: "DeepSeek", value: "https://api.deepseek.com" },
];
// Keyed by base URL, NOT one flat combined list - a model name only means
// something in the context of which endpoint it's sent to (OpenRouter's
// "google/gemini-2.0-flash-001" slug format vs Google's own native
// "gemini-2.0-flash" are genuinely different strings for effectively the
// same model), and a flat list let someone pick a Google-formatted URL
// alongside an OpenRouter-formatted model with nothing stopping the
// mismatch - confirmed real case, a user did exactly that and got a 404
// with no clue why until the AI Services error surfacing was added. Now
// the model list itself narrows to only what actually works with whatever
// base URL is currently selected.
const AI_MODEL_OPTIONS_BY_PROVIDER: Record<string, { value: string; label: string }[]> = {
    "https://api.deepseek.com": [{ label: "DeepSeek Chat", value: "deepseek-chat" }],
    "https://api.groq.com/openai/v1": [
        { label: "Llama 4 Scout", value: "llama-4-scout-17b-16e-instruct" },
        { label: "Llama 4 Maverick", value: "llama-4-maverick-17b-128e-instruct" },
        { label: "GPT-OSS 120B", value: "openai/gpt-oss-120b" },
    ],
    "https://api.openai.com/v1": [
        { label: "gpt-5.2-mini", value: "gpt-5.2-mini" },
        { label: "gpt-5.2-chat-latest", value: "gpt-5.2-chat-latest" },
        { label: "gpt-5.4-mini", value: "gpt-5.4-mini" },
    ],
    "https://generativelanguage.googleapis.com/v1beta/openai": [
        { label: "Gemini 3.7 Flash (latest)", value: "gemini-3.7-flash" },
        { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
        { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
    ],
    "https://openrouter.ai/api/v1": [
        { label: "GPT-5.2 mini", value: "openai/gpt-5.2-mini" },
        { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3.5-sonnet" },
        { label: "Gemini 3.7 Flash", value: "google/gemini-3.7-flash" },
        { label: "Llama 4 Scout", value: "meta-llama/llama-4-scout" },
    ],
};
// Fallback for a custom/unrecognized base URL (a local proxy, something not
// in the preset list) - can't narrow to a known-correct set, so show
// everything rather than nothing.
const AI_MODEL_OPTIONS_ALL = Object.values(AI_MODEL_OPTIONS_BY_PROVIDER).flat();

// Optional failover key paired with one of the four metadata providers.
// Only offered once a primary key exists (a backup with nothing to back up
// is just a confusing second box), and collapsed behind a link until asked
// for, so the common one-key setup looks exactly as it always did.
// The backup is used only when the health check has actually found the
// primary failing or rate-limited - see server/utils/listImport.js.

// Key Pool editor - extra keys beyond the primary/backup pair. Same compact
// chip-then-expand pattern as BackupKeyField above (and the same click-away
// collapse), because the page's sizing complaints were heard: nothing here
// takes space until asked for. With any pool keys present, lookups rotate
// across every healthy key instead of hammering the primary - three free
// MDBList keys become one pooled allowance.
function PoolKeysField({
    field,
    keys,
    primaryFilled,
    onSave,
}: {
    field: string;
    keys: string[];
    primaryFilled: boolean;
    onSave: (next: string[]) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("touchstart", onPointerDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("touchstart", onPointerDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (!primaryFilled) {
        return null;
    }

    const commit = async (next: string[]) => {
        setSaving(true);
        try {
            await onSave(next);
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button
                className={`ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${keys.length > 0 ? "keyset-on" : "keyset-off"}`}
                onClick={() => setOpen(true)}
                type="button"
            >
                <Squares2X2Icon className="h-3.5 w-3.5" />
                {keys.length > 0 ? `Key pool (${keys.length})` : "Add key pool"}
            </button>
        );
    }

    return (
        <div
            className="mt-2 inline-block rounded-lg p-2.5 align-top"
            ref={wrapRef}
            style={{
                background: "var(--color-surface-hover)",
                border: "1px solid var(--color-surface-border)",
                maxWidth: "22rem",
            }}
        >
            <p className="mb-1.5 text-[11px]" style={{ color: "var(--color-text-subtle)" }}>
                Extra keys - lookups rotate across every healthy key, spreading the quota
            </p>
            {keys.map((k, i) => (
                <div className="mb-1 flex items-center gap-1.5" key={`${k}-${i}`}>
                    <code
                        className="flex-1 truncate text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                    >
                        {"\u2022".repeat(6)}
                        {k.slice(-4)}
                    </code>
                    <button
                        aria-label="Remove this key"
                        className="shrink-0 rounded p-1 transition-colors"
                        disabled={saving}
                        onClick={() => commit(keys.filter((_, idx) => idx !== i))}
                        style={{ color: "var(--color-text-muted)" }}
                        title="Remove this key"
                        type="button"
                    >
                        <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                </div>
            ))}
            <div className="mt-1.5 flex items-center gap-1.5">
                <input
                    autoComplete="off"
                    autoFocus
                    className="input-base w-52 px-2 py-1 text-xs"
                    data-field={field}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && draft.trim()) {
                            commit([...keys, draft.trim()]);
                            setDraft("");
                        }
                    }}
                    placeholder="Paste a key, press Enter"
                    spellCheck={false}
                    type="text"
                    value={draft}
                />
            </div>
        </div>
    );
}

function BackupKeyField({
    field,
    value,
    primaryFilled,
    onChange,
    onSave,
}: {
    field: string;
    value: string;
    primaryFilled: boolean;
    onChange: (v: string) => void;
    onSave: () => void;
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const hasValue = !!value.trim();

    // Collapses when focus or a click goes elsewhere on the page. This is a
    // secondary field most people never touch, so leaving it expanded until
    // manually closed just left clutter behind on a page that already has a
    // lot of it. The input's own onBlur saves first, so collapsing never
    // discards a value that was being typed.
    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("touchstart", onPointerDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("touchstart", onPointerDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (!primaryFilled) {
        return null;
    }

    return (
        <div className="mt-1.5" ref={wrapRef}>
            {open ? (
                <div className="inline-flex max-w-full items-center gap-1.5">
                    <input
                        autoComplete="off"
                        autoFocus
                        className="input-base w-56 max-w-full px-2.5 py-1.5 text-xs"
                        data-field={field}
                        onBlur={onSave}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Backup key"
                        spellCheck={false}
                        type="text"
                        value={value}
                    />
                    {hasValue && (
                        <button
                            aria-label="Remove backup key"
                            className="shrink-0 rounded-md p-1.5 transition-colors"
                            onClick={() => {
                                onChange("");
                                setTimeout(onSave, 0);
                            }}
                            style={{ color: "var(--color-text-muted)" }}
                            title="Remove backup key"
                            type="button"
                        >
                            <XMarkIcon className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <span
                        className="shrink-0 text-[11px]"
                        style={{ color: "var(--color-text-subtle)" }}
                    >
                        used if the key above fails
                    </span>
                </div>
            ) : (
                // Sized to its content rather than the full panel width - it is a
                // secondary control and should not read as another key field.
                <button
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${hasValue ? "keyset-ok" : "keyset-off"}`}
                    onClick={() => setOpen(true)}
                    type="button"
                >
                    <ShieldCheckIcon className="h-3.5 w-3.5" />
                    {hasValue ? "Backup key set" : "Add backup key"}
                </button>
            )}
        </div>
    );
}

// Settings had grown to eleven stacked sections and roughly 2,600 lines of
// page - long enough that finding one toggle meant scrolling past everything
// else (user feedback). Same settings, grouped, one group on screen at a
// time. Deep links from the command palette still land on the exact control:
// SETTINGS_TABS_BY_SECTION maps the palette's own section labels onto these
// tabs so the page can switch before it scrolls.
const SETTINGS_TABS = [
    { blurb: "Profile, privacy, timezone", icon: UserCircleIcon, key: "general", label: "General" },
    { blurb: "Colours, layout, custom builds", icon: SwatchIcon, key: "themes", label: "Themes" },
    { blurb: "How addons are pushed", icon: ArrowPathIcon, key: "sync", label: "Sync" },
    {
        blurb: "Push, bell, Discord, digest",
        icon: BellIcon,
        key: "notifications",
        label: "Notifications",
    },
    { blurb: "SlickTrax and Discover", icon: SparklesIcon, key: "features", label: "Features" },
    { blurb: "API keys and scrobbling", icon: KeyIcon, key: "integrations", label: "Integrations" },
    {
        blurb: "2FA, account, danger zone",
        icon: ShieldCheckIcon,
        key: "security",
        label: "Security",
    },
    { blurb: "Credits, data, privacy", icon: InformationCircleIcon, key: "about", label: "About" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

const SETTINGS_TABS_BY_SECTION: Record<string, SettingsTab> = {
    Account: "security",
    "External API Keys": "integrations",
    Notifications: "notifications",
    "Privacy & Display": "general",
    "Scrobble API": "integrations",
    Security: "security",
    SlickTrax: "features",
    "Sync Mode": "sync",
};

export default function SettingsPage() {
    // Theme picking + the theme builder now live on their own page (Themes) —
    // only the sensitive-data toggle from useTheme() is still needed here.
    const { hideSensitive, toggleHideSensitive } = useTheme();
    const { layoutMode } = useLayoutMode();
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [_isSaving, _setIsSaving] = useState(false);
    const isPublicInstance = (process.env.NEXT_PUBLIC_INSTANCE_TYPE || "private") === "public";
    const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);

    const [checkingKeys, setCheckingKeys] = useState(false);
    // Mirrors the localStorage flag so the switch reflects reality after mount
    // (reading it during render would disagree with the server render).
    const [activeTab, setActiveTab] = useState<SettingsTab>("general");
    const [settingsQuery, setSettingsQuery] = useState("");
    const currentSection = SETTINGS_TABS.find((tab) => tab.key === activeTab) ?? SETTINGS_TABS[0];
    const settingsMatches = settingsQuery.trim()
        ? SETTINGS_INDEX.filter((entry) =>
              `${entry.label} ${entry.section} ${entry.keywords}`
                  .toLowerCase()
                  .includes(settingsQuery.trim().toLowerCase())
          ).slice(0, 12)
        : [];
    // Nebula puts the app's own nav across the top, so settings can own the
    // left rail. Original already has a sidebar - a second one beside it is
    // the clutter this avoids.
    const useSettingsRail = layoutMode === "nebula";
    const [beginnerMode, setBeginnerModeState] = useState(false);
    useEffect(() => {
        setBeginnerModeState(isBeginnerMode());
    }, []);

    // Save-time verification for one key: fires after the field's own save,
    // checks only that provider (see /settings/check-keys), and refreshes the
    // badge. Silent on failure - the badge simply keeps its last state; the
    // full "Check keys now" button and the daily sweep stay the loud paths.
    const checkSingleKey = async (
        provider: "tmdb" | "omdb" | "mdblist" | "rpdb",
        value?: string
    ) => {
        if (!value?.trim()) {
            return; // cleared field - nothing to verify
        }
        try {
            const { keyHealth } = await api.checkProviderKeys(provider);
            setSyncSettings((prev) => ({ ...prev, keyHealth }));
        } catch {
            /* badge keeps last known state */
        }
    };

    const handleCheckProviderKeys = async () => {
        setCheckingKeys(true);
        try {
            const { keyHealth } = await api.checkProviderKeys();
            setSyncSettings((prev) => ({ ...prev, keyHealth }));
            const checkedProviders = Object.keys(keyHealth || {});
            const failing = checkedProviders.filter(
                (k) => keyHealth?.[k] && !keyHealth[k].ok
            ).length;
            // 0 failing out of 0 configured is vacuously "all passing" but reads
            // as false reassurance - confirmed live (a removed key's stale result
            // is correctly cleared now, and "0 failing" alone doesn't distinguish
            // that from "everything's fine"). Distinct copy for the empty case.
            // Neutral info icon, not a warning triangle - every one of these four
            // keys is explicitly optional (see each field's own label), so having
            // none configured is a normal, intentional state, not a problem to
            // flag. A warning here would be the same false-alarm mistake the
            // vacuous "all keys working" copy just got caught making.
            if (checkedProviders.length === 0) {
                showToast.info("No API keys configured to check");
            } else if (failing > 0) {
                toast.error(
                    `${failing} of ${checkedProviders.length} key${checkedProviders.length === 1 ? "" : "s"} not working - see below`
                );
            } else {
                toast.success(
                    `${checkedProviders.length} key${checkedProviders.length === 1 ? "" : "s"} working`
                );
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to check keys");
        } finally {
            setCheckingKeys(false);
        }
    };

    // Sync settings state
    const [syncSettings, setSyncSettings] = useState<Partial<SyncSettings>>({
        accountTimezone: "",
        mode: "normal",
        notifyDigestEnabled: false,
        notifyDigestFrequency: "daily" as "daily" | "weekly",
        notifyOnActivity: false,
        notifyOnAddonHealth: false,
        notifyOnBackup: false,
        notifyOnConnectionHealth: true,
        notifyOnInvite: false,
        notifyOnMosaic: false,
        notifyOnNewDevice: false,
        notifyOnProxyHealth: false,
        notifyOnRecoveryKitStale: false,
        notifyOnSync: false,
        notifyOnUpdateAvailable: false,
        notifyOnVault: false,
        safe: true,
        useCustomFields: false,
        webhookUrl: "",
    });

    // AI Services (Settings > External API Keys) - powers natural-language
    // Catalog building (Catalogs -> "Describe a catalog"). Stored as a Vault
    // entry underneath (see api.ts's getAiServicesStatus comment) - the
    // status endpoint never returns the key itself, only whether one is set,
    // same as the account API key above.
    const [aiConfigured, setAiConfigured] = useState(false);
    const [aiApiKey, setAiApiKey] = useState("");
    // Reveal state for the API key field's eye icon - lazy-fetches the real
    // stored key on first click (this field is a plain <input>, not the
    // shared Input component, so this is hand-rolled rather than that
    // component's built-in onRevealClick).
    const [aiKeyVisible, setAiKeyVisible] = useState(false);
    const [aiBaseUrl, setAiBaseUrl] = useState("");
    const [aiModel, setAiModel] = useState("");
    const [isSavingAi, setIsSavingAi] = useState(false);
    // liveAiModels comes from the provider's own GET /models (fetched below)
    // once a key is available - the real, current list, not a hardcoded guess
    // that inevitably drifts as providers retire/rename models (confirmed
    // real case: every hardcoded suggestion here had already gone stale).
    // Falls back to the static per-provider list only until that live fetch
    // has something, so the field isn't empty before a key exists to fetch
    // with.
    const [liveAiModels, setLiveAiModels] = useState<string[]>([]);
    const [loadingAiModels, setLoadingAiModels] = useState(false);
    const staticAiModelOptions =
        AI_MODEL_OPTIONS_BY_PROVIDER[aiBaseUrl.trim() || "https://api.openai.com/v1"] ||
        AI_MODEL_OPTIONS_ALL;
    const aiModelOptions =
        liveAiModels.length > 0
            ? liveAiModels.map((m) => ({ label: m, value: m }))
            : staticAiModelOptions;

    // Both overrides exist because React state updates are async - a caller
    // that just called setAiBaseUrl()/setAiConfigured() moments ago
    // (loadAiServicesStatus, on mount) can't rely on those closure values
    // reflecting the update yet.
    const fetchLiveAiModels = async (opts?: { baseUrl?: string; hasKey?: boolean }) => {
        const effectiveBaseUrl = opts?.baseUrl ?? aiBaseUrl;
        const hasKey = opts?.hasKey ?? (!!aiApiKey.trim() || aiConfigured);
        if (!hasKey) {
            return; // nothing to fetch with yet
        }
        setLoadingAiModels(true);
        try {
            const { models } = await api.listAiModels({
                apiKey: aiApiKey.trim() || undefined,
                baseUrl: effectiveBaseUrl.trim(),
            });
            setLiveAiModels(models);
        } catch {
            setLiveAiModels([]); // fails silently - falls back to the static suggestions, same "bonus, not required" treatment as everywhere else this pattern is used
        } finally {
            setLoadingAiModels(false);
        }
    };
    // Real verification result from the last save (settings.js actually calls
    // the provider, not just "was something written to the DB") - null means
    // never checked yet (fresh page load before any save, or an entry saved
    // before this check existed). Previously "Connected" meant only "a key is
    // stored," true even for garbage input - this is what makes the badge
    // mean something.
    const [aiCheckStatus, setAiCheckStatus] = useState<"ok" | "error" | null>(null);
    const [aiCheckMessage, setAiCheckMessage] = useState<string | null>(null);

    const loadAiServicesStatus = async () => {
        try {
            const status = await api.getAiServicesStatus();
            setAiConfigured(!!status.configured);
            setAiBaseUrl(status.baseUrl || "");
            setAiModel(status.model || "");
            setAiCheckStatus(status.lastCheckStatus || null);
            setAiCheckMessage(status.lastCheckMessage || null);
            if (status.configured) {
                fetchLiveAiModels({ baseUrl: status.baseUrl || "", hasKey: true });
            }
        } catch {
            // Endpoint may not exist yet on an older backend - stay silent.
        }
    };

    // Auto-saves on blur, same as every other API key field on this page (no
    // separate Save button) - always sends baseUrl/model together (they share
    // one testConfig JSON server-side) plus apiKey only when the admin
    // actually typed a new one, so blurring baseUrl right after typing a key
    // doesn't accidentally save an empty key over it.
    const handleAiFieldBlur = async () => {
        if (!(aiApiKey.trim() || aiConfigured)) {
            return; // nothing to save yet
        }
        setIsSavingAi(true);
        try {
            const result = await api.setAiServices({
                apiKey: aiApiKey.trim() || undefined,
                baseUrl: aiBaseUrl.trim(),
                model: aiModel.trim(),
            });
            setAiApiKey("");
            setAiConfigured(true);
            setAiCheckStatus(result.lastCheckStatus);
            setAiCheckMessage(result.lastCheckMessage);
            if (result.lastCheckStatus === "ok") {
                toast.success("AI Services verified and saved");
            } else {
                toast.error(`Saved, but verification failed: ${result.lastCheckMessage}`);
            }
            fetchLiveAiModels({ hasKey: true }); // refresh the model dropdown against whatever key/URL just got saved
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to save AI Services"));
        } finally {
            setIsSavingAi(false);
        }
    };

    // Lazy-fills the field with the real stored key the first time the eye
    // icon reveals (not on hide) - only when it's still blank, so it never
    // clobbers something already being typed to replace it.
    const handleRevealAiKey = async () => {
        if (aiApiKey) {
            return;
        }
        try {
            const result = await api.revealAiServicesKey();
            setAiApiKey(result.secret);
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to reveal API key"));
        }
    };

    // Blank password field can't double as "clear" the way a plain visible-
    // value field can (an untouched blur would look identical to "I want to
    // delete this"), so this stays a distinct affordance - just a small icon
    // action now rather than a full button, since it's the only one left.
    const handleRemoveAiServices = async () => {
        try {
            await api.removeAiServices();
            setAiConfigured(false);
            setAiApiKey("");
            setAiBaseUrl("");
            setAiModel("");
            setAiCheckStatus(null);
            setAiCheckMessage(null);
            toast.success("AI Services removed");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to remove AI Services"));
        }
    };

    // Push-subscribed devices (Settings > Notifications > Devices) - every
    // browser/phone currently subscribed to push on this account, with zero
    // UI over it until now.
    const [pushDevices, setPushDevices] = useState<PushDevice[]>([]);
    const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
    const [editingLabel, setEditingLabel] = useState("");

    const loadPushDevices = async () => {
        try {
            setPushDevices(await api.getPushDevices());
        } catch {
            // Endpoint may not exist yet on an older backend - stay silent.
        }
    };

    const handleRenameDevice = async (id: string) => {
        const label = editingLabel.trim();
        setEditingDeviceId(null);
        try {
            const updated = await api.renamePushDevice(id, label || null);
            setPushDevices((prev) => prev.map((d) => (d.id === id ? updated : d)));
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to rename device"));
        }
    };

    const handleRevokeDevice = async (id: string) => {
        setPushDevices((prev) => prev.filter((d) => d.id !== id));
        try {
            await api.revokePushDevice(id);
            toast.success("Device revoked");
        } catch (e) {
            loadPushDevices(); // revert on failure
            toast.error(readErrorMessage(e, "Failed to revoke device"));
        }
    };

    // Mouse-only grab-and-drag horizontal scrolling, same pattern as the
    // Continue Watching row and MediaDetailModal's Cast row - deferred pointer
    // capture until an actual drag crosses the 5px threshold, so a plain click
    // on rename/revoke isn't swallowed as a drag.
    const devicesRowRef = useRef<HTMLDivElement>(null);
    const isDevicesPointerDownRef = useRef(false);
    const devicesDragStartXRef = useRef(0);
    const devicesDragStartScrollLeftRef = useRef(0);
    const hasCapturedDevicesPointerRef = useRef(false);

    const handleDevicesPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || !devicesRowRef.current) {
            return;
        }
        isDevicesPointerDownRef.current = true;
        hasCapturedDevicesPointerRef.current = false;
        devicesDragStartXRef.current = e.clientX;
        devicesDragStartScrollLeftRef.current = devicesRowRef.current.scrollLeft;
    }, []);

    const handleDevicesPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (
            e.pointerType !== "mouse" ||
            !isDevicesPointerDownRef.current ||
            !devicesRowRef.current
        ) {
            return;
        }
        if ((e.buttons & 1) === 0) {
            isDevicesPointerDownRef.current = false;
            return;
        }
        const dx = e.clientX - devicesDragStartXRef.current;
        if (Math.abs(dx) > 5 && !hasCapturedDevicesPointerRef.current) {
            devicesRowRef.current.setPointerCapture(e.pointerId);
            hasCapturedDevicesPointerRef.current = true;
        }
        devicesRowRef.current.scrollLeft = devicesDragStartScrollLeftRef.current - dx;
    }, []);

    const handleDevicesPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse") {
            return;
        }
        isDevicesPointerDownRef.current = false;
        if (hasCapturedDevicesPointerRef.current) {
            devicesRowRef.current?.releasePointerCapture(e.pointerId);
            hasCapturedDevicesPointerRef.current = false;
        }
    }, []);

    // API Key state
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [isGeneratingKey, setIsGeneratingKey] = useState(false);

    // Passkeys. Deliberately additive to the password - there is no "require
    // passkey" switch, because a self-hosted instance has no way back in if
    // the only credential is on a device that is gone.
    const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
    const [passkeyRpId, setPasskeyRpId] = useState<string | null>(null);
    const [passkeyBusy, setPasskeyBusy] = useState(false);
    const [passkeySupported, setPasskeySupported] = useState(false);
    useEffect(() => {
        setPasskeySupported(typeof window !== "undefined" && !!window.PublicKeyCredential);
        api.getPasskeys()
            .then((r) => {
                setPasskeys(r.passkeys || []);
                setPasskeyRpId(r.currentRpId);
            })
            .catch(() => undefined);
    }, []);

    const handleAddPasskey = async () => {
        setPasskeyBusy(true);
        try {
            const { startRegistration } = await import("@simplewebauthn/browser");
            const optionsJSON = await api.getPasskeyRegistrationOptions();
            const credential = await startRegistration({ optionsJSON });
            // Named after the device it lives on where the browser will say, so a
            // list of three passkeys is not three identical rows.
            const suggested =
                typeof navigator !== "undefined" &&
                /iPhone|iPad|Android|Mac|Windows/i.test(navigator.userAgent)
                    ? navigator.userAgent.match(/iPhone|iPad|Android|Mac|Windows/i)?.[0] ||
                      "This device"
                    : "This device";
            const r = await api.verifyPasskeyRegistration(credential, suggested);
            setPasskeys(r.passkeys || []);
            toast.success("Passkey added");
        } catch (e) {
            // A cancelled prompt is not a failure worth a red toast.
            if (
                readErrorName(e) === "NotAllowedError" ||
                /cancel|abort/i.test(readErrorMessage(e, ""))
            ) {
                return;
            }
            toast.error(readErrorMessage(e, "Could not add that passkey"));
        } finally {
            setPasskeyBusy(false);
        }
    };

    const handleRemovePasskey = async (id: string) => {
        try {
            const r = await api.deletePasskey(id);
            setPasskeys(r.passkeys || []);
            toast.success("Passkey removed");
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not remove that passkey"));
        }
    };

    // 2FA (TOTP) state - see server/utils/twoFactor.js for the backend design.
    const [twoFaEnabled, setTwoFaEnabled] = useState<boolean | null>(null);
    const [twoFaSetup, setTwoFaSetup] = useState<{
        secret: string;
        otpauthUrl: string;
        qrCodeDataUrl: string;
    } | null>(null);
    const [twoFaSetupCode, setTwoFaSetupCode] = useState("");
    const [twoFaEnabling, setTwoFaEnabling] = useState(false);
    const [twoFaStartingSetup, setTwoFaStartingSetup] = useState(false);
    const [twoFaBackupCodes, setTwoFaBackupCodes] = useState<string[] | null>(null);
    const [twoFaDisablePrompt, setTwoFaDisablePrompt] = useState(false);
    const [twoFaDisableCode, setTwoFaDisableCode] = useState("");
    const [twoFaDisabling, setTwoFaDisabling] = useState(false);
    const [twoFaRegenPrompt, setTwoFaRegenPrompt] = useState(false);
    const [twoFaRegenCode, setTwoFaRegenCode] = useState("");
    const [twoFaRegenerating, setTwoFaRegenerating] = useState(false);

    // Webhook testing
    const [isTestingWebhook, setIsTestingWebhook] = useState(false);
    const [isGeneratingMosaic, setIsGeneratingMosaic] = useState(false);

    // Account/avatar state
    const [accountInfo, setAccountInfo] = useState<AccountStats | null>(null);
    const [avatarModalOpen, setAvatarModalOpen] = useState(false);
    const [uuidCopied, setUuidCopied] = useState(false);
    const [nuvioDiscovering, setNuvioDiscovering] = useState(false);
    const [displayNameDraft, setDisplayNameDraft] = useState("");
    const [savingDisplayName, setSavingDisplayName] = useState(false);

    // Load settings on mount
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const stats = await api.getAccountStats();
                setAccountInfo(stats);
                setDisplayNameDraft(stats.displayName || "");
            } catch {
                // Account stats endpoint may not be available
            }

            try {
                const settings = await api.getSyncSettings();
                setSyncSettings({
                    accountTimezone: settings.accountTimezone || "",
                    autoplayTrailerStartMuted: settings.autoplayTrailerStartMuted !== false,
                    enableAutoplayTrailer: settings.enableAutoplayTrailer === true,
                    enableAutoThemedCatalogs: settings.enableAutoThemedCatalogs === true,
                    enablePosterRatings: settings.enablePosterRatings === true,
                    enableReactions: settings.enableReactions !== false,
                    enableRecommendations: settings.enableRecommendations !== false,
                    enableWatchedIndicators: settings.enableWatchedIndicators !== false,
                    enableWatchlist: settings.enableWatchlist !== false,
                    enableWatchProviders: settings.enableWatchProviders !== false,
                    enableWatchTogether: settings.enableWatchTogether !== false,
                    // Carried over from the server rather than left undefined. The
                    // daily scheduler (utils/metadataKeyHealth.js) has been storing
                    // results all along, but this page only ever populated keyHealth
                    // from the manual "Check keys now" button - so every fresh page
                    // load showed "Not checked yet" and the usage figures vanished,
                    // which made the daily check look like it was never running.
                    keyHealth:
                        settings.keyHealth && Object.keys(settings.keyHealth).length > 0
                            ? settings.keyHealth
                            : undefined,
                    keyPoolAutoRetire: settings.keyPoolAutoRetire === true,
                    keyPoolQuotaWeighting: settings.keyPoolQuotaWeighting === true,
                    lumiereDbUrl: settings.lumiereDbUrl || "",
                    mdblistApiKey: settings.mdblistApiKey || "",
                    mdblistApiKeyBackup: settings.mdblistApiKeyBackup || "",
                    mdblistApiKeyPool: settings.mdblistApiKeyPool || [],
                    mode: settings.mode || "normal",
                    notifyDigestEnabled: settings.notifyDigestEnabled || false,
                    notifyDigestFrequency:
                        settings.notifyDigestFrequency === "weekly" ? "weekly" : "daily",
                    notifyOnActivity: settings.notifyOnActivity || false,
                    notifyOnAddonHealth: settings.notifyOnAddonHealth || false,
                    notifyOnBackup: settings.notifyOnBackup || false,
                    notifyOnConnectionHealth: settings.notifyOnConnectionHealth !== false,
                    notifyOnInvite: settings.notifyOnInvite || false,
                    notifyOnMosaic: settings.notifyOnMosaic || false,
                    notifyOnNewDevice: settings.notifyOnNewDevice || false,
                    notifyOnProxyHealth: settings.notifyOnProxyHealth || false,
                    notifyOnRecoveryKitStale: settings.notifyOnRecoveryKitStale || false,
                    notifyOnSync: settings.notifyOnSync || false,
                    notifyOnUpdateAvailable: settings.notifyOnUpdateAvailable || false,
                    notifyOnVault: settings.notifyOnVault || false,
                    omdbApiKey: settings.omdbApiKey || "",
                    omdbApiKeyBackup: settings.omdbApiKeyBackup || "",
                    omdbApiKeyPool: settings.omdbApiKeyPool || [],
                    rpdbApiKey: settings.rpdbApiKey || "",
                    rpdbApiKeyBackup: settings.rpdbApiKeyBackup || "",
                    rpdbApiKeyPool: settings.rpdbApiKeyPool || [],
                    safe: settings.safe !== false,
                    simklClientId: settings.simklClientId || "",
                    tmdbApiKey: settings.tmdbApiKey || "",
                    tmdbApiKeyBackup: settings.tmdbApiKeyBackup || "",
                    tmdbApiKeyPool: settings.tmdbApiKeyPool || [],
                    useCustomFields: settings.useCustomFields || false,
                    webhookUrl: settings.webhookUrl || "",
                });

                // Keeps the key badges near-live without anyone pressing "Check keys
                // now": if the newest stored result is over an hour old (or absent)
                // when the page opens, one full check runs silently in the
                // background and the badges update in place. The hour cap is the
                // rate-limit guard - reloading the page repeatedly still checks at
                // most hourly, the daily scheduler continues regardless, and a check
                // is four tiny requests (MDBList's own allowance is 1,000/day, so
                // even hourly is noise).
                try {
                    const hasAnyKey = !!(
                        settings.tmdbApiKey ||
                        settings.omdbApiKey ||
                        settings.mdblistApiKey ||
                        settings.rpdbApiKey
                    );
                    const kh = settings.keyHealth;
                    const newest = kh
                        ? Math.max(
                              0,
                              ...Object.values(kh).map((r) => new Date(r.checkedAt || 0).getTime())
                          )
                        : 0;
                    if (hasAnyKey && Date.now() - newest > 60 * 60 * 1000) {
                        api.checkProviderKeys()
                            .then(({ keyHealth }) =>
                                setSyncSettings((prev) => ({ ...prev, keyHealth }))
                            )
                            .catch(() => {
                                /* silent - the manual button and daily sweep remain */
                            });
                    }
                } catch {
                    /* freshness is best-effort */
                }

                // Nobody has ever explicitly saved a timezone for this account - the
                // browser already knows the OS's own zone, so silently fill that in
                // once instead of leaving it on the bare fallback until someone
                // happens to open this dropdown. Still stored explicitly server-side
                // right away (background jobs have no browser to read from later) -
                // this only removes the manual first pick, not the persisted value.
                if (settings.accountTimezoneIsDefault) {
                    try {
                        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
                        if (detected && detected !== settings.accountTimezone) {
                            setSyncSettings((prev) => ({ ...prev, accountTimezone: detected }));
                            api.updateSyncSettings({ accountTimezone: detected }).catch(
                                () => undefined
                            );
                        }
                    } catch {
                        // Intl.DateTimeFormat().resolvedOptions().timeZone is universally
                        // supported in practice, but never let a detection failure block
                        // the rest of settings from loading.
                    }
                }
            } catch {
                // Settings may not exist yet, use defaults
            }

            try {
                const keyStatus = await api.getApiKeyStatus();
                if (keyStatus.apiKey) {
                    setApiKey(keyStatus.apiKey);
                } else if (!keyStatus.hasKey) {
                    // Auto-generate if missing
                    const generated = await api.generateApiKey();
                    setApiKey(generated.apiKey);
                    toast.success("API key auto-generated");
                }
            } catch {
                // API key endpoint may not be available
            }

            try {
                const status = await api.get2faStatus();
                setTwoFaEnabled(!!status.enabled);
            } catch {
                setTwoFaEnabled(false);
            }
        };

        loadSettings();
        loadPushDevices();
        loadAiServicesStatus();
    }, []);

    // Deep-link from the command palette: /settings?highlight=<label> scrolls
    // to that control and flashes its box. Settings load async, so the target
    // may not exist on first paint - retry briefly instead of racing the
    // fetches above. The URL is read once on mount (same pattern as Metrics'
    // ?tab=, avoiding useSearchParams' Suspense requirement); the custom
    // event covers picking a setting while ALREADY on this page, where a
    // query-only router.push never remounts anything.
    useEffect(() => {
        let cancelled = false;
        const runHighlight = (target: string) => {
            let tries = 0;
            const attempt = () => {
                if (cancelled) {
                    return;
                }
                const el = findSettingElement(target);
                if (!el) {
                    if (++tries < 40) {
                        setTimeout(attempt, 150); // give up after ~6s
                    }
                    return;
                }
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                const prevShadow = el.style.boxShadow;
                el.style.transition = "box-shadow 0.3s ease";
                el.style.boxShadow = "0 0 0 2px var(--color-primary)";
                if (!(el.style.borderRadius || el.className.includes("rounded"))) {
                    el.style.borderRadius = "8px";
                }
                setTimeout(() => {
                    if (!cancelled) {
                        el.style.boxShadow = prevShadow;
                    }
                }, 2600);
            };
            setTimeout(attempt, 300);
        };
        // Jumping from the command palette must also switch tabs, or the
        // control it wants is simply not mounted to scroll to.
        const tabFor = (target: string) => {
            const entry = SETTINGS_INDEX.find((e) => e.label === target);
            return entry ? SETTINGS_TABS_BY_SECTION[entry.section] : undefined;
        };
        const requestedTab = new URLSearchParams(window.location.search).get("tab");
        if (requestedTab && SETTINGS_TABS.some((t) => t.key === requestedTab)) {
            setActiveTab(requestedTab as SettingsTab);
        }
        const fromUrl = new URLSearchParams(window.location.search).get("highlight");
        if (fromUrl) {
            const tab = tabFor(fromUrl);
            if (tab) {
                setActiveTab(tab);
            }
            runHighlight(fromUrl);
        }
        const onEvent = (e: Event) => {
            const target = (e as CustomEvent<string>).detail;
            if (typeof target === "string" && target) {
                const tab = tabFor(target);
                if (tab) {
                    setActiveTab(tab);
                }
                runHighlight(target);
            }
        };
        window.addEventListener("slicksync:settings-highlight", onEvent);
        return () => {
            cancelled = true;
            window.removeEventListener("slicksync:settings-highlight", onEvent);
        };
    }, []);

    const handleSaveSetting = async (key: keyof SyncSettings, value: any) => {
        const newSettings = { ...syncSettings, [key]: value };
        setSyncSettings(newSettings);

        try {
            await api.updateSyncSettings({ [key]: value });
            toast.success("Setting saved");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to save setting"));
        }
    };

    const handleAvatarSave = async (data: { avatarUrl?: string | null; colorIndex?: number }) => {
        await api.updateAccountAvatar(data.avatarUrl ?? null);
        setAccountInfo((prev) => (prev ? { ...prev, avatarUrl: data.avatarUrl ?? null } : prev));
        // Sidebar/Nebula topbar fetch account info independently on mount, so a
        // full reload is the simplest way to get the new picture to show there too.
        setTimeout(() => window.location.reload(), 600);
    };

    const handleSaveDisplayName = async () => {
        const trimmed = displayNameDraft.trim();
        if (trimmed === (accountInfo?.displayName || "")) {
            return;
        }
        setSavingDisplayName(true);
        try {
            const result = await api.updateAccountDisplayName(trimmed || null);
            setAccountInfo((prev) => (prev ? { ...prev, displayName: result.displayName } : prev));
            setDisplayNameDraft(result.displayName || "");
            toast.success("Nickname saved");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to save nickname"));
        } finally {
            setSavingDisplayName(false);
        }
    };

    const handleTestWebhook = async () => {
        if (!syncSettings.webhookUrl?.trim()) {
            toast.error("Enter a webhook URL first");
            return;
        }

        setIsTestingWebhook(true);
        try {
            await api.testWebhook(syncSettings.webhookUrl);
            toast.success("Test message sent to Discord");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to send test message"));
        } finally {
            setIsTestingWebhook(false);
        }
    };

    const handleGenerateMosaic = async () => {
        setIsGeneratingMosaic(true);
        try {
            const result = await api.generateMosaicNow();
            if (result.posted) {
                toast.success(
                    syncSettings.webhookUrl?.trim()
                        ? `Posted ${result.month} — ${result.count} title${result.count === 1 ? "" : "s"} to Discord`
                        : `Sent ${result.month} recap — ${result.count} title${result.count === 1 ? "" : "s"} watched`
                );
            } else if (result.reason === "nothing watched") {
                toast.error("Nothing watched last month - nothing to post");
            } else {
                toast.error(result.reason || "Failed to generate mosaic");
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to generate mosaic"));
        } finally {
            setIsGeneratingMosaic(false);
        }
    };

    const handleGenerateApiKey = async () => {
        setIsGeneratingKey(true);
        try {
            const result = apiKey ? await api.rotateApiKey() : await api.generateApiKey();
            setApiKey(result.apiKey);
            copyToClipboard(result.apiKey);
            toast.success(apiKey ? "API key rotated and copied" : "API key generated and copied");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to generate API key"));
        } finally {
            setIsGeneratingKey(false);
        }
    };

    const handleCopyApiKey = () => {
        if (apiKey) {
            copyToClipboard(apiKey);
            toast.success("API key copied to clipboard");
        }
    };

    const handleStart2fa = async () => {
        setTwoFaStartingSetup(true);
        try {
            const result = await api.setup2fa();
            setTwoFaSetup(result);
            setTwoFaSetupCode("");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to start 2FA setup"));
        } finally {
            setTwoFaStartingSetup(false);
        }
    };

    const handleConfirm2fa = async () => {
        if (!(twoFaSetup && twoFaSetupCode.trim())) {
            return;
        }
        setTwoFaEnabling(true);
        try {
            const result = await api.enable2fa(twoFaSetup.secret, twoFaSetupCode.trim());
            setTwoFaEnabled(true);
            setTwoFaSetup(null);
            setTwoFaSetupCode("");
            setTwoFaBackupCodes(result.backupCodes);
            toast.success("2FA enabled");
        } catch (e) {
            toast.error(readErrorMessage(e, "Incorrect code"));
        } finally {
            setTwoFaEnabling(false);
        }
    };

    const handleCancel2faSetup = () => {
        setTwoFaSetup(null);
        setTwoFaSetupCode("");
    };

    const handleDisable2fa = async () => {
        if (!twoFaDisableCode.trim()) {
            return;
        }
        setTwoFaDisabling(true);
        try {
            await api.disable2fa(twoFaDisableCode.trim());
            setTwoFaEnabled(false);
            setTwoFaDisablePrompt(false);
            setTwoFaDisableCode("");
            toast.success("2FA disabled");
        } catch (e) {
            toast.error(readErrorMessage(e, "Incorrect code"));
        } finally {
            setTwoFaDisabling(false);
        }
    };

    const handleRegenerate2faBackupCodes = async () => {
        if (!twoFaRegenCode.trim()) {
            return;
        }
        setTwoFaRegenerating(true);
        try {
            const result = await api.regenerate2faBackupCodes(twoFaRegenCode.trim());
            setTwoFaRegenPrompt(false);
            setTwoFaRegenCode("");
            setTwoFaBackupCodes(result.backupCodes);
            toast.success("New backup codes generated - your old codes no longer work");
        } catch (e) {
            toast.error(readErrorMessage(e, "Incorrect code"));
        } finally {
            setTwoFaRegenerating(false);
        }
    };

    const handleCopyBackupCodes = () => {
        if (!twoFaBackupCodes) {
            return;
        }
        copyToClipboard(twoFaBackupCodes.join("\n"));
        toast.success("Backup codes copied to clipboard");
    };

    const handleReset = async () => {
        setIsResetModalOpen(false);
        // Reset to defaults
        setSyncSettings({
            mode: "normal",
            notifyDigestEnabled: false,
            notifyDigestFrequency: "daily",
            notifyOnActivity: false,
            notifyOnAddonHealth: false,
            notifyOnBackup: false,
            notifyOnConnectionHealth: true,
            notifyOnInvite: false,
            notifyOnMosaic: false,
            notifyOnNewDevice: false,
            notifyOnProxyHealth: false,
            notifyOnRecoveryKitStale: false,
            notifyOnSync: false,
            notifyOnUpdateAvailable: false,
            notifyOnVault: false,
            safe: true,
            useCustomFields: false,
            webhookUrl: "",
        });
        try {
            await api.updateSyncSettings({
                mode: "normal",
                notifyDigestEnabled: false,
                notifyDigestFrequency: "daily",
                notifyOnActivity: false,
                notifyOnAddonHealth: false,
                notifyOnBackup: false,
                notifyOnConnectionHealth: true,
                notifyOnInvite: false,
                notifyOnMosaic: false,
                notifyOnNewDevice: false,
                notifyOnProxyHealth: false,
                notifyOnRecoveryKitStale: false,
                notifyOnSync: false,
                notifyOnUpdateAvailable: false,
                notifyOnVault: false,
                safe: true,
                useCustomFields: false,
                webhookUrl: "",
            });
            toast.success("Settings reset to defaults");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to reset settings"));
        }
    };

    // Irreversible - server re-checks public-instance-only and always deletes
    // the caller's own account (never an id from here). Signs out the same way
    // NebulaTopbar's own handleLogout does and sends the browser to /login,
    // since the account (and its session) no longer exists.
    const handleDeleteAccount = async () => {
        setIsDeletingAccount(true);
        try {
            await api.deleteMyAccount();
            await api.logout();
            toast.success("Account deleted");
            window.location.href = "/login?mode=admin";
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to delete account"));
            setIsDeletingAccount(false);
        }
    };

    // Mask API key for display
    const maskedApiKey = apiKey
        ? apiKeyVisible
            ? apiKey
            : `${apiKey.slice(0, 8)}••••••••${apiKey.slice(-4)}`
        : "No API key";

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    subtitle="Make yourself at home. Your preferences, connections, and account."
                    title="Settings"
                />
            )}

            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-6 lg:p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={{ maxWidth: layoutMode === "nebula" ? "min(92rem, 92vw)" : "70rem" }}
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            subtitle="Make yourself at home. Your preferences, connections, and account."
                            title="Settings"
                        />
                    )}
                    <div
                        className={`settings-workspace ${useSettingsRail ? "settings-with-rail" : ""}`}
                    >
                        <SettingsNavigation
                            activeKey={activeTab}
                            onChange={(key) => {
                                setActiveTab(key as SettingsTab);
                                setSettingsQuery("");
                            }}
                            onQueryChange={setSettingsQuery}
                            query={settingsQuery}
                            sections={SETTINGS_TABS.map((tab) => ({
                                ...tab,
                                group: ["general", "themes", "notifications"].includes(tab.key)
                                    ? "Your experience"
                                    : "Your setup",
                            }))}
                        />

                        <div className="settings-content min-w-0">
                            {settingsQuery.trim() ? (
                                <section
                                    aria-label="Settings search results"
                                    className="settings-search-results mb-7"
                                >
                                    <h2 className="mb-2 font-semibold text-default text-xl">
                                        Find your setting
                                    </h2>
                                    <p className="mb-5 text-muted text-sm">
                                        {settingsMatches.length
                                            ? "Choose a result to jump straight to its control."
                                            : "No matching settings. Try a different name, like notifications or timezone."}
                                    </p>
                                    <div className="interface-panel overflow-hidden rounded-2xl">
                                        {settingsMatches.map((entry) => (
                                            <button
                                                className="settings-result flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                                                key={`${entry.section}-${entry.label}`}
                                                onClick={() => {
                                                    setSettingsQuery("");
                                                    window.dispatchEvent(
                                                        new CustomEvent(
                                                            "slicksync:settings-highlight",
                                                            { detail: entry.label }
                                                        )
                                                    );
                                                }}
                                                type="button"
                                            >
                                                <span>
                                                    <span className="block font-medium text-default text-sm">
                                                        {entry.label}
                                                    </span>
                                                    <span className="mt-1 block text-muted text-xs">
                                                        {entry.section}
                                                    </span>
                                                </span>
                                                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            ) : null}
                            <div hidden={!!settingsQuery.trim()}>
                                <div className="settings-section-heading mb-6">
                                    <p className="mb-2 font-medium text-primary text-xs">
                                        Settings
                                    </p>
                                    <h2 className="font-semibold text-2xl text-default">
                                        {currentSection.label}
                                    </h2>
                                    <p className="mt-2 text-muted text-sm">
                                        {currentSection.blurb}
                                    </p>
                                </div>

                                {activeTab === "themes" && <ThemesPanel embedded />}

                                {activeTab === "about" && (
                                    <AboutPanel
                                        lumiere={!isPublicInstance && !!syncSettings.lumiereDbUrl}
                                        shared={isPublicInstance}
                                    />
                                )}

                                <div className="settings-profile-grid">
                                    {/* Profile Picture - shown on the account button (bottom-left in
            Nebula, bottom of sidebar in Original) and its dropdown menu. */}
                                    {activeTab === "general" && (
                                        <PageSection className="mb-6">
                                            <ProfilePictureSettings
                                                email={accountInfo?.email || undefined}
                                                fallbackIcon={
                                                    <ShieldCheckIcon
                                                        className="h-7 w-7"
                                                        style={{ color: "white" }}
                                                    />
                                                }
                                                name={
                                                    isPublicInstance
                                                        ? accountInfo?.uuid ||
                                                          accountInfo?.email ||
                                                          "Admin"
                                                        : "Administrator"
                                                }
                                                onChange={() => setAvatarModalOpen(true)}
                                                src={accountInfo?.avatarUrl || undefined}
                                            >
                                                {isPublicInstance && (
                                                    <div className="mt-5 border-default border-t pt-5">
                                                        <label className="mb-1.5 block font-medium text-default text-sm">
                                                            Nickname
                                                        </label>
                                                        <p className="mb-2 text-muted text-xs">
                                                            Pick your own name for this account.
                                                            It's yours to set - shown next to your
                                                            UUID wherever this instance needs to
                                                            tell accounts apart.
                                                        </p>
                                                        <div className="flex max-w-sm items-center gap-2">
                                                            <input
                                                                autoComplete="off"
                                                                className="input-base w-full px-3 py-2 text-sm"
                                                                maxLength={60}
                                                                onBlur={handleSaveDisplayName}
                                                                onChange={(e) =>
                                                                    setDisplayNameDraft(
                                                                        e.target.value
                                                                    )
                                                                }
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") {
                                                                        (
                                                                            e.target as HTMLInputElement
                                                                        ).blur();
                                                                    }
                                                                }}
                                                                placeholder="e.g. Movie Night"
                                                                spellCheck={false}
                                                                type="text"
                                                                value={displayNameDraft}
                                                            />
                                                            {savingDisplayName && (
                                                                <span className="shrink-0 text-muted text-xs">
                                                                    Saving...
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </ProfilePictureSettings>
                                        </PageSection>
                                    )}

                                    {/* Welcome tour replay - low-key, one line, no card padding beyond
            the norm here so it doesn't stand out among the settings around
            it. Users kept accidentally clicking past a step with no way
            back (fixed in the wizard itself) and had no way to pull it back
            up afterward either - this is that way back in, not a big CTA. */}
                                    {activeTab === "general" && (
                                        <PageSection className="mb-6" delay={0.05}>
                                            <Card padding="lg">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="flex min-w-0 items-center gap-3">
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-muted">
                                                            <SparklesIcon className="h-5 w-5 text-primary" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h3 className="font-display font-semibold text-base text-default">
                                                                Welcome Tour
                                                            </h3>
                                                            <p className="text-muted text-xs">
                                                                Replay the first-run walkthrough any
                                                                time
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        onClick={openOnboardingWizard}
                                                        size="sm"
                                                        variant="secondary"
                                                    >
                                                        Replay
                                                    </Button>
                                                </div>
                                            </Card>
                                        </PageSection>
                                    )}
                                </div>

                                {/* Privacy & Display */}
                                {activeTab === "general" && (
                                    <PageSection className="mb-6" delay={0.05}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-muted">
                                                    <EyeSlashIcon className="h-5 w-5 text-secondary" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        Privacy & Display
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Control how information is displayed
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                {/* Per-device, not an account setting - see lib/beginnerMode.ts
                  for why one household member being new shouldn't flip a
                  switch for everyone else. */}
                                                <SettingRow
                                                    description="Show short explanations on each page, with a link into the full guide"
                                                    label="Beginner Mode"
                                                >
                                                    <ToggleSwitch
                                                        enabled={beginnerMode}
                                                        label="Toggle beginner mode"
                                                        onChange={(v) => {
                                                            setBeginnerModePref(v);
                                                            setBeginnerModeState(v);
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Hide sensitive information like emails, IPs, and API keys"
                                                    label="Private Mode"
                                                >
                                                    <ToggleSwitch
                                                        enabled={hideSensitive}
                                                        label="Toggle private mode"
                                                        onChange={toggleHideSensitive}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Show custom names instead of original addon names"
                                                    label="Custom Addon Names"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.useCustomFields || false
                                                        }
                                                        label="Toggle custom addon names"
                                                        onChange={(v) =>
                                                            handleSaveSetting("useCustomFields", v)
                                                        }
                                                    />
                                                </SettingRow>

                                                <div className="rounded-lg bg-subtle p-4">
                                                    <label className="mb-2 block font-medium text-default text-sm">
                                                        Timezone
                                                    </label>
                                                    <select
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onChange={(e) =>
                                                            handleSaveSetting(
                                                                "accountTimezone",
                                                                e.target.value
                                                            )
                                                        }
                                                        value={syncSettings.accountTimezone || ""}
                                                    >
                                                        {syncSettings.accountTimezone &&
                                                            !TIMEZONES.includes(
                                                                syncSettings.accountTimezone
                                                            ) && (
                                                                <option
                                                                    value={
                                                                        syncSettings.accountTimezone
                                                                    }
                                                                >
                                                                    {syncSettings.accountTimezone}
                                                                </option>
                                                            )}
                                                        {TIMEZONES.map((tz) => (
                                                            <option key={tz} value={tz}>
                                                                {tz}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <p className="mt-2 text-muted text-xs">
                                                        Auto-detected from this browser on first
                                                        visit, then stored explicitly - used
                                                        server-side to decide what counts as
                                                        &quot;today&quot; for Watch Time Today and
                                                        streaks, and background jobs have no browser
                                                        to re-check it against later, so change it
                                                        here if you ever travel or move.
                                                    </p>
                                                </div>

                                                {/* What counts as finished, and when a show is unfinished. */}
                                                <WatchTrackingSettings />
                                            </div>
                                        </Card>
                                    </PageSection>
                                )}

                                {/* Sync Mode */}
                                {activeTab === "sync" && (
                                    <PageSection className="mb-6" delay={0.1}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-muted">
                                                    <CogIcon className="h-5 w-5 text-warning" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        Sync Mode
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Configure how addons are synchronized
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <SettingRow
                                                    description="Re-fetches each addon's live manifest before every sync, so upstream changes (new catalogs, updated resources) get pushed too - not just what's cached. Slower per sync since it hits the network for every addon."
                                                    label="Advanced Sync"
                                                >
                                                    <ToggleSwitch
                                                        enabled={syncSettings.mode === "advanced"}
                                                        label="Toggle advanced sync"
                                                        onChange={(v) =>
                                                            handleSaveSetting(
                                                                "mode",
                                                                v ? "advanced" : "normal"
                                                            )
                                                        }
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Allow destructive operations without confirmation (not recommended)"
                                                    label="Unsafe Mode"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {!syncSettings.safe && (
                                                            <Badge size="sm" variant="error">
                                                                Enabled
                                                            </Badge>
                                                        )}
                                                        <ToggleSwitch
                                                            enabled={!syncSettings.safe}
                                                            label="Toggle unsafe mode"
                                                            onChange={(v) =>
                                                                handleSaveSetting("safe", !v)
                                                            }
                                                        />
                                                    </div>
                                                </SettingRow>
                                            </div>
                                        </Card>
                                    </PageSection>
                                )}

                                {/* Notifications */}
                                {activeTab === "notifications" && (
                                    <PageSection className="mb-6" delay={0.15}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/20">
                                                    <GlobeAltIcon className="h-5 w-5 text-indigo-400" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        Notifications
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Push + bell by default; add a Discord
                                                        webhook below for optional Discord delivery
                                                        too
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                {/* Phone / desktop push - separate from Discord: install
                  SlickSync as an app and get new-episode alerts as native
                  notifications, even when it's closed. Per-device. */}
                                                <div>
                                                    <label className="mb-1 block font-medium text-default text-sm">
                                                        Phone notifications (PWA)
                                                    </label>
                                                    <p className="mb-3 text-muted text-xs">
                                                        Install SlickSync to your home screen, then
                                                        enable native new-episode notifications on
                                                        this device.
                                                    </p>
                                                    <PushNotificationToggle />
                                                </div>

                                                <div className="border-default border-t pt-4">
                                                    <label className="mb-2 block font-medium text-default text-sm">
                                                        Webhook URL
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            className="input-base flex-1 px-3 py-2 text-sm"
                                                            onBlur={() =>
                                                                handleSaveSetting(
                                                                    "webhookUrl",
                                                                    syncSettings.webhookUrl
                                                                )
                                                            }
                                                            onChange={(e) =>
                                                                setSyncSettings((prev) => ({
                                                                    ...prev,
                                                                    webhookUrl: e.target.value,
                                                                }))
                                                            }
                                                            placeholder="https://discord.com/api/webhooks/..."
                                                            type="url"
                                                            value={syncSettings.webhookUrl || ""}
                                                        />
                                                        <Button
                                                            disabled={
                                                                !syncSettings.webhookUrl?.trim()
                                                            }
                                                            isLoading={isTestingWebhook}
                                                            onClick={handleTestWebhook}
                                                            size="sm"
                                                            variant="secondary"
                                                        >
                                                            Test
                                                        </Button>
                                                    </div>
                                                    <p className="mt-2 text-muted text-xs">
                                                        Create a webhook in your Discord server
                                                        settings to receive notifications
                                                    </p>
                                                </div>

                                                <div className="space-y-3">
                                                    <SettingRow
                                                        description="Notify when users start watching"
                                                        label="Activity notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnActivity ||
                                                                false
                                                            }
                                                            label="Toggle activity notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnActivity",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify when sync completes"
                                                        label="Sync notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnSync || false
                                                            }
                                                            label="Toggle sync notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting("notifyOnSync", v)
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify for invitations and user joins"
                                                        label="Invite notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnInvite || false
                                                            }
                                                            label="Toggle invite notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnInvite",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify when a Vault entry is about to expire or an automated check starts failing"
                                                        label="Vault notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnVault || false
                                                            }
                                                            label="Toggle vault notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnVault",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify when a primary addon goes offline (and switches to its backup) or comes back"
                                                        label="Addon health notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnAddonHealth ||
                                                                false
                                                            }
                                                            label="Toggle addon health notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnAddonHealth",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify when someone's Stremio, Nuvio or Jellyfin sign-in stops working (and again when it's back), so their watching doesn't go untracked unnoticed"
                                                        label="Connection problem notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnConnectionHealth !==
                                                                false
                                                            }
                                                            label="Toggle connection problem notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnConnectionHealth",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify when a user's stream is seen from an IP we haven't confirmed for them before"
                                                        label="New device notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnNewDevice ||
                                                                false
                                                            }
                                                            label="Toggle new device notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnNewDevice",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify only if an automatic backup fails validation (a good backup stays silent - see its badge on Tasks)"
                                                        label="Backup notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnBackup || false
                                                            }
                                                            label="Toggle backup notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnBackup",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify if the AIOStreams proxy (Now Playing polling) goes unreachable or recovers"
                                                        label="Proxy connectivity notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnProxyHealth ||
                                                                false
                                                            }
                                                            label="Toggle proxy connectivity notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnProxyHealth",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Notify when a newer stable SlickSync release is published (checked every 6h) - also always visible on Metrics > Health regardless of this toggle"
                                                        label="Update available notifications"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnUpdateAvailable ||
                                                                false
                                                            }
                                                            label="Toggle update available notifications"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnUpdateAvailable",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Remind me when the Disaster Recovery Kit is over 60 days old (or was never exported) while the Vault holds credentials. Nothing is uploaded - the kit is only ever produced when you export it yourself."
                                                        label="Recovery Kit reminders"
                                                    >
                                                        <ToggleSwitch
                                                            enabled={
                                                                syncSettings.notifyOnRecoveryKitStale ||
                                                                false
                                                            }
                                                            label="Toggle Recovery Kit reminders"
                                                            onChange={(v) =>
                                                                handleSaveSetting(
                                                                    "notifyOnRecoveryKitStale",
                                                                    v
                                                                )
                                                            }
                                                        />
                                                    </SettingRow>

                                                    <SettingRow
                                                        description={
                                                            syncSettings.webhookUrl?.trim()
                                                                ? "Post a poster collage of everything watched last month to Discord, on the 1st"
                                                                : 'Sends a push+bell text recap on the 1st (e.g. "14 titles watched") - add a Discord webhook above for the actual poster collage image'
                                                        }
                                                        label="Monthly poster mosaic"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Button
                                                                isLoading={isGeneratingMosaic}
                                                                onClick={handleGenerateMosaic}
                                                                size="sm"
                                                                variant="secondary"
                                                            >
                                                                Generate now
                                                            </Button>
                                                            <ToggleSwitch
                                                                enabled={
                                                                    syncSettings.notifyOnMosaic ||
                                                                    false
                                                                }
                                                                label="Toggle monthly poster mosaic"
                                                                onChange={(v) =>
                                                                    handleSaveSetting(
                                                                        "notifyOnMosaic",
                                                                        v
                                                                    )
                                                                }
                                                            />
                                                        </div>
                                                    </SettingRow>

                                                    <SettingRow
                                                        description="Batch every notification above into one push + bell summary on a schedule instead of pinging instantly (also posts to Discord if a webhook is set above)"
                                                        label="Digest mode"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <select
                                                                className="input-base px-2 py-1.5 text-sm disabled:opacity-50"
                                                                disabled={
                                                                    !syncSettings.notifyDigestEnabled
                                                                }
                                                                onChange={(e) =>
                                                                    handleSaveSetting(
                                                                        "notifyDigestFrequency",
                                                                        e.target.value
                                                                    )
                                                                }
                                                                value={
                                                                    syncSettings.notifyDigestFrequency ||
                                                                    "daily"
                                                                }
                                                            >
                                                                <option value="daily">Daily</option>
                                                                <option value="weekly">
                                                                    Weekly
                                                                </option>
                                                            </select>
                                                            <ToggleSwitch
                                                                enabled={
                                                                    syncSettings.notifyDigestEnabled ||
                                                                    false
                                                                }
                                                                label="Toggle digest mode"
                                                                onChange={(v) =>
                                                                    handleSaveSetting(
                                                                        "notifyDigestEnabled",
                                                                        v
                                                                    )
                                                                }
                                                            />
                                                        </div>
                                                    </SettingRow>
                                                </div>

                                                {/* Devices - every push-subscribed browser/phone, with zero
                  visibility anywhere else in the app until now. Grab-and-drag
                  horizontal scroller, same interaction as Continue Watching's
                  row, rather than a plain list - reads as its own little
                  shelf instead of another settings list. */}
                                                {pushDevices.length > 0 && (
                                                    <div className="border-default border-t pt-4">
                                                        <label className="mb-1 block font-medium text-default text-sm">
                                                            Devices
                                                        </label>
                                                        <p className="mb-3 text-muted text-xs">
                                                            Every browser or phone currently
                                                            subscribed to push notifications on this
                                                            account.
                                                        </p>
                                                        <div
                                                            className="no-scrollbar flex cursor-grab select-none gap-3 overflow-x-auto pb-1 active:cursor-grabbing"
                                                            onPointerDown={handleDevicesPointerDown}
                                                            onPointerLeave={handleDevicesPointerUp}
                                                            onPointerMove={handleDevicesPointerMove}
                                                            onPointerUp={handleDevicesPointerUp}
                                                            ref={devicesRowRef}
                                                        >
                                                            {pushDevices.map((device) => {
                                                                const mobile = isMobileDevice(
                                                                    device.userAgent
                                                                );
                                                                const displayName =
                                                                    device.label ||
                                                                    guessDeviceName(
                                                                        device.userAgent
                                                                    );
                                                                const isEditing =
                                                                    editingDeviceId === device.id;
                                                                return (
                                                                    <div
                                                                        className="flex w-44 shrink-0 flex-col gap-2 rounded-xl border border-default p-3"
                                                                        key={device.id}
                                                                        style={{
                                                                            background:
                                                                                "var(--color-subtle)",
                                                                        }}
                                                                    >
                                                                        <div className="flex items-center justify-between">
                                                                            <div
                                                                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                                                                                style={{
                                                                                    background:
                                                                                        "var(--color-primary-muted)",
                                                                                }}
                                                                            >
                                                                                {mobile ? (
                                                                                    <DevicePhoneMobileIcon className="h-4 w-4 text-primary" />
                                                                                ) : (
                                                                                    <ComputerDesktopIcon className="h-4 w-4 text-primary" />
                                                                                )}
                                                                            </div>
                                                                            <button
                                                                                className="rounded-md p-1 text-subtle transition-colors hover:bg-surface hover:text-error"
                                                                                onClick={() =>
                                                                                    handleRevokeDevice(
                                                                                        device.id
                                                                                    )
                                                                                }
                                                                                title="Revoke this device"
                                                                                type="button"
                                                                            >
                                                                                <TrashIcon className="h-3.5 w-3.5" />
                                                                            </button>
                                                                        </div>

                                                                        {isEditing ? (
                                                                            <div className="flex items-center gap-1">
                                                                                <input
                                                                                    autoFocus
                                                                                    className="input-base w-full px-2 py-1 text-xs"
                                                                                    onChange={(e) =>
                                                                                        setEditingLabel(
                                                                                            e.target
                                                                                                .value
                                                                                        )
                                                                                    }
                                                                                    onKeyDown={(
                                                                                        e
                                                                                    ) => {
                                                                                        if (
                                                                                            e.key ===
                                                                                            "Enter"
                                                                                        ) {
                                                                                            handleRenameDevice(
                                                                                                device.id
                                                                                            );
                                                                                        }
                                                                                        if (
                                                                                            e.key ===
                                                                                            "Escape"
                                                                                        ) {
                                                                                            setEditingDeviceId(
                                                                                                null
                                                                                            );
                                                                                        }
                                                                                    }}
                                                                                    placeholder={guessDeviceName(
                                                                                        device.userAgent
                                                                                    )}
                                                                                    value={
                                                                                        editingLabel
                                                                                    }
                                                                                />
                                                                                <button
                                                                                    className="shrink-0 text-success"
                                                                                    onClick={() =>
                                                                                        handleRenameDevice(
                                                                                            device.id
                                                                                        )
                                                                                    }
                                                                                    type="button"
                                                                                >
                                                                                    <CheckIcon className="h-3.5 w-3.5" />
                                                                                </button>
                                                                                <button
                                                                                    className="shrink-0 text-subtle"
                                                                                    onClick={() =>
                                                                                        setEditingDeviceId(
                                                                                            null
                                                                                        )
                                                                                    }
                                                                                    type="button"
                                                                                >
                                                                                    <XMarkIcon className="h-3.5 w-3.5" />
                                                                                </button>
                                                                            </div>
                                                                        ) : (
                                                                            <button
                                                                                className="group flex items-center gap-1 text-left"
                                                                                onClick={() => {
                                                                                    setEditingDeviceId(
                                                                                        device.id
                                                                                    );
                                                                                    setEditingLabel(
                                                                                        device.label ||
                                                                                            ""
                                                                                    );
                                                                                }}
                                                                                type="button"
                                                                            >
                                                                                <p className="truncate font-medium text-default text-sm">
                                                                                    {displayName}
                                                                                </p>
                                                                                <PencilIcon className="h-3 w-3 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                                                                            </button>
                                                                        )}

                                                                        <p className="text-subtle text-xs">
                                                                            {formatLastSeen(
                                                                                device.lastSeenAt
                                                                            )}
                                                                        </p>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    </PageSection>
                                )}

                                {/* SlickTrax — opt-outs for SlickSync's native tracking surfaces
            (Watchlist, Watched indicators, Recommendations). All default ON.
            Turning any off hides its UI + skips its network requests
            immediately (the hook cache invalidates on save). */}
                                {activeTab === "features" && (
                                    <PageSection className="mb-6" delay={0.18}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                                                    <SparklesIcon className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        SlickTrax
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Toggle SlickSync&apos;s built-in tracking
                                                        system on or off. Your watch history is
                                                        unaffected — this only controls what you
                                                        see.
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <SettingRow
                                                    description="Bookmark items to watch later. Adds a ★ Watchlist source in Discover and an Add-to-Watchlist button on every detail page. Off: everything watchlist-related is hidden; saved items stay in the database until you re-enable."
                                                    label="Watchlist"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableWatchlist !== false
                                                        }
                                                        label="Toggle Watchlist"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableWatchlist" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Show ✓ checkmark badges on Discover posters for things you've already watched (from either provider), the Unwatched / Watched filter, and the Mark-as-watched menu option. Off: no badges, no filter, no menu item."
                                                    label="Watched indicators"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableWatchedIndicators !==
                                                            false
                                                        }
                                                        label="Toggle watched indicators"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableWatchedIndicators" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="The watch-ahead alarm: declare on a show's detail popup who is watching it together, and anyone starting an episode another member hasn't seen triggers a household alert. Off: the section disappears and no alerts fire, even for shows already set up."
                                                    label="Spoiler guard"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableWatchTogether !==
                                                            false
                                                        }
                                                        label="Toggle the spoiler guard"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableWatchTogether" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description={
                                                        'The "Because you watched X" rows on the Dashboard, computed from your watch-history genres. Off: no recommendations panel, no server-side genre computation.'
                                                    }
                                                    label="Recommendations"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableRecommendations !==
                                                            false
                                                        }
                                                        label="Toggle recommendations"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableRecommendations" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description={
                                                        'Detects a real taste cluster in your watch history (a genre, or a genre+decade combo like "90s Action") and saves it as an actual Catalog - e.g. "Your 90s Action Pack" - instead of a recommendation row that only scrolls by once. Checked daily; deleting a generated catalog stops it from coming back. Off by default.'
                                                    }
                                                    label="Auto-generated catalogs"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableAutoThemedCatalogs ===
                                                            true
                                                        }
                                                        label="Toggle auto-generated catalogs"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableAutoThemedCatalogs" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Adds an 'Airing this season' row to Discover with each show's next-episode countdown, from AniList - no API key needed. Off unless someone in the household actually watches anime."
                                                    label="Seasonal anime row"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.animeSeasonalRow === true
                                                        }
                                                        label="Toggle the seasonal anime row"
                                                        onChange={async (v) => {
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                animeSeasonalRow: v,
                                                            }));
                                                            try {
                                                                await api.updateSyncSettings({
                                                                    animeSeasonalRow: v,
                                                                });
                                                                toast.success(
                                                                    v
                                                                        ? "Seasonal anime row added to Discover"
                                                                        : "Seasonal anime row hidden"
                                                                );
                                                            } catch {
                                                                toast.error(
                                                                    "Could not save that setting"
                                                                );
                                                                setSyncSettings((prev) => ({
                                                                    ...prev,
                                                                    animeSeasonalRow: !v,
                                                                }));
                                                            }
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Show IMDb/Rotten Tomatoes/Metacritic score badges on every poster card in Discover and Catalogs - also the master switch for RPDB's rating-embedded posters below, if you've set a key. Off by default - turn this on if you want scores visible before opening a title."
                                                    label="Poster ratings"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enablePosterRatings ===
                                                            true
                                                        }
                                                        label="Toggle poster ratings"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enablePosterRatings" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Thumbs up/down on the detail modal. Not just decorative - it feeds what SlickTrax recommends, boosting titles similar to what you reacted positively to and suppressing ones similar to what you didn't like."
                                                    label="Reactions"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableReactions !== false
                                                        }
                                                        label="Toggle reactions"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableReactions" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description={
                                                        'The "Also streaming on" row in the detail modal, showing subscription/free services a title is available on (via TMDb/JustWatch).'
                                                    }
                                                    label="Streaming availability"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableWatchProviders !==
                                                            false
                                                        }
                                                        label="Toggle streaming availability"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableWatchProviders" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="When you open a title's detail popup, its trailer starts playing automatically instead of waiting for a Play Trailer click. Off by default - turn this on if you want it."
                                                    label="Autoplay trailer"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.enableAutoplayTrailer ===
                                                            true
                                                        }
                                                        label="Toggle autoplay trailer"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "enableAutoplayTrailer" as keyof SyncSettings,
                                                                v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>

                                                <SettingRow
                                                    description="Whether the autoplayed trailer starts muted (default) or with sound. An explicit Play Trailer click always has sound regardless of this."
                                                    disabled={
                                                        syncSettings.enableAutoplayTrailer !== true
                                                    }
                                                    label="Autoplay with sound"
                                                >
                                                    <ToggleSwitch
                                                        enabled={
                                                            syncSettings.autoplayTrailerStartMuted ===
                                                            false
                                                        }
                                                        label="Toggle autoplay trailer sound"
                                                        onChange={async (v) => {
                                                            await handleSaveSetting(
                                                                "autoplayTrailerStartMuted" as keyof SyncSettings,
                                                                !v
                                                            );
                                                            invalidatePersonalFeatures();
                                                        }}
                                                    />
                                                </SettingRow>
                                            </div>
                                        </Card>
                                    </PageSection>
                                )}

                                {/* External API Keys — every external service key SlickSync can use, split
            out from SlickTrax so that card stays pure on/off toggles.
            Each one is optional and account-scoped: resolved from here
            first, falling back to the instance's own env var (if the
            operator configured one) only when this is left blank - never
            a flat shared key silently used across every account. */}
                                {activeTab === "integrations" && (
                                    <PageSection className="mb-6" delay={0.19}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                                                    <KeyIcon className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        External API Keys
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Optional keys for external services. Yours
                                                        first, the server's own (if configured) as a
                                                        fallback.
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                {/* AI Services key - powers natural-language Catalog building
                  (Catalogs -> "Describe a catalog"). Placed first/most
                  prominent of this group deliberately: this used to only be
                  configurable from a generic Vault "add credential" entry
                  with no explanation of what it did, which made it easy to
                  add a key there and have no idea whether it was doing
                  anything. Still stored as a Vault entry underneath (see
                  api.ts), just with a clear, focused front door here. */}
                                                <div
                                                    className="rounded-xl p-3"
                                                    style={{
                                                        background: "var(--color-surface-hover)",
                                                        border: "1px solid var(--color-surface-border)",
                                                    }}
                                                >
                                                    <div className="mb-1.5 flex items-center justify-between">
                                                        <label className="block font-medium text-default text-sm">
                                                            AI Services{" "}
                                                            <span className="font-normal text-subtle">
                                                                (optional)
                                                            </span>
                                                        </label>
                                                        <div className="flex items-center gap-2">
                                                            {isSavingAi && (
                                                                <span className="text-subtle text-xs">
                                                                    Verifying...
                                                                </span>
                                                            )}
                                                            {!isSavingAi &&
                                                                aiConfigured &&
                                                                aiCheckStatus === "ok" && (
                                                                    <span
                                                                        className="rounded-full px-2 py-0.5 font-medium text-xs"
                                                                        style={{
                                                                            background:
                                                                                "var(--color-success-muted)",
                                                                            color: "var(--color-success)",
                                                                        }}
                                                                    >
                                                                        Verified
                                                                    </span>
                                                                )}
                                                            {!isSavingAi &&
                                                                aiConfigured &&
                                                                aiCheckStatus === "error" && (
                                                                    <span
                                                                        className="rounded-full px-2 py-0.5 font-medium text-xs"
                                                                        style={{
                                                                            background:
                                                                                "var(--color-error-muted)",
                                                                            color: "var(--color-error)",
                                                                        }}
                                                                        title={
                                                                            aiCheckMessage ||
                                                                            undefined
                                                                        }
                                                                    >
                                                                        Check failed
                                                                    </span>
                                                                )}
                                                            {!isSavingAi &&
                                                                aiConfigured &&
                                                                !aiCheckStatus && (
                                                                    <span
                                                                        className="rounded-full px-2 py-0.5 font-medium text-xs"
                                                                        style={{
                                                                            background:
                                                                                "var(--color-surface-border)",
                                                                            color: "var(--color-text-muted)",
                                                                        }}
                                                                    >
                                                                        Not yet verified
                                                                    </span>
                                                                )}
                                                            {aiConfigured && (
                                                                <button
                                                                    className="text-subtle transition-colors hover:text-error"
                                                                    onClick={handleRemoveAiServices}
                                                                    title="Remove AI Services"
                                                                    type="button"
                                                                >
                                                                    <XMarkIcon className="h-4 w-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Powers natural-language Catalog building
                                                        (Catalogs → &quot;Describe a catalog&quot;)
                                                        — describe what you want in plain English
                                                        and get a real saved Catalog back. Works
                                                        without a key too, using a built-in keyword
                                                        parser; adding one here just makes it
                                                        understand nuanced descriptions better.
                                                        Defaults to OpenAI, but any
                                                        OpenAI-compatible endpoint works
                                                        (OpenRouter, Groq, a local proxy) - the base
                                                        URL and model need to actually match each
                                                        other (a Gemini model name against
                                                        OpenAI&apos;s own endpoint will fail).
                                                    </p>
                                                    {aiCheckStatus === "error" &&
                                                        aiCheckMessage && (
                                                            <p
                                                                className="mb-2 text-xs"
                                                                style={{
                                                                    color: "var(--color-error)",
                                                                }}
                                                            >
                                                                {aiCheckMessage}
                                                            </p>
                                                        )}
                                                    <div className="space-y-2">
                                                        <div className="relative">
                                                            <input
                                                                autoComplete="off"
                                                                className="input-base w-full px-3 py-2 pr-10 text-sm"
                                                                onBlur={handleAiFieldBlur}
                                                                onChange={(e) =>
                                                                    setAiApiKey(e.target.value)
                                                                }
                                                                placeholder={
                                                                    aiConfigured
                                                                        ? "•••••••• (leave blank to keep current)"
                                                                        : "API key"
                                                                }
                                                                spellCheck={false}
                                                                type={
                                                                    aiKeyVisible
                                                                        ? "text"
                                                                        : "password"
                                                                }
                                                                value={aiApiKey}
                                                            />
                                                            {aiConfigured && (
                                                                <button
                                                                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 transition-colors hover:bg-surface-hover"
                                                                    onClick={() => {
                                                                        if (!aiKeyVisible) {
                                                                            handleRevealAiKey();
                                                                        }
                                                                        setAiKeyVisible((v) => !v);
                                                                    }}
                                                                    onMouseDown={(e) =>
                                                                        e.preventDefault()
                                                                    } // don't steal focus from the input before the click registers
                                                                    style={{
                                                                        color: "var(--color-text-muted)",
                                                                    }}
                                                                    tabIndex={-1}
                                                                    title={
                                                                        aiKeyVisible
                                                                            ? "Hide key"
                                                                            : "Show key"
                                                                    }
                                                                    type="button"
                                                                >
                                                                    {aiKeyVisible ? (
                                                                        <EyeSlashIcon className="h-4 w-4" />
                                                                    ) : (
                                                                        <EyeIcon className="h-4 w-4" />
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                            <ComboBox
                                                                onBlur={handleAiFieldBlur}
                                                                onChange={setAiBaseUrl}
                                                                options={AI_BASE_URL_OPTIONS}
                                                                placeholder="API base URL (optional, default OpenAI)"
                                                                value={aiBaseUrl}
                                                            />
                                                            <ComboBox
                                                                onBlur={handleAiFieldBlur}
                                                                onChange={setAiModel}
                                                                options={aiModelOptions}
                                                                placeholder="Model (optional, default gpt-5.2-mini)"
                                                                value={aiModel}
                                                            />
                                                        </div>
                                                        <p className="text-[11px] text-subtle">
                                                            {loadingAiModels
                                                                ? "Loading current models from the provider..."
                                                                : liveAiModels.length > 0
                                                                  ? `${liveAiModels.length} models loaded live from the provider.`
                                                                  : "Showing common suggestions - enter a key to load the provider's actual current model list."}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Manual trigger for the daily key-validity check (see
                  server/utils/metadataKeyHealth.js) - runs automatically
                  once a day regardless, this is just "check right now"
                  instead of waiting. Shown once, above all four key fields
                  rather than duplicated per-field, since one click checks
                  whichever of the four are actually configured. */}
                                                <div className="flex items-center justify-between pb-1">
                                                    <span className="font-medium text-default text-sm">
                                                        Provider key status
                                                    </span>
                                                    <Button
                                                        disabled={checkingKeys}
                                                        onClick={handleCheckProviderKeys}
                                                        size="sm"
                                                        variant="secondary"
                                                    >
                                                        {checkingKeys
                                                            ? "Checking…"
                                                            : "Check keys now"}
                                                    </Button>
                                                </div>

                                                {/* TMDb key for the cast/crew deep-dive. Text field, not a
                  toggle - the feature simply appears once a valid key is set.
                  Free from themoviedb.org (Settings -> API). Saved on blur,
                  same pattern as the webhook URL above. */}
                                                <div>
                                                    <div className="mb-1.5 flex items-center justify-between">
                                                        <label className="block font-medium text-default text-sm">
                                                            TMDb API key{" "}
                                                            <span className="font-normal text-subtle">
                                                                (optional)
                                                            </span>
                                                        </label>
                                                        {syncSettings.tmdbApiKey ? (
                                                            syncSettings.keyHealth?.tmdb ? (
                                                                <ProviderKeyHealthBadge
                                                                    result={
                                                                        syncSettings.keyHealth.tmdb
                                                                    }
                                                                />
                                                            ) : (
                                                                <ProviderKeyHealthUnchecked />
                                                            )
                                                        ) : null}
                                                    </div>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Enables the cast/crew deep-dive — click any
                                                        actor in a title's detail popup to see
                                                        everything else they're in. Get a free key
                                                        at themoviedb.org → Settings → API. Leave
                                                        blank to keep the feature off.
                                                    </p>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onBlur={async () => {
                                                            await handleSaveSetting(
                                                                "tmdbApiKey" as keyof SyncSettings,
                                                                syncSettings.tmdbApiKey
                                                            );
                                                            checkSingleKey(
                                                                "tmdb",
                                                                syncSettings.tmdbApiKey
                                                            );
                                                        }}
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                tmdbApiKey: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="TMDb API key"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.tmdbApiKey || ""}
                                                    />
                                                    <BackupKeyField
                                                        field="tmdbApiKeyBackup"
                                                        onChange={(v) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                tmdbApiKeyBackup: v,
                                                            }))
                                                        }
                                                        onSave={() =>
                                                            handleSaveSetting(
                                                                "tmdbApiKeyBackup" as keyof SyncSettings,
                                                                syncSettings.tmdbApiKeyBackup
                                                            )
                                                        }
                                                        primaryFilled={!!syncSettings.tmdbApiKey}
                                                        value={syncSettings.tmdbApiKeyBackup || ""}
                                                    />
                                                    <PoolKeysField
                                                        field="tmdbApiKeyPool"
                                                        keys={syncSettings.tmdbApiKeyPool || []}
                                                        onSave={async (next) => {
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                tmdbApiKeyPool: next,
                                                            }));
                                                            await api.updateSyncSettings({
                                                                tmdbApiKeyPool: next,
                                                            });
                                                        }}
                                                        primaryFilled={!!syncSettings.tmdbApiKey}
                                                    />
                                                </div>

                                                {/* MDBList key for List import (Lists page - "Import"). Free
                  from mdblist.com -> Preferences -> API Access. Same
                  optional-text-field pattern as the TMDb key above. */}
                                                <div className="pt-1">
                                                    <div className="mb-1.5 flex items-center justify-between">
                                                        <label className="block font-medium text-default text-sm">
                                                            MDBList API key{" "}
                                                            <span className="font-normal text-subtle">
                                                                (optional)
                                                            </span>
                                                        </label>
                                                        {syncSettings.mdblistApiKey ? (
                                                            syncSettings.keyHealth?.mdblist ? (
                                                                <ProviderKeyHealthBadge
                                                                    result={
                                                                        syncSettings.keyHealth
                                                                            .mdblist
                                                                    }
                                                                />
                                                            ) : (
                                                                <ProviderKeyHealthUnchecked />
                                                            )
                                                        ) : null}
                                                    </div>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Enables importing an MDBList list into
                                                        Lists. Get a free key at mdblist.com →
                                                        Preferences → API Access. Leave blank to
                                                        keep list import to TMDb lists only.
                                                    </p>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onBlur={async () => {
                                                            await handleSaveSetting(
                                                                "mdblistApiKey" as keyof SyncSettings,
                                                                syncSettings.mdblistApiKey
                                                            );
                                                            checkSingleKey(
                                                                "mdblist",
                                                                syncSettings.mdblistApiKey
                                                            );
                                                        }}
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                mdblistApiKey: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="MDBList API key"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.mdblistApiKey || ""}
                                                    />
                                                    <BackupKeyField
                                                        field="mdblistApiKeyBackup"
                                                        onChange={(v) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                mdblistApiKeyBackup: v,
                                                            }))
                                                        }
                                                        onSave={() =>
                                                            handleSaveSetting(
                                                                "mdblistApiKeyBackup" as keyof SyncSettings,
                                                                syncSettings.mdblistApiKeyBackup
                                                            )
                                                        }
                                                        primaryFilled={!!syncSettings.mdblistApiKey}
                                                        value={
                                                            syncSettings.mdblistApiKeyBackup || ""
                                                        }
                                                    />
                                                    <PoolKeysField
                                                        field="mdblistApiKeyPool"
                                                        keys={syncSettings.mdblistApiKeyPool || []}
                                                        onSave={async (next) => {
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                mdblistApiKeyPool: next,
                                                            }));
                                                            await api.updateSyncSettings({
                                                                mdblistApiKeyPool: next,
                                                            });
                                                        }}
                                                        primaryFilled={!!syncSettings.mdblistApiKey}
                                                    />
                                                </div>

                                                {/* RPDB key - upgrades posters app-wide (Discover, Lists,
                  Activity, Airing Calendar) to rating-embedded art. The free
                  tier (Tier 0) already includes ratings, just not the
                  customizable badge styles - plenty for this purpose. */}
                                                <div className="pt-1">
                                                    <div className="mb-1.5 flex items-center justify-between">
                                                        <label className="block font-medium text-default text-sm">
                                                            RPDB API key{" "}
                                                            <span className="font-normal text-subtle">
                                                                (optional)
                                                            </span>
                                                        </label>
                                                        {syncSettings.rpdbApiKey ? (
                                                            syncSettings.keyHealth?.rpdb ? (
                                                                <ProviderKeyHealthBadge
                                                                    result={
                                                                        syncSettings.keyHealth.rpdb
                                                                    }
                                                                />
                                                            ) : (
                                                                <ProviderKeyHealthUnchecked />
                                                            )
                                                        ) : null}
                                                    </div>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Upgrades posters everywhere to
                                                        rating-embedded art from RatingPosterDB,
                                                        when Poster ratings (in SlickTrax above) is
                                                        also on. The free key works fine. Get one at
                                                        ratingposterdb.com → API Key. Leave blank to
                                                        keep today's posters.
                                                    </p>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onBlur={async () => {
                                                            await handleSaveSetting(
                                                                "rpdbApiKey" as keyof SyncSettings,
                                                                syncSettings.rpdbApiKey
                                                            );
                                                            invalidatePersonalFeatures();
                                                            checkSingleKey(
                                                                "rpdb",
                                                                syncSettings.rpdbApiKey
                                                            );
                                                        }}
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                rpdbApiKey: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="RPDB API key"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.rpdbApiKey || ""}
                                                    />
                                                    <BackupKeyField
                                                        field="rpdbApiKeyBackup"
                                                        onChange={(v) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                rpdbApiKeyBackup: v,
                                                            }))
                                                        }
                                                        onSave={() =>
                                                            handleSaveSetting(
                                                                "rpdbApiKeyBackup" as keyof SyncSettings,
                                                                syncSettings.rpdbApiKeyBackup
                                                            )
                                                        }
                                                        primaryFilled={!!syncSettings.rpdbApiKey}
                                                        value={syncSettings.rpdbApiKeyBackup || ""}
                                                    />
                                                    <PoolKeysField
                                                        field="rpdbApiKeyPool"
                                                        keys={syncSettings.rpdbApiKeyPool || []}
                                                        onSave={async (next) => {
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                rpdbApiKeyPool: next,
                                                            }));
                                                            await api.updateSyncSettings({
                                                                rpdbApiKeyPool: next,
                                                            });
                                                        }}
                                                        primaryFilled={!!syncSettings.rpdbApiKey}
                                                    />
                                                </div>

                                                {/* OMDb key - Rotten Tomatoes/Metacritic ratings on posters and
                  the detail modal, account-scoped like the three keys above
                  it so this account's OMDb quota isn't shared with everyone
                  else on the instance. */}
                                                <div className="pt-1">
                                                    <div className="mb-1.5 flex items-center justify-between">
                                                        <label className="block font-medium text-default text-sm">
                                                            OMDb API key{" "}
                                                            <span className="font-normal text-subtle">
                                                                (optional)
                                                            </span>
                                                        </label>
                                                        {syncSettings.omdbApiKey ? (
                                                            syncSettings.keyHealth?.omdb ? (
                                                                <ProviderKeyHealthBadge
                                                                    result={
                                                                        syncSettings.keyHealth.omdb
                                                                    }
                                                                />
                                                            ) : (
                                                                <ProviderKeyHealthUnchecked />
                                                            )
                                                        ) : null}
                                                    </div>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Adds Rotten Tomatoes/Metacritic ratings. Get
                                                        a free key at omdbapi.com/apikey.aspx. Paste
                                                        just the key itself, not the test URL OMDb's
                                                        confirmation email shows (the one starting
                                                        "http://www.omdbapi.com/?i=..."). Leave
                                                        blank to use the server's own key, if one is
                                                        configured.
                                                    </p>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onBlur={async () => {
                                                            await handleSaveSetting(
                                                                "omdbApiKey" as keyof SyncSettings,
                                                                syncSettings.omdbApiKey
                                                            );
                                                            checkSingleKey(
                                                                "omdb",
                                                                syncSettings.omdbApiKey
                                                            );
                                                        }}
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                omdbApiKey: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="OMDb API key"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.omdbApiKey || ""}
                                                    />
                                                    <BackupKeyField
                                                        field="omdbApiKeyBackup"
                                                        onChange={(v) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                omdbApiKeyBackup: v,
                                                            }))
                                                        }
                                                        onSave={() =>
                                                            handleSaveSetting(
                                                                "omdbApiKeyBackup" as keyof SyncSettings,
                                                                syncSettings.omdbApiKeyBackup
                                                            )
                                                        }
                                                        primaryFilled={!!syncSettings.omdbApiKey}
                                                        value={syncSettings.omdbApiKeyBackup || ""}
                                                    />
                                                    <PoolKeysField
                                                        field="omdbApiKeyPool"
                                                        keys={syncSettings.omdbApiKeyPool || []}
                                                        onSave={async (next) => {
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                omdbApiKeyPool: next,
                                                            }));
                                                            await api.updateSyncSettings({
                                                                omdbApiKeyPool: next,
                                                            });
                                                        }}
                                                        primaryFilled={!!syncSettings.omdbApiKey}
                                                    />
                                                </div>

                                                {/* Pool behavior - both opt-in, both meaningless without pool
                  keys, hence living right under the pool fields. */}
                                                {(
                                                    [
                                                        "tmdbApiKeyPool",
                                                        "omdbApiKeyPool",
                                                        "mdblistApiKeyPool",
                                                        "rpdbApiKeyPool",
                                                    ] as const
                                                ).some(
                                                    (f) => (syncSettings[f] || []).length > 0
                                                ) && (
                                                    <div className="space-y-2 pt-1">
                                                        <SettingRow
                                                            description="Send requests to the pool key with the most allowance left instead of taking strict turns. Applies where usage is reported (MDBList today); other providers keep taking turns."
                                                            label="Spread by remaining quota"
                                                        >
                                                            <ToggleSwitch
                                                                enabled={
                                                                    syncSettings.keyPoolQuotaWeighting ===
                                                                    true
                                                                }
                                                                label="Toggle quota-aware pool weighting"
                                                                onChange={async (v) => {
                                                                    setSyncSettings((prev) => ({
                                                                        ...prev,
                                                                        keyPoolQuotaWeighting: v,
                                                                    }));
                                                                    try {
                                                                        await api.updateSyncSettings(
                                                                            {
                                                                                keyPoolQuotaWeighting:
                                                                                    v,
                                                                            }
                                                                        );
                                                                        toast.success(
                                                                            v
                                                                                ? "Pool requests now favor the key with the most quota left"
                                                                                : "Pool back to taking strict turns"
                                                                        );
                                                                    } catch {
                                                                        toast.error(
                                                                            "Could not save that setting"
                                                                        );
                                                                        setSyncSettings((prev) => ({
                                                                            ...prev,
                                                                            keyPoolQuotaWeighting:
                                                                                !v,
                                                                        }));
                                                                    }
                                                                }}
                                                            />
                                                        </SettingRow>
                                                        <SettingRow
                                                            description="Once today's OMDb usage passes 90%, background work (decorating notifications) stops fetching ratings until the midnight-UTC reset, so the rest of the allowance stays for what you actually open. Titles you open always fetch. Content-rating checks are never paused."
                                                            label="Pause background lookups near the cap"
                                                        >
                                                            <ToggleSwitch
                                                                enabled={
                                                                    syncSettings.quotaAutopilot ===
                                                                    true
                                                                }
                                                                label="Toggle quota autopilot"
                                                                onChange={async (v) => {
                                                                    setSyncSettings((prev) => ({
                                                                        ...prev,
                                                                        quotaAutopilot: v,
                                                                    }));
                                                                    try {
                                                                        await api.updateSyncSettings(
                                                                            { quotaAutopilot: v }
                                                                        );
                                                                        toast.success(
                                                                            v
                                                                                ? "Background lookups will stand down near the daily cap"
                                                                                : "Background lookups will always run"
                                                                        );
                                                                    } catch {
                                                                        toast.error(
                                                                            "Could not save that setting"
                                                                        );
                                                                        setSyncSettings((prev) => ({
                                                                            ...prev,
                                                                            quotaAutopilot: !v,
                                                                        }));
                                                                    }
                                                                }}
                                                            />
                                                        </SettingRow>
                                                        <SettingRow
                                                            description="A pool key that has been failing for 3 straight days is removed from the pool automatically, with a notification naming it. Your primary and backup keys are never touched."
                                                            label="Auto-retire failing pool keys"
                                                        >
                                                            <ToggleSwitch
                                                                enabled={
                                                                    syncSettings.keyPoolAutoRetire ===
                                                                    true
                                                                }
                                                                label="Toggle auto-retire for failing pool keys"
                                                                onChange={async (v) => {
                                                                    setSyncSettings((prev) => ({
                                                                        ...prev,
                                                                        keyPoolAutoRetire: v,
                                                                    }));
                                                                    try {
                                                                        await api.updateSyncSettings(
                                                                            { keyPoolAutoRetire: v }
                                                                        );
                                                                        toast.success(
                                                                            v
                                                                                ? "Dead pool keys will retire themselves after 3 days"
                                                                                : "Pool keys will only be removed by hand"
                                                                        );
                                                                    } catch {
                                                                        toast.error(
                                                                            "Could not save that setting"
                                                                        );
                                                                        setSyncSettings((prev) => ({
                                                                            ...prev,
                                                                            keyPoolAutoRetire: !v,
                                                                        }));
                                                                    }
                                                                }}
                                                            />
                                                        </SettingRow>
                                                    </div>
                                                )}

                                                {/* LumiereDB - IMDb's data, self-hosted (utils/lumiere.js).
                  Self-hosted instances only: IMDb's data is for personal use. */}
                                                {!isPublicInstance && (
                                                    <LumiereDbField
                                                        onChange={(v) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                lumiereDbUrl: v,
                                                            }))
                                                        }
                                                        onSave={(v) =>
                                                            handleSaveSetting(
                                                                "lumiereDbUrl" as keyof SyncSettings,
                                                                v
                                                            )
                                                        }
                                                        value={syncSettings.lumiereDbUrl || ""}
                                                    />
                                                )}

                                                {/* SIMKL Client ID - powers the "Link SIMKL" flow on a user's
                  own page (watch-history pull/push). Account-scoped like the
                  keys above so this account isn't dependent on whatever the
                  server operator did or didn't configure in .env. */}
                                                <div className="pt-1">
                                                    <label className="mb-1.5 block font-medium text-default text-sm">
                                                        SIMKL Client ID{" "}
                                                        <span className="font-normal text-subtle">
                                                            (optional)
                                                        </span>
                                                    </label>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Powers linking a user&apos;s SIMKL account
                                                        for watch-history sync. Get one free: sign
                                                        in at{" "}
                                                        <a
                                                            className="text-primary hover:underline"
                                                            href="https://simkl.com/settings/developer"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            simkl.com/settings/developer
                                                        </a>{" "}
                                                        → under &quot;List of your apps&quot;, click{" "}
                                                        <strong>+ Add a New App</strong> → give it
                                                        any name and redirect URI (SlickSync&apos;s
                                                        SIMKL login is PIN-based, so the redirect
                                                        URI is never actually used — any placeholder
                                                        like https://slicksync.local works) → paste
                                                        the <strong>Client ID</strong> it shows you
                                                        here. The Client Secret isn&apos;t needed.
                                                        Leave blank to use the server&apos;s own, if
                                                        one is configured.
                                                    </p>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onBlur={() =>
                                                            handleSaveSetting(
                                                                "simklClientId" as keyof SyncSettings,
                                                                syncSettings.simklClientId
                                                            )
                                                        }
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                simklClientId: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="SIMKL Client ID"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.simklClientId || ""}
                                                    />
                                                </div>

                                                {/* Trakt Client ID - public LISTS only, which is all a client id
                  can read. Deliberately not an account bridge: Trakt limits a
                  free account to one connected app, so connecting SlickSync
                  would evict whatever Trakt app someone already uses. */}
                                                <div className="pt-1">
                                                    <label className="mb-1.5 block font-medium text-default text-sm">
                                                        Trakt Client ID{" "}
                                                        <span className="font-normal text-subtle">
                                                            (optional)
                                                        </span>
                                                    </label>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Lets you import a public Trakt list by
                                                        pasting its URL into Catalogs → Import. Get
                                                        one free at{" "}
                                                        <a
                                                            className="text-primary hover:underline"
                                                            href="https://trakt.tv/oauth/applications/new"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            trakt.tv/oauth/applications/new
                                                        </a>{" "}
                                                        → any name, any redirect URI → paste the{" "}
                                                        <strong>Client ID</strong> here. This reads
                                                        public lists only; it does not connect a
                                                        Trakt account, and it does not use up the
                                                        one connected-app slot a free Trakt account
                                                        gets.
                                                    </p>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onBlur={() =>
                                                            handleSaveSetting(
                                                                "traktClientId" as keyof SyncSettings,
                                                                syncSettings.traktClientId
                                                            )
                                                        }
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                traktClientId: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="Trakt Client ID"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.traktClientId || ""}
                                                    />
                                                </div>

                                                {/* MyAnimeList Client ID - public lists only, same shape as
                  Trakt above. Jikan (the keyless MAL mirror) would have
                  avoided this key entirely, but MAL removed the endpoint it
                  read lists from and it now answers list requests with
                  "MyAnimeList refuses to connect", so a key that works beats
                  no key that does not. */}
                                                <div className="pt-1">
                                                    <label className="mb-1.5 block font-medium text-default text-sm">
                                                        MyAnimeList Client ID{" "}
                                                        <span className="font-normal text-subtle">
                                                            (optional)
                                                        </span>
                                                    </label>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Lets you import a public MyAnimeList anime
                                                        list by pasting its URL into Catalogs →
                                                        Import. Get one free at{" "}
                                                        <a
                                                            className="text-primary hover:underline"
                                                            href="https://myanimelist.net/apiconfig/create"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            myanimelist.net/apiconfig/create
                                                        </a>{" "}
                                                        → any name, App Type &quot;other&quot;, any
                                                        redirect URI → paste the{" "}
                                                        <strong>Client ID</strong> here. This reads
                                                        public lists only and does not connect your
                                                        MAL account. AniList lists need no key at
                                                        all.
                                                    </p>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base w-full px-3 py-2 text-sm"
                                                        onBlur={() =>
                                                            handleSaveSetting(
                                                                "malClientId" as keyof SyncSettings,
                                                                syncSettings.malClientId
                                                            )
                                                        }
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                malClientId: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="MyAnimeList Client ID"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.malClientId || ""}
                                                    />
                                                </div>

                                                {/* Self-hosted Nuvio backend. Account-scoped like everything
                  else here - Nuvio's backend was previously the one
                  integration that could ONLY be set instance-wide via env
                  vars, needing a container restart to change. */}
                                                <div className="pt-1">
                                                    <label className="mb-1.5 block font-medium text-default text-sm">
                                                        Nuvio backend URL{" "}
                                                        <span className="font-normal text-subtle">
                                                            (optional)
                                                        </span>
                                                    </label>
                                                    <p className="mb-2 text-muted text-xs">
                                                        Point Nuvio at your own{" "}
                                                        <a
                                                            className="text-primary hover:underline"
                                                            href="https://github.com/NuvioMedia/self-host"
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                        >
                                                            self-hosted backend
                                                        </a>{" "}
                                                        instead of the official one. Enter the
                                                        Backend URL from your deployment (e.g.
                                                        https://backend.example.com) and hit Detect
                                                        — it reads that server&apos;s own{" "}
                                                        <code>/.well-known/nuvio</code> to fill in
                                                        the key for you. Leave blank to use
                                                        api.nuvio.tv.
                                                    </p>
                                                    <div className="flex gap-2">
                                                        <input
                                                            autoComplete="off"
                                                            className="input-base min-w-0 flex-1 px-3 py-2 text-sm"
                                                            onBlur={() =>
                                                                handleSaveSetting(
                                                                    "nuvioServerUrl" as keyof SyncSettings,
                                                                    syncSettings.nuvioServerUrl
                                                                )
                                                            }
                                                            onChange={(e) =>
                                                                setSyncSettings((prev) => ({
                                                                    ...prev,
                                                                    nuvioServerUrl: e.target.value,
                                                                }))
                                                            }
                                                            placeholder="https://backend.example.com"
                                                            spellCheck={false}
                                                            type="text"
                                                            value={
                                                                syncSettings.nuvioServerUrl || ""
                                                            }
                                                        />
                                                        <Button
                                                            isLoading={nuvioDiscovering}
                                                            onClick={async () => {
                                                                const url = (
                                                                    syncSettings.nuvioServerUrl ||
                                                                    ""
                                                                ).trim();
                                                                if (!url) {
                                                                    toast.error(
                                                                        "Enter the backend URL first"
                                                                    );
                                                                    return;
                                                                }
                                                                setNuvioDiscovering(true);
                                                                try {
                                                                    const r =
                                                                        await api.discoverNuvioBackend(
                                                                            url
                                                                        );
                                                                    if (r.ok && r.anonKey) {
                                                                        setSyncSettings((prev) => ({
                                                                            ...prev,
                                                                            nuvioAnonKey: r.anonKey,
                                                                            nuvioServerUrl:
                                                                                r.url || url,
                                                                        }));
                                                                        await handleSaveSetting(
                                                                            "nuvioServerUrl" as keyof SyncSettings,
                                                                            r.url || url
                                                                        );
                                                                        await handleSaveSetting(
                                                                            "nuvioAnonKey" as keyof SyncSettings,
                                                                            r.anonKey
                                                                        );
                                                                        toast.success(
                                                                            "Backend detected and saved"
                                                                        );
                                                                    } else {
                                                                        // Not fatal - the manual key field below always works.
                                                                        toast.error(
                                                                            r.error ||
                                                                                "Could not read that backend - enter the anon key manually"
                                                                        );
                                                                    }
                                                                } catch (e) {
                                                                    // The server says why when it has a reason (an address it may not reach).
                                                                    toast.error(
                                                                        (e instanceof Error &&
                                                                            e.message) ||
                                                                            "Could not reach that backend - enter the anon key manually"
                                                                    );
                                                                } finally {
                                                                    setNuvioDiscovering(false);
                                                                }
                                                            }}
                                                            size="sm"
                                                            variant="secondary"
                                                        >
                                                            Detect
                                                        </Button>
                                                    </div>
                                                    <input
                                                        autoComplete="off"
                                                        className="input-base mt-2 w-full px-3 py-2 text-sm"
                                                        onBlur={() =>
                                                            handleSaveSetting(
                                                                "nuvioAnonKey" as keyof SyncSettings,
                                                                syncSettings.nuvioAnonKey
                                                            )
                                                        }
                                                        onChange={(e) =>
                                                            setSyncSettings((prev) => ({
                                                                ...prev,
                                                                nuvioAnonKey: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="Anon key (auto-filled by Detect, or paste it from ./nuvio credentials)"
                                                        spellCheck={false}
                                                        type="text"
                                                        value={syncSettings.nuvioAnonKey || ""}
                                                    />
                                                    <p className="mt-1.5 text-subtle text-xs">
                                                        Both fields are needed for the override to
                                                        apply — a URL on its own is ignored rather
                                                        than half-applied.
                                                    </p>
                                                </div>
                                            </div>
                                        </Card>
                                    </PageSection>
                                )}

                                {/* API Key */}
                                {activeTab === "integrations" && (
                                    <PageSection className="mb-6" delay={0.2}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success-muted">
                                                    <KeyIcon className="h-5 w-5 text-success" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        API Key
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Access the SlickSync API programmatically
                                                    </p>{" "}
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="mb-2 block font-medium text-default text-sm">
                                                        Your API Key
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <div className="flex flex-1 items-center gap-2 rounded-lg border border-default bg-subtle px-3 py-2">
                                                            <code className="flex-1 truncate font-mono text-muted text-sm">
                                                                {apiKeyVisible
                                                                    ? apiKey
                                                                    : hideSensitive
                                                                      ? "••••••••••••••••"
                                                                      : maskedApiKey}
                                                            </code>
                                                            <button
                                                                className="rounded p-1 transition-colors hover:bg-surface-hover"
                                                                onClick={() =>
                                                                    setApiKeyVisible(!apiKeyVisible)
                                                                }
                                                                title={
                                                                    apiKeyVisible ? "Hide" : "Show"
                                                                }
                                                                type="button"
                                                            >
                                                                {apiKeyVisible ? (
                                                                    <EyeSlashIcon className="h-4 w-4 text-muted" />
                                                                ) : (
                                                                    <EyeIcon className="h-4 w-4 text-muted" />
                                                                )}
                                                            </button>
                                                            <button
                                                                className="rounded p-1 transition-colors hover:bg-surface-hover"
                                                                disabled={!apiKey}
                                                                onClick={handleCopyApiKey}
                                                                title="Copy"
                                                                type="button"
                                                            >
                                                                <ClipboardDocumentIcon className="h-4 w-4 text-muted" />
                                                            </button>
                                                        </div>
                                                        <Button
                                                            isLoading={isGeneratingKey}
                                                            leftIcon={
                                                                <ArrowPathIcon className="h-4 w-4" />
                                                            }
                                                            onClick={handleGenerateApiKey}
                                                            size="sm"
                                                            variant="secondary"
                                                        >
                                                            {apiKey ? "Rotate" : "Generate"}
                                                        </Button>
                                                    </div>
                                                    <p className="mt-2 text-muted text-xs">
                                                        Use this key to authenticate API requests.
                                                        Keep it secret!
                                                    </p>
                                                    <a
                                                        className="mt-2 inline-flex items-center gap-1.5 text-primary text-xs hover:underline"
                                                        href="/api/docs"
                                                        rel="noopener noreferrer"
                                                        target="_blank"
                                                    >
                                                        Interactive API docs
                                                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                                                    </a>
                                                </div>

                                                {/* This key is account-level (this admin console) - a
                  genuinely different key from the per-user one Scrobbling
                  needs, which lives behind each person's own self-service
                  login. Called out explicitly since the two are easy to
                  conflate and only one works for scrobbling. */}
                                                <div className="border-default border-t pt-4">
                                                    <p className="text-muted text-xs">
                                                        Looking for the Scrobble-in API key or the
                                                        Public Stats Page toggle? Those are
                                                        per-user, self-service settings - log in at{" "}
                                                        <a
                                                            className="text-primary hover:underline"
                                                            href="/login?mode=user"
                                                        >
                                                            /login?mode=user
                                                        </a>{" "}
                                                        with that account&apos;s own Stremio/Nuvio
                                                        credentials, then check its Settings page.
                                                        This key above won&apos;t work for either.
                                                    </p>
                                                </div>
                                            </div>
                                        </Card>
                                        <div className="mt-6">
                                            <ShortcutRecipes
                                                apiKey={apiKey}
                                                baseUrl={
                                                    syncSettings.ownAddress ||
                                                    syncSettings.publicBaseUrl
                                                }
                                            />
                                        </div>
                                    </PageSection>
                                )}

                                {/* Passkeys - sign in with the device's own unlock instead of the
            password. Strictly an addition: the password never goes away, so
            a lost device cannot lock anyone out of their own instance. */}
                                {activeTab === "security" && (
                                    <PageSection className="mb-6" delay={0.205}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                                                    <FingerPrintIcon className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        Passkeys
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Sign in with Face ID, a fingerprint, a PIN
                                                        or a security key
                                                    </p>
                                                </div>
                                            </div>

                                            <p className="mb-4 text-muted text-xs">
                                                A passkey signs you in without typing the password -
                                                useful on a phone, and on a TV where typing anything
                                                is a chore. It never replaces the password: that
                                                still works, so losing a device can never lock you
                                                out of your own instance. A passkey belongs to the
                                                exact address you created it on
                                                {passkeyRpId ? (
                                                    <>
                                                        {" "}
                                                        (this one is{" "}
                                                        <span className="font-mono">
                                                            {passkeyRpId}
                                                        </span>
                                                        )
                                                    </>
                                                ) : null}
                                                , so add one on each address you actually sign in
                                                from.
                                            </p>

                                            {passkeySupported ? (
                                                <>
                                                    {passkeys.length > 0 && (
                                                        <div className="mb-4 space-y-2">
                                                            {passkeys.map((pk) => (
                                                                <div
                                                                    className="flex items-center justify-between gap-3 rounded-lg border border-default bg-subtle p-3"
                                                                    key={pk.id}
                                                                >
                                                                    <div className="min-w-0">
                                                                        <p className="truncate font-medium text-default text-sm">
                                                                            {pk.name}
                                                                        </p>
                                                                        <p className="text-muted text-xs">
                                                                            {pk.rpId ? (
                                                                                <span className="font-mono">
                                                                                    {pk.rpId}
                                                                                </span>
                                                                            ) : (
                                                                                "unknown address"
                                                                            )}
                                                                            {pk.rpId &&
                                                                            passkeyRpId &&
                                                                            pk.rpId !== passkeyRpId
                                                                                ? " - not offered on this address"
                                                                                : ""}
                                                                            {pk.lastUsedAt
                                                                                ? ` - last used ${new Date(pk.lastUsedAt).toLocaleDateString()}`
                                                                                : " - never used"}
                                                                        </p>
                                                                    </div>
                                                                    <Button
                                                                        onClick={() =>
                                                                            handleRemovePasskey(
                                                                                pk.id
                                                                            )
                                                                        }
                                                                        size="sm"
                                                                        variant="ghost"
                                                                    >
                                                                        Remove
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <Button
                                                        isLoading={passkeyBusy}
                                                        onClick={handleAddPasskey}
                                                        size="sm"
                                                        variant="secondary"
                                                    >
                                                        Add a passkey
                                                    </Button>
                                                </>
                                            ) : (
                                                <p className="text-muted text-sm">
                                                    This browser doesn&apos;t support passkeys.
                                                </p>
                                            )}
                                        </Card>
                                    </PageSection>
                                )}

                                {/* Two-Factor Authentication - opt-in TOTP on top of the account
            login. See server/utils/twoFactor.js for why disable/regenerate
            both require a fresh code rather than just an active session. */}
                                {activeTab === "security" && (
                                    <PageSection className="mb-6" delay={0.21}>
                                        <Card padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                                                    <ShieldCheckIcon className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        Two-Factor Authentication
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Require a code from an authenticator app to
                                                        sign in, on top of your password
                                                    </p>
                                                </div>
                                            </div>

                                            {twoFaEnabled === null ? (
                                                <p className="text-muted text-sm">Loading…</p>
                                            ) : twoFaSetup ? (
                                                <div className="space-y-4">
                                                    <div className="flex flex-col items-start gap-4 sm:flex-row">
                                                        <img
                                                            alt="2FA QR code"
                                                            className="h-40 w-40 shrink-0 rounded-lg border border-default bg-white p-2"
                                                            src={twoFaSetup.qrCodeDataUrl}
                                                        />
                                                        <div className="min-w-0 space-y-2">
                                                            <p className="text-default text-sm">
                                                                Scan this with your authenticator
                                                                app (Google Authenticator, Authy,
                                                                1Password, etc.), or enter the code
                                                                manually:
                                                            </p>
                                                            <code className="block break-all rounded border border-default bg-subtle px-2 py-1.5 font-mono text-muted text-xs">
                                                                {twoFaSetup.secret}
                                                            </code>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="mb-1.5 block font-medium text-default text-sm">
                                                            Enter the 6-digit code it shows
                                                        </label>
                                                        <div className="flex gap-2">
                                                            <input
                                                                autoFocus
                                                                className="input-base w-32 px-3 py-2 font-mono text-sm tracking-widest"
                                                                inputMode="numeric"
                                                                onChange={(e) =>
                                                                    setTwoFaSetupCode(
                                                                        e.target.value
                                                                            .replace(/\D/g, "")
                                                                            .slice(0, 6)
                                                                    )
                                                                }
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") {
                                                                        handleConfirm2fa();
                                                                    }
                                                                }}
                                                                placeholder="123456"
                                                                type="text"
                                                                value={twoFaSetupCode}
                                                            />
                                                            <Button
                                                                disabled={
                                                                    twoFaSetupCode.length !== 6 ||
                                                                    twoFaEnabling
                                                                }
                                                                isLoading={twoFaEnabling}
                                                                onClick={handleConfirm2fa}
                                                                size="sm"
                                                                variant="primary"
                                                            >
                                                                Confirm
                                                            </Button>
                                                            <Button
                                                                disabled={twoFaEnabling}
                                                                onClick={handleCancel2faSetup}
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                Cancel
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : twoFaEnabled ? (
                                                <div className="space-y-3">
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="success">Enabled</Badge>
                                                        <span className="text-muted text-xs">
                                                            You&apos;ll be asked for a code from
                                                            your authenticator app each time you
                                                            sign in
                                                        </span>
                                                    </div>
                                                    {twoFaDisablePrompt ? (
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                autoFocus
                                                                className="input-base w-40 px-3 py-2 font-mono text-sm"
                                                                inputMode="numeric"
                                                                onChange={(e) =>
                                                                    setTwoFaDisableCode(
                                                                        e.target.value
                                                                            .replace(/\D/g, "")
                                                                            .slice(0, 8)
                                                                    )
                                                                }
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") {
                                                                        handleDisable2fa();
                                                                    }
                                                                }}
                                                                placeholder="Code or backup code"
                                                                type="text"
                                                                value={twoFaDisableCode}
                                                            />
                                                            <Button
                                                                disabled={
                                                                    !twoFaDisableCode.trim() ||
                                                                    twoFaDisabling
                                                                }
                                                                isLoading={twoFaDisabling}
                                                                onClick={handleDisable2fa}
                                                                size="sm"
                                                                variant="danger"
                                                            >
                                                                Confirm disable
                                                            </Button>
                                                            <Button
                                                                disabled={twoFaDisabling}
                                                                onClick={() => {
                                                                    setTwoFaDisablePrompt(false);
                                                                    setTwoFaDisableCode("");
                                                                }}
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                Cancel
                                                            </Button>
                                                        </div>
                                                    ) : twoFaRegenPrompt ? (
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                autoFocus
                                                                className="input-base w-40 px-3 py-2 font-mono text-sm"
                                                                inputMode="numeric"
                                                                onChange={(e) =>
                                                                    setTwoFaRegenCode(
                                                                        e.target.value
                                                                            .replace(/\D/g, "")
                                                                            .slice(0, 8)
                                                                    )
                                                                }
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") {
                                                                        handleRegenerate2faBackupCodes();
                                                                    }
                                                                }}
                                                                placeholder="Current code"
                                                                type="text"
                                                                value={twoFaRegenCode}
                                                            />
                                                            <Button
                                                                disabled={
                                                                    !twoFaRegenCode.trim() ||
                                                                    twoFaRegenerating
                                                                }
                                                                isLoading={twoFaRegenerating}
                                                                onClick={
                                                                    handleRegenerate2faBackupCodes
                                                                }
                                                                size="sm"
                                                                variant="primary"
                                                            >
                                                                Confirm
                                                            </Button>
                                                            <Button
                                                                disabled={twoFaRegenerating}
                                                                onClick={() => {
                                                                    setTwoFaRegenPrompt(false);
                                                                    setTwoFaRegenCode("");
                                                                }}
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                Cancel
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-2">
                                                            <Button
                                                                onClick={() =>
                                                                    setTwoFaRegenPrompt(true)
                                                                }
                                                                size="sm"
                                                                variant="secondary"
                                                            >
                                                                Regenerate backup codes
                                                            </Button>
                                                            <Button
                                                                onClick={() =>
                                                                    setTwoFaDisablePrompt(true)
                                                                }
                                                                size="sm"
                                                                variant="danger"
                                                            >
                                                                Disable 2FA
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <Button
                                                    isLoading={twoFaStartingSetup}
                                                    onClick={handleStart2fa}
                                                    size="sm"
                                                    variant="primary"
                                                >
                                                    Enable 2FA
                                                </Button>
                                            )}
                                        </Card>
                                    </PageSection>
                                )}

                                {/* Backup codes - shown exactly once, right after enabling 2FA or
            regenerating codes. Closing this modal is the only way past it,
            same "you must acknowledge you saved this" pattern as the
            Disaster Recovery Kit passphrase reveal elsewhere in the app. */}
                                <Modal
                                    isOpen={!!twoFaBackupCodes}
                                    onClose={() => setTwoFaBackupCodes(null)}
                                    size="sm"
                                    title="Your backup codes"
                                >
                                    {twoFaBackupCodes && (
                                        <div className="space-y-3">
                                            <p className="text-default text-sm">
                                                Save these somewhere safe. Each one lets you sign in{" "}
                                                <strong>once</strong> if you lose access to your
                                                authenticator app. They won&apos;t be shown again.
                                            </p>
                                            <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-default bg-subtle p-3">
                                                {twoFaBackupCodes.map((c) => (
                                                    <code
                                                        className="font-mono text-default text-xs"
                                                        key={c}
                                                    >
                                                        {c}
                                                    </code>
                                                ))}
                                            </div>
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    leftIcon={
                                                        <ClipboardDocumentIcon className="h-4 w-4" />
                                                    }
                                                    onClick={handleCopyBackupCodes}
                                                    size="sm"
                                                    variant="ghost"
                                                >
                                                    Copy
                                                </Button>
                                                <Button
                                                    onClick={() => setTwoFaBackupCodes(null)}
                                                    size="sm"
                                                    variant="primary"
                                                >
                                                    I&apos;ve saved these
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </Modal>

                                {/* Account ID - public-mode login is a UUID with no recovery flow
            (per the register page's own warning), and there was previously
            nowhere to look it back up short of the Account dropdown modal.
            Always findable here for troubleshooting/support. */}
                                {activeTab === "security" &&
                                    isPublicInstance &&
                                    accountInfo?.uuid && (
                                        <PageSection className="mb-6" delay={0.22}>
                                            <Card padding="lg">
                                                <div className="mb-5 flex items-center gap-3">
                                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                                                        <KeyIcon className="h-5 w-5 text-primary" />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-display font-semibold text-base text-default">
                                                            Account ID
                                                        </h3>
                                                        <p className="text-muted text-xs">
                                                            Your login UUID - keep this handy for
                                                            support/troubleshooting
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 truncate rounded-xl border border-surface-border bg-bg px-4 py-3 font-mono text-default text-sm">
                                                        {accountInfo.uuid}
                                                    </div>
                                                    <Button
                                                        onClick={() => {
                                                            if (!accountInfo.uuid) {
                                                                return;
                                                            }
                                                            copyToClipboard(accountInfo.uuid);
                                                            setUuidCopied(true);
                                                            toast.success(
                                                                "Account ID copied to clipboard"
                                                            );
                                                            setTimeout(
                                                                () => setUuidCopied(false),
                                                                2000
                                                            );
                                                        }}
                                                        size="sm"
                                                        variant="secondary"
                                                    >
                                                        {uuidCopied ? (
                                                            <CheckIcon className="h-4 w-4" />
                                                        ) : (
                                                            <ClipboardDocumentIcon className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </Card>
                                        </PageSection>
                                    )}

                                {/* Danger Zone */}
                                {activeTab === "security" && (
                                    <PageSection delay={0.25}>
                                        <Card className="border-error" padding="lg">
                                            <div className="mb-5 flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-error-muted">
                                                    <ExclamationTriangleIcon className="h-5 w-5 text-error" />
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-semibold text-base text-default">
                                                        Danger Zone
                                                    </h3>
                                                    <p className="text-muted text-xs">
                                                        Irreversible actions
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between rounded-lg bg-error-muted p-4">
                                                    <div>
                                                        <p className="font-medium text-default text-sm">
                                                            Reset All Settings
                                                        </p>
                                                        <p className="text-muted text-xs">
                                                            Restore all settings to their defaults
                                                        </p>
                                                    </div>
                                                    <Button
                                                        leftIcon={
                                                            <ArrowPathIcon className="h-4 w-4" />
                                                        }
                                                        onClick={() => setIsResetModalOpen(true)}
                                                        size="sm"
                                                        variant="danger"
                                                    >
                                                        Reset
                                                    </Button>
                                                </div>

                                                {/* Public-mode only - private mode's "account" is the whole
                  shared instance, not a personal one a user should be able
                  to wipe from a settings toggle. */}
                                                {isPublicInstance && (
                                                    <div className="flex items-center justify-between rounded-lg bg-error-muted p-4">
                                                        <div>
                                                            <p className="font-medium text-default text-sm">
                                                                Delete Account
                                                            </p>
                                                            <p className="text-muted text-xs">
                                                                Permanently delete your SlickSync
                                                                account and all its data
                                                            </p>
                                                        </div>
                                                        <Button
                                                            leftIcon={
                                                                <TrashIcon className="h-4 w-4" />
                                                            }
                                                            onClick={() =>
                                                                setIsDeleteAccountModalOpen(true)
                                                            }
                                                            size="sm"
                                                            variant="danger"
                                                        >
                                                            Delete Account
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    </PageSection>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reset Confirmation Modal */}
            <ConfirmModal
                confirmText="Reset Settings"
                description="Are you sure you want to reset all settings to their defaults? This cannot be undone."
                isOpen={isResetModalOpen}
                onClose={() => setIsResetModalOpen(false)}
                onConfirm={handleReset}
                title="Reset Settings"
                variant="danger"
            />

            {/* Delete Account Confirmation Modal */}
            <ConfirmModal
                cancelText="No, keep my account"
                confirmText="Yes, delete everything"
                description="This permanently deletes your SlickSync account and every piece of data tied to it: all managed users, groups, addons, catalogs, watch history, Vault entries, and settings. There is no undo, no recovery, and no grace period - deletion happens immediately. If you're sure, click 'Yes, delete everything' below. Otherwise, click 'No, keep my account.'"
                isLoading={isDeletingAccount}
                isOpen={isDeleteAccountModalOpen}
                onClose={() => setIsDeleteAccountModalOpen(false)}
                onConfirm={handleDeleteAccount}
                title="Delete Your Account?"
                variant="danger"
            />

            {/* Avatar Picker Modal */}
            <AvatarPickerModal
                currentAvatarUrl={accountInfo?.avatarUrl}
                isOpen={avatarModalOpen}
                name={
                    isPublicInstance
                        ? accountInfo?.uuid || accountInfo?.email || "Admin"
                        : "Administrator"
                }
                onClose={() => setAvatarModalOpen(false)}
                onSave={handleAvatarSave}
            />
        </>
    );
}
