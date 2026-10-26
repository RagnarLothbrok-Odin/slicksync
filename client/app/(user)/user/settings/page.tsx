"use client";

import {
    ArrowPathIcon,
    BeakerIcon,
    BellIcon,
    ClipboardDocumentIcon,
    Cog6ToothIcon,
    EyeIcon,
    EyeSlashIcon,
    GlobeAltIcon,
    KeyIcon,
    PaintBrushIcon,
    ShieldCheckIcon,
    UserCircleIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { ProfilePictureSettings } from "@/components/settings/ProfilePictureSettings";
import { SettingRow, ToggleSwitch } from "@/components/settings/SettingRow";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import { ThemesPanel } from "@/components/settings/ThemesPanel";
import { Button, Card, ConfirmModal } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { usePersonalPreferences } from "@/components/user/PersonalPreferences";
import {
    PersonalDevicesPanel,
    PersonalDisplayPanel,
    PersonalHelpPanel,
    PersonalHistoryPanel,
    PersonalSyncPanel,
} from "@/components/user/PersonalSettingsPanels";
import { PersonPushRow } from "@/components/user/PersonPushRow";
import { TrackingServicesPanel } from "@/components/user/TrackingServicesPanel";
import { UserPageHeader } from "@/components/user/UserPageContainer";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { providerTypeLabel } from "@/lib/providers";
import { getUserApiKey, userAuth, userExport } from "@/lib/user-api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

import { AvatarPickerModal } from "@/components/modals/AvatarPickerModal";

const PERSONAL_SECTIONS = [
    {
        blurb: "Profile, privacy, and sharing",
        group: "Your experience",
        icon: UserCircleIcon,
        key: "general",
        keywords:
            "avatar picture profile visibility public stats export display beginner private sensitive poster ratings trailer autoplay sound",
        label: "General",
    },
    {
        blurb: "Your connection and next sync",
        group: "Your setup",
        icon: ArrowPathIcon,
        key: "sync",
        keywords: "sync status preview addons connection",
        label: "Sync",
    },
    {
        blurb: "Bring your watch history with you",
        group: "Your setup",
        icon: ClipboardDocumentIcon,
        key: "history",
        keywords: "import history csv trakt json export download restore",
        label: "History",
    },
    {
        blurb: "Make SlickSync feel like home",
        group: "Your experience",
        icon: PaintBrushIcon,
        key: "themes",
        keywords: "appearance colours color dark light theme",
        label: "Themes",
    },
    {
        blurb: "Push, watch alerts, and Discord",
        group: "Your experience",
        icon: BellIcon,
        key: "notifications",
        keywords: "webhook alerts watch notifications push discord devices rename revoke",
        label: "Notifications",
    },
    {
        blurb: "Connect your apps",
        group: "Your setup",
        icon: KeyIcon,
        key: "integrations",
        keywords: "api key rotate integrations",
        label: "Integrations",
    },
    {
        blurb: "Manage your account",
        group: "Your setup",
        icon: ShieldCheckIcon,
        key: "security",
        keywords: "delete account security",
        label: "Security",
    },
    {
        blurb: "Guides, privacy, and credits",
        group: "Your experience",
        icon: GlobeAltIcon,
        key: "about",
        keywords: "help about guides credits data privacy version support",
        label: "Help & About",
    },
    {
        blurb: "Playback, progress, and upcoming episodes",
        group: "Your setup",
        icon: ArrowPathIcon,
        key: "tracking",
        keywords: "tracking services trakt connections calendar continue watching",
        label: "Tracking services",
    },
] as const;

export default function UserSettingsPage() {
    const { userInfo, refreshUserInfo, provider, deleteAccount } = useUserAuth();
    const groupLabelId1 = useId();
    const fieldId1 = useId();
    const [activeSection, setActiveSection] =
        useState<(typeof PERSONAL_SECTIONS)[number]["key"]>("general");
    const [settingsQuery, setSettingsQuery] = useState("");
    useEffect(() => {
        const section = new URLSearchParams(window.location.search).get("section");
        if (PERSONAL_SECTIONS.some((item) => item.key === section)) {
            setActiveSection(section as (typeof PERSONAL_SECTIONS)[number]["key"]);
        }
    }, []);
    const currentSection =
        PERSONAL_SECTIONS.find((section) => section.key === activeSection) ?? PERSONAL_SECTIONS[0];
    const matches = PERSONAL_SECTIONS.filter((section) =>
        `${section.label} ${section.blurb} ${section.keywords}`
            .toLowerCase()
            .includes(settingsQuery.trim().toLowerCase())
    );
    const { preferences } = usePersonalPreferences();
    const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const providerLabel = providerTypeLabel(provider);

    // Self-service "delete my account" - only this user's own data, not the
    // whole shared instance (that's an admin-only action). Works in both
    // private and public instance mode.
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const handleDeleteAccount = async () => {
        setIsDeletingAccount(true);
        const result = await deleteAccount();
        if (result.success) {
            toast.success("Your account was deleted");
            window.location.href = "/login?mode=user";
        } else {
            toast.error(result.error || "Failed to delete account");
            setIsDeletingAccount(false);
        }
    };

    // Activity visibility
    const [updating, setUpdating] = useState(false);
    const [activityVisibility, setActivityVisibility] = useState<"public" | "private">("private");
    const [activityVisibilityLoaded, setActivityVisibilityLoaded] = useState(false);

    // Public stats share link - a genuinely public, unauthenticated link,
    // distinct from Activity Visibility above (household-only)
    const [publicStatsEnabled, setPublicStatsEnabled] = useState(false);
    const [publicStatsSlug, setPublicStatsSlug] = useState<string | null>(null);
    const [publicStatsLoaded, setPublicStatsLoaded] = useState(false);
    const [savingPublicStats, setSavingPublicStats] = useState(false);

    // Discord webhook
    const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
    const [_isSavingWebhook, setIsSavingWebhook] = useState(false);
    const [isTestingWebhook, setIsTestingWebhook] = useState(false);
    // Whether MY watch activity (started/watched) notifies at all — account-wide
    // notifications stay on for everyone else regardless of what I pick here.
    const [notifyOnWatch, setNotifyOnWatch] = useState(true);
    const [notifyOnWatchLoaded, setNotifyOnWatchLoaded] = useState(false);
    const [isSavingNotifyOnWatch, setIsSavingNotifyOnWatch] = useState(false);

    // API Key
    const [_apiKeyStatus, setApiKeyStatus] = useState<{ hasKey: boolean }>({ hasKey: false });
    const [currentApiKey, setCurrentApiKey] = useState<string | null>(null);
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [isGeneratingKey, setIsGeneratingKey] = useState(false);
    const autoGenAttemptedRef = useRef<boolean>(false);

    // Load user settings on mount
    useEffect(() => {
        if (!(userId && authKey)) {
            return;
        }

        const loadSettings = async () => {
            try {
                // Get user info for activity visibility
                const info = await userAuth.getUserInfo(userId, authKey);
                setActivityVisibility(info?.activityVisibility ?? "private");
                setActivityVisibilityLoaded(true);
                setPublicStatsEnabled(info?.publicStatsEnabled ?? false);
                setPublicStatsSlug(info?.publicStatsSlug ?? null);
                setPublicStatsLoaded(true);
                setDiscordWebhookUrl(info?.discordWebhookUrl || "");
                setNotifyOnWatch(info?.notifyOnWatch !== false);
                setNotifyOnWatchLoaded(true);

                // Fetch API key
                try {
                    const data = await getUserApiKey(userId, authKey);
                    const hasKey = data?.hasKey || false;
                    const apiKey = data?.apiKey || null;
                    setApiKeyStatus({ hasKey });
                    if (hasKey && apiKey) {
                        setCurrentApiKey(apiKey);
                    } else {
                        setCurrentApiKey(null);
                    }

                    // Auto-generate if missing
                    if (!(hasKey || autoGenAttemptedRef.current)) {
                        autoGenAttemptedRef.current = true;
                        try {
                            const genResponse = await fetch(
                                `${API_BASE}/public-library/user-api-key`,
                                {
                                    body: JSON.stringify({ authKey, userId }),
                                    headers: { "Content-Type": "application/json" },
                                    method: "POST",
                                }
                            );
                            const genData = await genResponse.json();
                            const newKey = genData?.apiKey;
                            if (newKey) {
                                setCurrentApiKey(newKey);
                                setApiKeyStatus({ hasKey: true });
                                toast.success("API key auto-generated");
                                copyToClipboard(newKey).catch(() => undefined);
                            }
                        } catch {
                            toast.error("Failed to auto-generate API key");
                        }
                    }
                } catch {
                    setApiKeyStatus({ hasKey: false });
                }
            } catch (e) {
                console.error("Failed to load settings:", e);
            }
        };

        loadSettings();
    }, [userId, authKey]);

    // Toggle activity visibility
    const handleToggleVisibility = async () => {
        if (!(isReady && userId && authKey) || updating) {
            return;
        }

        const newVisibility = activityVisibility === "public" ? "private" : "public";

        setUpdating(true);
        try {
            await userAuth.updateActivityVisibility(userId, authKey, newVisibility);
            setActivityVisibility(newVisibility);
            await refreshUserInfo();
            toast.success(`Activity visibility set to ${newVisibility}`);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update visibility"));
        } finally {
            setUpdating(false);
        }
    };

    // Toggle the public stats share link
    const handleTogglePublicStats = async () => {
        if (!(isReady && userId && authKey) || savingPublicStats) {
            return;
        }
        setSavingPublicStats(true);
        try {
            if (publicStatsEnabled) {
                await userAuth.disablePublicStats(userId, authKey);
                setPublicStatsEnabled(false);
                setPublicStatsSlug(null);
                toast.success("Public stats link disabled");
            } else {
                const { slug } = await userAuth.enablePublicStats(userId, authKey);
                setPublicStatsEnabled(true);
                setPublicStatsSlug(slug);
                toast.success("Public stats link enabled");
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update public stats link"));
        } finally {
            setSavingPublicStats(false);
        }
    };

    const publicStatsUrl = publicStatsSlug
        ? `${typeof window === "undefined" ? "" : window.location.origin}/u/${publicStatsSlug}`
        : null;

    const handleCopyPublicStatsUrl = async () => {
        if (!publicStatsUrl) {
            return;
        }
        try {
            await copyToClipboard(publicStatsUrl);
            toast.success("Link copied to clipboard");
        } catch {
            toast.error("Failed to copy link");
        }
    };

    // Download own history + watchlist as JSON
    const [isExportingMyData, setIsExportingMyData] = useState(false);
    const handleExportMyData = async () => {
        if (!(userId && authKey) || isExportingMyData) {
            return;
        }
        setIsExportingMyData(true);
        try {
            const data = await userExport.getExport(userId, authKey);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const date = new Date().toISOString().split("T")[0];
            a.download = `${date}-slicksync-my-data.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Your data was exported");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to export your data"));
        } finally {
            setIsExportingMyData(false);
        }
    };

    // Save Discord webhook
    const handleSaveWebhook = async () => {
        if (!(userId && authKey)) {
            return;
        }
        setIsSavingWebhook(true);
        try {
            const response = await fetch(`${API_BASE}/public-library/user-settings`, {
                body: JSON.stringify({
                    discordWebhookUrl: discordWebhookUrl.trim() || null,
                    userId,
                }),
                headers: { "Content-Type": "application/json", "x-stremio-auth": authKey },
                method: "PATCH",
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data?.message || data?.error || "Failed to save webhook");
            }
            toast.success("Webhook URL saved");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to save webhook"));
        } finally {
            setIsSavingWebhook(false);
        }
    };

    // Toggle whether MY watch activity notifies at all
    const handleToggleNotifyOnWatch = async () => {
        if (!(userId && authKey) || isSavingNotifyOnWatch) {
            return;
        }
        const next = !notifyOnWatch;
        setNotifyOnWatch(next);
        setIsSavingNotifyOnWatch(true);
        try {
            const response = await fetch(`${API_BASE}/public-library/user-settings`, {
                body: JSON.stringify({ notifyOnWatch: next, userId }),
                headers: { "Content-Type": "application/json", "x-stremio-auth": authKey },
                method: "PATCH",
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(
                    data?.message || data?.error || "Failed to update notification preference"
                );
            }
            toast.success(next ? "Watch notifications enabled" : "Watch notifications disabled");
        } catch (e) {
            setNotifyOnWatch(!next);
            toast.error(readErrorMessage(e, "Failed to update notification preference"));
        } finally {
            setIsSavingNotifyOnWatch(false);
        }
    };

    // Test Discord webhook
    const handleTestWebhook = async () => {
        const trimmed = (discordWebhookUrl || "").trim();
        if (!trimmed) {
            toast.error("Enter a webhook URL first");
            return;
        }
        if (!userId) {
            return;
        }

        setIsTestingWebhook(true);
        try {
            await fetch(`${API_BASE}/users/${userId}/test-webhook`, {
                body: JSON.stringify({ webhookUrl: trimmed }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            toast.success("Test message sent to Discord");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to send test message"));
        } finally {
            setIsTestingWebhook(false);
        }
    };

    // Generate/Rotate API key
    const handleGenerateApiKey = async () => {
        if (!(userId && authKey)) {
            return;
        }
        setIsGeneratingKey(true);
        try {
            // This button is the person asking for a new key; the server only
            // replaces one they already have when told to.
            const response = await fetch(`${API_BASE}/public-library/user-api-key`, {
                body: JSON.stringify({ authKey, rotate: true, userId }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            const data = await response.json();
            const newKey = data?.apiKey;
            if (newKey) {
                setCurrentApiKey(newKey);
                setApiKeyStatus({ hasKey: true });
                copyToClipboard(newKey);
                toast.success(
                    currentApiKey ? "API key rotated and copied" : "API key generated and copied"
                );
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to generate API key"));
        } finally {
            setIsGeneratingKey(false);
        }
    };

    // Copy API key
    const handleCopyApiKey = () => {
        if (currentApiKey) {
            copyToClipboard(currentApiKey);
            toast.success("API key copied to clipboard");
        }
    };

    // Format date
    const formatDate = (dateStr?: string) => {
        if (!dateStr) {
            return "N/A";
        }
        return new Date(dateStr).toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
        });
    };

    const isPublic = activityVisibility === "public";

    // Mask API key for display
    const maskedApiKey = currentApiKey
        ? apiKeyVisible
            ? currentApiKey
            : `${currentApiKey.slice(0, 8)}••••••••${currentApiKey.slice(-4)}`
        : "No API key";

    return (
        <div className="pt-6 pb-8">
            <UserPageHeader
                subtitle="Make yourself at home. Your preferences, connections, and account."
                title="Settings"
            />

            <div className="settings-workspace settings-with-rail">
                <SettingsNavigation
                    activeKey={activeSection}
                    onChange={(key) => {
                        const section = PERSONAL_SECTIONS.find((item) => item.key === key);
                        if (section) {
                            setActiveSection(section.key);
                        }
                        setSettingsQuery("");
                    }}
                    onQueryChange={setSettingsQuery}
                    query={settingsQuery}
                    sections={[...PERSONAL_SECTIONS]}
                />
                <div className="settings-content personal-settings-content min-w-0">
                    <div className="settings-section-heading mb-6">
                        <p className="mb-2 font-medium text-primary text-xs">Settings</p>
                        <h2 className="font-semibold text-2xl text-default">
                            {settingsQuery.trim() ? "Find your setting" : currentSection.label}
                        </h2>
                        <p className="mt-2 text-muted text-sm">
                            {settingsQuery.trim()
                                ? "Choose a result to open its section."
                                : currentSection.blurb}
                        </p>
                    </div>
                    {settingsQuery.trim() && (
                        <section
                            aria-label="Settings search results"
                            className="interface-panel overflow-hidden rounded-2xl"
                        >
                            {matches.map((section) => (
                                <button
                                    className="settings-result block w-full px-5 py-4 text-left"
                                    key={section.key}
                                    onClick={() => {
                                        setActiveSection(section.key);
                                        setSettingsQuery("");
                                    }}
                                    type="button"
                                >
                                    <span className="block font-medium text-default text-sm">
                                        {section.label}
                                    </span>
                                    <span className="mt-1 block text-muted text-xs">
                                        {section.blurb}
                                    </span>
                                </button>
                            ))}
                            {!matches.length && (
                                <p className="p-5 text-muted text-sm" role="status">
                                    No matching settings. Try a different name.
                                </p>
                            )}
                        </section>
                    )}
                    <div className="space-y-6" hidden={!!settingsQuery.trim()}>
                        <div className="space-y-6" hidden={activeSection !== "general"}>
                            <ProfilePictureSettings
                                colorIndex={userInfo?.colorIndex || 0}
                                email={userInfo?.email}
                                name={userInfo?.username || "User"}
                                onChange={() => setAvatarPickerOpen(true)}
                                src={userInfo?.avatarUrl || undefined}
                                useGravatar={userInfo?.useGravatar}
                            >
                                {/* Provider details are read-only; picture changes belong to this account. */}
                                <div className="mt-5 grid grid-cols-1 gap-4 border-default border-t pt-5 sm:grid-cols-2">
                                    <div>
                                        <p className="mb-1 text-muted text-xs">Name</p>
                                        <p className="font-medium text-default text-sm">
                                            {userInfo?.username}
                                        </p>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="mb-1 text-muted text-xs">Email</p>
                                        <p className="break-all font-medium text-default text-sm">
                                            {preferences.hideSensitive ? "Hidden" : userInfo?.email}
                                        </p>
                                    </div>
                                    <div>
                                        <p
                                            className="mb-1 text-xs uppercase tracking-wider"
                                            style={{ color: "var(--color-text-subtle)" }}
                                        >
                                            Groups
                                        </p>
                                        <p
                                            className="font-medium"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {preferences.hideSensitive
                                                ? "Hidden"
                                                : userInfo?.groups
                                                  ? userInfo.groups
                                                        .map((group) => group.name)
                                                        .join(", ") || "No groups"
                                                  : userInfo?.groupName || "Loading groups..."}
                                        </p>
                                    </div>
                                    <div>
                                        <p
                                            className="mb-1 text-xs uppercase tracking-wider"
                                            style={{ color: "var(--color-text-subtle)" }}
                                        >
                                            Member Since
                                        </p>
                                        <p
                                            className="font-medium"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {formatDate(userInfo?.createdAt)}
                                        </p>
                                    </div>
                                    {userInfo?.expiresAt && (
                                        <div className="col-span-2">
                                            <p
                                                className="mb-1 text-xs uppercase tracking-wider"
                                                style={{ color: "var(--color-text-subtle)" }}
                                            >
                                                Account Expires
                                            </p>
                                            <p
                                                className="font-medium"
                                                style={{ color: "var(--color-warning)" }}
                                            >
                                                {formatDate(userInfo.expiresAt)}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </ProfilePictureSettings>
                            <PersonalDisplayPanel />
                            <AvatarPickerModal
                                currentAvatarUrl={userInfo?.avatarUrl}
                                currentColorIndex={userInfo?.colorIndex}
                                isOpen={avatarPickerOpen}
                                name={userInfo?.username || "User"}
                                onClose={() => setAvatarPickerOpen(false)}
                                onSave={async (data) => {
                                    if (!(userId && authKey)) {
                                        throw new Error("Sign in before updating your profile");
                                    }
                                    await userAuth.updateProfile(userId, authKey, data);
                                    await refreshUserInfo();
                                }}
                                onUpload={(file) => {
                                    if (!(userId && authKey)) {
                                        return Promise.reject(
                                            new Error("Sign in before uploading an avatar")
                                        );
                                    }
                                    return userAuth.uploadAvatar(userId, authKey, file);
                                }}
                            />
                        </div>
                        <div hidden={activeSection !== "tracking"}>
                            <TrackingServicesPanel />
                        </div>
                        <div hidden={activeSection !== "sync"}>
                            <PersonalSyncPanel />
                        </div>
                        <div hidden={activeSection !== "history"}>
                            <PersonalHistoryPanel
                                exporting={isExportingMyData}
                                onExport={handleExportMyData}
                            />
                        </div>
                        <div hidden={activeSection !== "about"}>
                            <PersonalHelpPanel />
                        </div>
                        <div className="space-y-6" hidden={activeSection !== "themes"}>
                            <ThemesPanel embedded showLayout={false} />
                        </div>
                        <div className="space-y-6" hidden={activeSection !== "general"}>
                            {/* Privacy Settings */}
                            <Card padding="lg">
                                <div className="mb-5 flex items-center gap-3">
                                    <div
                                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                                        style={{ background: "var(--color-success-muted)" }}
                                    >
                                        <ShieldCheckIcon
                                            className="h-5 w-5"
                                            style={{ color: "var(--color-success)" }}
                                        />
                                    </div>
                                    <div>
                                        <h3
                                            className="font-display font-semibold text-base text-default"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            Privacy
                                        </h3>
                                        <p
                                            className="text-xs"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            Control who can see your activity
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {/* Activity Visibility Toggle */}
                                    <SettingRow
                                        description={
                                            isPublic
                                                ? "Your watch activity is visible to group members"
                                                : "Your watch activity is hidden from group members"
                                        }
                                        label="Activity Visibility"
                                    >
                                        {activityVisibilityLoaded && (
                                            <div className="flex items-center gap-3">
                                                <span
                                                    className={`font-medium text-sm ${isPublic ? "text-success" : "text-muted"}`}
                                                >
                                                    {isPublic ? "Public" : "Private"}
                                                </span>
                                                <ToggleSwitch
                                                    disabled={updating}
                                                    enabled={isPublic}
                                                    label="Activity Visibility"
                                                    onChange={handleToggleVisibility}
                                                />
                                            </div>
                                        )}
                                    </SettingRow>

                                    {/* Public Stats Share Link - a genuinely public, unauthenticated
                page anyone with the link can view, unlike Activity
                Visibility above (household members only). */}
                                    <SettingRow
                                        description={
                                            <>
                                                {publicStatsEnabled
                                                    ? "Anyone with this link can view your watch stats - no login required"
                                                    : "Get a shareable link to your watch stats, viewable by anyone without logging in"}
                                                {publicStatsEnabled && publicStatsUrl && (
                                                    <div className="mt-2 flex items-center gap-2">
                                                        <code
                                                            className="max-w-[220px] truncate rounded px-2 py-1 text-xs sm:max-w-xs"
                                                            style={{
                                                                background: "var(--color-subtle)",
                                                                color: "var(--color-text)",
                                                            }}
                                                        >
                                                            {publicStatsUrl}
                                                        </code>
                                                        <button
                                                            className="font-medium text-xs"
                                                            onClick={handleCopyPublicStatsUrl}
                                                            style={{
                                                                color: "var(--color-primary)",
                                                            }}
                                                            type="button"
                                                        >
                                                            Copy
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        }
                                        label="Public Stats Page"
                                    >
                                        {publicStatsLoaded && (
                                            <ToggleSwitch
                                                disabled={savingPublicStats}
                                                enabled={publicStatsEnabled}
                                                label="Public Stats Page"
                                                onChange={handleTogglePublicStats}
                                            />
                                        )}
                                    </SettingRow>

                                    {/* Data export */}
                                    <SettingRow
                                        description={
                                            <>
                                                Download your watch history and the household
                                                watchlist as a JSON file
                                            </>
                                        }
                                        label="Your Data"
                                    >
                                        <Button
                                            disabled={isExportingMyData}
                                            onClick={handleExportMyData}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            {isExportingMyData ? "Exporting..." : "Download"}
                                        </Button>
                                    </SettingRow>
                                </div>
                            </Card>
                        </div>
                        <div className="space-y-6" hidden={activeSection !== "notifications"}>
                            {/* Discord Webhook */}
                            <Card padding="lg">
                                <div className="mb-5 flex items-center gap-3">
                                    <div
                                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                                        style={{ background: "rgba(88, 101, 242, 0.2)" }}
                                    >
                                        <GlobeAltIcon
                                            className="h-5 w-5"
                                            style={{ color: "#5865F2" }}
                                        />
                                    </div>
                                    <div>
                                        <h3
                                            className="font-display font-semibold text-base text-default"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            Notifications
                                        </h3>
                                        <p
                                            className="text-xs"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            Shared content, plus your own watch activity
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {/* This device: their sign-in stopping, and a daily limit or
                bedtime about to pause them. Off until they turn it on. */}
                                    <PersonPushRow authKey={authKey} userId={userId} />

                                    {/* Watch notifications toggle - independent of the shared account
                notification settings; opting out here only affects pings
                about MY OWN watch activity, nobody else's. */}
                                    {notifyOnWatchLoaded && (
                                        <SettingRow
                                            description={
                                                <>
                                                    Notify (Discord + push) when I start or finish
                                                    watching something
                                                </>
                                            }
                                            label="Watch notifications"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span
                                                    className={`font-medium text-sm ${notifyOnWatch ? "text-success" : "text-muted"}`}
                                                >
                                                    {notifyOnWatch ? "On" : "Off"}
                                                </span>
                                                <ToggleSwitch
                                                    disabled={isSavingNotifyOnWatch}
                                                    enabled={notifyOnWatch}
                                                    label="Watch notifications"
                                                    onChange={handleToggleNotifyOnWatch}
                                                />
                                            </div>
                                        </SettingRow>
                                    )}

                                    <label
                                        className="mb-2 block font-medium text-sm"
                                        htmlFor={`${fieldId1}-1`}
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        Personal Discord Webhook (optional)
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            className="input-base min-w-0 flex-1 px-3 py-2 text-sm"
                                            id={`${fieldId1}-1`}
                                            onBlur={() => {
                                                if (discordWebhookUrl) {
                                                    handleSaveWebhook();
                                                }
                                            }}
                                            onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                                            placeholder="https://discord.com/api/webhooks/..."
                                            style={{
                                                background: "var(--color-surface-elevated)",
                                                border: "1px solid var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            type="url"
                                            value={discordWebhookUrl}
                                        />
                                        <Button
                                            disabled={isTestingWebhook || !discordWebhookUrl.trim()}
                                            onClick={handleTestWebhook}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            {isTestingWebhook ? (
                                                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <BeakerIcon className="h-4 w-4" />
                                            )}
                                            <span className="text-sm">Test</span>
                                        </Button>
                                    </div>
                                    <p
                                        className="mt-2 text-xs"
                                        style={{ color: "var(--color-text-subtle)" }}
                                    >
                                        Always used for share notifications. Set this and your watch
                                        notifications route here too, instead of the shared family
                                        channel. Leave it blank to keep using that.
                                    </p>
                                </div>
                            </Card>

                            <PersonalDevicesPanel />
                        </div>
                        <div className="space-y-6" hidden={activeSection !== "integrations"}>
                            {/* API Key */}
                            <Card padding="lg">
                                <div className="mb-5 flex items-center gap-3">
                                    <div
                                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                                        style={{ background: "var(--color-warning-muted)" }}
                                    >
                                        <KeyIcon
                                            className="h-5 w-5"
                                            style={{ color: "var(--color-warning)" }}
                                        />
                                    </div>
                                    <div>
                                        <h3
                                            className="font-display font-semibold text-base text-default"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            API Access
                                        </h3>
                                        <p
                                            className="text-xs"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            Access your metrics via external API
                                        </p>
                                    </div>
                                </div>

                                <fieldset
                                    aria-labelledby={`${groupLabelId1}-1`}
                                    className="mx-0 min-w-0 space-y-4 border-0 p-0"
                                >
                                    <p
                                        className="mb-2 block font-medium text-sm"
                                        id={`${groupLabelId1}-1`}
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        Your API Key
                                    </p>
                                    <div className="flex gap-2">
                                        <div
                                            className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2"
                                            style={{
                                                background: "var(--color-surface-elevated)",
                                                border: "1px solid var(--color-surface-border)",
                                            }}
                                        >
                                            <code
                                                className="flex-1 truncate font-mono text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                {preferences.hideSensitive
                                                    ? "••••••••••••••••"
                                                    : maskedApiKey}
                                            </code>
                                            <button
                                                className="rounded p-1 transition-colors"
                                                onClick={() => setApiKeyVisible(!apiKeyVisible)}
                                                style={{ color: "var(--color-text-muted)" }}
                                                title={apiKeyVisible ? "Hide" : "Show"}
                                                type="button"
                                            >
                                                {apiKeyVisible ? (
                                                    <EyeSlashIcon className="h-4 w-4" />
                                                ) : (
                                                    <EyeIcon className="h-4 w-4" />
                                                )}
                                            </button>
                                            <button
                                                className="rounded p-1 transition-colors"
                                                disabled={!currentApiKey}
                                                onClick={handleCopyApiKey}
                                                style={{ color: "var(--color-text-muted)" }}
                                                title="Copy"
                                                type="button"
                                            >
                                                <ClipboardDocumentIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <Button
                                            disabled={isGeneratingKey}
                                            onClick={handleGenerateApiKey}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            <ArrowPathIcon
                                                className={`h-4 w-4 ${isGeneratingKey ? "animate-spin" : ""}`}
                                            />
                                            <span className="text-sm">
                                                {currentApiKey ? "Rotate" : "Generate"}
                                            </span>
                                        </Button>
                                    </div>
                                    <p
                                        className="mt-2 text-xs"
                                        style={{ color: "var(--color-text-subtle)" }}
                                    >
                                        Use this key in the Authorization header:{" "}
                                        <button
                                            className="cursor-pointer rounded border-0 px-1 py-0.5 font-mono"
                                            onClick={() => {
                                                if (currentApiKey) {
                                                    const fullHeader = `Bearer ${currentApiKey}`;
                                                    copyToClipboard(fullHeader);
                                                    toast.success("Authorization header copied");
                                                }
                                            }}
                                            style={{ background: "var(--color-surface-elevated)" }}
                                            title={
                                                currentApiKey
                                                    ? 'Click to copy "Bearer {key}"'
                                                    : "API key not available"
                                            }
                                            type="button"
                                        >
                                            Bearer {currentApiKey ? "..." : "•••••"}
                                        </button>
                                    </p>

                                    <div
                                        className="mt-4 pt-4"
                                        style={{
                                            borderTop: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        <p
                                            className="mb-1 font-medium text-sm"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            Scrobble from other apps
                                        </p>
                                        <p
                                            className="text-xs"
                                            style={{ color: "var(--color-text-subtle)" }}
                                        >
                                            Any app with Trakt-compatible scrobbling (Infuse, Kodi's
                                            Trakt plugin, etc.) can write into your SlickTrax
                                            history instead - point its custom Trakt server at{" "}
                                            <code
                                                className="rounded px-1 py-0.5"
                                                style={{
                                                    background: "var(--color-surface-elevated)",
                                                }}
                                            >
                                                {API_BASE}/scrobble
                                            </code>{" "}
                                            using this same API key as the token.
                                        </p>
                                    </div>
                                </fieldset>
                            </Card>
                        </div>
                        <div className="space-y-6" hidden={activeSection !== "security"}>
                            {/* Account Actions */}
                            <Card padding="lg">
                                <div className="mb-5 flex items-center gap-3">
                                    <div
                                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                                        style={{ background: "var(--color-error-muted)" }}
                                    >
                                        <Cog6ToothIcon
                                            className="h-5 w-5"
                                            style={{ color: "var(--color-error)" }}
                                        />
                                    </div>
                                    <div>
                                        <h3
                                            className="font-display font-semibold text-base text-default"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            Account
                                        </h3>
                                        <p
                                            className="text-xs"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            Manage your account
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div
                                        className="flex items-center justify-between rounded-lg p-4"
                                        style={{ background: "var(--color-error-muted)" }}
                                    >
                                        <div className="flex-1 pr-4">
                                            <p
                                                className="font-medium text-sm"
                                                style={{ color: "var(--color-text)" }}
                                            >
                                                Delete My Account
                                            </p>
                                            <p
                                                className="mt-1 text-xs"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Permanently deletes your own watch history,
                                                watchlist, and account - not the shared
                                                addons/groups. No undo.
                                            </p>
                                        </div>
                                        <Button
                                            onClick={() => setIsDeleteModalOpen(true)}
                                            size="sm"
                                            variant="danger"
                                        >
                                            Delete Account
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        </div>
                        <div className="space-y-6" hidden={activeSection !== "general"}>
                            {/* Info */}
                            <motion.div
                                animate={{ opacity: 1 }}
                                className="rounded-xl p-4"
                                initial={{ opacity: 0 }}
                                style={{ background: "var(--color-primary-muted)" }}
                                transition={{ delay: 0.3 }}
                            >
                                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                                    <strong style={{ color: "var(--color-text)" }}>Note:</strong>{" "}
                                    Profile information is synced from your {providerLabel} account.
                                    To change your username or email, update them in the{" "}
                                    {providerLabel} app.
                                </p>
                            </motion.div>
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmModal
                cancelText="No, keep my account"
                confirmText="Yes, delete my account"
                description={`This permanently deletes your own watch history, watchlist, and account. It does not delete the shared addons, groups, or any other household member's data - only what belongs to you (${userInfo?.username || "this account"}). There is no undo. If you're sure, click 'Yes, delete my account' below.`}
                isLoading={isDeletingAccount}
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteAccount}
                title="Delete Your Account?"
                variant="danger"
            />
        </div>
    );
}
