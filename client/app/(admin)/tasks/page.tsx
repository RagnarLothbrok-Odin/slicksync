"use client";

import {
    ArchiveBoxIcon,
    ArrowDownTrayIcon,
    ArrowPathIcon,
    ArrowsRightLeftIcon,
    ArrowUpTrayIcon,
    ArrowUturnLeftIcon,
    BoltIcon,
    CalendarDaysIcon,
    CheckCircleIcon,
    ClockIcon,
    Cog6ToothIcon,
    DocumentArrowDownIcon,
    DocumentArrowUpIcon,
    DocumentDuplicateIcon,
    DocumentTextIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    EyeSlashIcon,
    FolderArrowDownIcon,
    HeartIcon,
    LinkIcon,
    LockClosedIcon,
    PaperAirplaneIcon,
    PuzzlePieceIcon,
    TrashIcon,
    UserGroupIcon,
    UserIcon,
    UsersIcon,
    WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useRouter, useSearchParams } from "next/navigation";
import { Children, isValidElement, useEffect, useId, useRef, useState } from "react";
import { AutomationPanel } from "@/components/automation/AutomationPanel";
import { Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { MaintenancePanel } from "@/components/tasks/MaintenancePanel";
import { Badge, Button, Card, ConfirmModal, Input, Modal, UserAvatar } from "@/components/ui";
import { PasteCodeDialog, ShareCodeDialog } from "@/components/ui/ShareCodeDialog";
import { toast } from "@/components/ui/Toast";
import { WatchSyncCard } from "@/components/user/WatchSyncCard";
import {
    type AddonSnapshot,
    ApiError,
    api,
    type BackupFile,
    type DisasterRecoveryKit,
    type Group,
    type User,
} from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLayoutMode } from "@/lib/layout-mode";
import { displayEmail, providerBadgeVariant, providerTypeLabel } from "@/lib/providers";
import { decodeShareCode, encodeAddonTemplateShareCode } from "@/lib/shareCodes";

// Task action card component
function TaskCard({
    icon,
    iconBg,
    title,
    description,
    children,
}: {
    icon: React.ReactNode;
    iconBg: string;
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    const actions = Children.toArray(children);
    const isRemoval = (child: React.ReactNode) =>
        isValidElement<{ variant?: string }>(child) &&
        child.type === ActionButton &&
        child.props.variant === "danger";
    const removalActions = actions.filter(isRemoval);
    const primaryActions = actions.filter((child) => !isRemoval(child));
    return (
        <Card className="task-action-card mb-6" padding="lg">
            <div className="mb-4 flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
                    {icon}
                </div>
                <div>
                    <h3 className="font-display font-semibold text-base text-default">{title}</h3>
                    <p className="text-muted text-xs">{description}</p>
                </div>
            </div>
            <div className="flex flex-wrap gap-3">{primaryActions}</div>
            {removalActions.length > 0 && (
                <details className="task-removal-actions mt-5">
                    <summary className="cursor-pointer py-1 text-muted text-xs">
                        Reset &amp; removal
                    </summary>
                    <div className="flex flex-wrap gap-2 pt-3">{removalActions}</div>
                </details>
            )}
        </Card>
    );
}

// Action button with loading state
function ActionButton({
    onClick,
    icon,
    label,
    loadingLabel,
    isLoading,
    variant = "secondary",
    isDragging,
}: {
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    loadingLabel?: string;
    isLoading?: boolean;
    variant?: "secondary" | "danger";
    isDragging?: boolean;
}) {
    return (
        <Button
            className={isDragging ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""}
            isLoading={isLoading}
            leftIcon={isLoading ? undefined : icon}
            onClick={onClick}
            size="sm"
            variant={variant === "danger" ? "danger" : "secondary"}
        >
            {isLoading ? loadingLabel || "Processing..." : label}
        </Button>
    );
}

export default function TasksPage() {
    const groupLabelId1 = useId();
    const accessibleFieldId1 = useId();
    const fieldId1 = useId();
    const [taskCategory, setTaskCategory] = useState<"daily" | "data" | "backup" | "schedule">(
        "daily"
    );
    const { layoutMode } = useLayoutMode();
    // State for loading indicators
    const [syncingUsers, setSyncingUsers] = useState(false);
    const [syncingGroups, setSyncingGroups] = useState(false);
    const [deletingUsers, setDeletingUsers] = useState(false);
    const [deletingGroups, setDeletingGroups] = useState(false);
    const [deletingAddons, setDeletingAddons] = useState(false);
    const [clearingUserAddons, setClearingUserAddons] = useState(false);
    const [importingAddons, setImportingAddons] = useState(false);
    const [isDraggingAddons, setIsDraggingAddons] = useState(false);
    const [importingConfig, setImportingConfig] = useState(false);
    const [isDraggingConfig, setIsDraggingConfig] = useState(false);
    const [reloadingAddons, setReloadingAddons] = useState(false);
    const [repairingAddons, setRepairingAddons] = useState(false);
    const [resettingConfig, setResettingConfig] = useState(false);
    const [isBackupRunning, setIsBackupRunning] = useState(false);
    const [isSyncRunning, setIsSyncRunning] = useState(false);
    const [isExportingLibrary, setIsExportingLibrary] = useState(false);
    const [isExportingHistory, setIsExportingHistory] = useState(false);
    const [isImportingHistory, setIsImportingHistory] = useState(false);
    const [isClearingLibrary, setIsClearingLibrary] = useState(false);
    const [isClearingHistory, setIsClearingHistory] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmConfig, setConfirmConfig] = useState({
        description: "",
        onConfirm: (): void => undefined,
        title: "",
        variant: "default" as "default" | "warning" | "danger",
    });
    const addonFileInputRef = useRef<HTMLInputElement | null>(null);
    const configFileInputRef = useRef<HTMLInputElement | null>(null);
    const historyFileInputRef = useRef<HTMLInputElement | null>(null);

    // Users for library/history export
    const [users, setUsers] = useState<User[]>([]);
    const [selectedUserId, setSelectedUserId] = useState("");
    const [selectedHistoryUserId, setSelectedHistoryUserId] = useState("all");

    // Fetch users for the library/history export selectors (was never being loaded)
    useLastKnown<User[]>("/users", (cached) => setUsers(cached));
    useEffect(() => {
        api.getUsers()
            .then(setUsers)
            .catch((e: unknown) => {
                console.error("Failed to load users for Tasks selectors:", e);
            });
    }, []);

    // Addon Templates (Snapshots) - save a user's/group's current addon set,
    // deploy it to any user later. Backend (/api/snapshots) already existed
    // fully built but had no UI anywhere referencing it.
    const [groups, setGroups] = useState<Group[]>([]);
    const [isAutomationOpen, setIsAutomationOpen] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();
    const hasHandledOpenParam = useRef(false);
    const [snapshots, setSnapshots] = useState<AddonSnapshot[]>([]);
    const [loadingSnapshots, setLoadingSnapshots] = useState(false);
    // Instant navigation: last-known templates shown at once while
    // fetchSnapshots below refreshes them - see useLastKnown's comment.
    useLastKnown<AddonSnapshot[]>("/snapshots", (cached) => setSnapshots(cached));
    const [isCreateSnapshotOpen, setIsCreateSnapshotOpen] = useState(false);
    const [newSnapshotName, setNewSnapshotName] = useState("");
    const [newSnapshotDescription, setNewSnapshotDescription] = useState("");
    const [newSnapshotSourceType, setNewSnapshotSourceType] = useState<"user" | "group">("user");
    const [newSnapshotSourceId, setNewSnapshotSourceId] = useState("");
    const [creatingSnapshot, setCreatingSnapshot] = useState(false);
    const [deployingSnapshot, setDeployingSnapshot] = useState<AddonSnapshot | null>(null);
    const [deployTargetUserId, setDeployTargetUserId] = useState("");
    const [isDeploying, setIsDeploying] = useState(false);
    const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
    // Share codes for templates (ShareCodeDialog / PasteCodeDialog).
    const [sharingSnapshot, setSharingSnapshot] = useState<AddonSnapshot | null>(null);
    const [showPasteTemplate, setShowPasteTemplate] = useState(false);
    // Defaults on - the whole point of this control is "safe by default,"
    // matching the warning already shown right below it. See
    // addonTemplateSanitize.ts for what stripping actually does.
    const [stripKeysOnExport, setStripKeysOnExport] = useState(true);
    const [pendingTemplateImport, setPendingTemplateImport] = useState<{
        name: string;
        description?: string;
        addons: Array<{
            name: string;
            manifestUrl: string | null;
            stremioAddonId: string | null;
            version: string | null;
        }>;
        placeholders: Array<{ addonName: string; fieldKeys: string[] }>;
    } | null>(null);
    const [templateKeyValues, setTemplateKeyValues] = useState<Record<string, string>>({});
    const [submittingTemplateKeys, setSubmittingTemplateKeys] = useState(false);
    // Off-site backups, database upkeep, and applying updates.
    const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);

    useLastKnown<Group[]>("/groups", (cached) => setGroups(cached));
    useEffect(() => {
        api.getGroups()
            .then(setGroups)
            .catch(() => undefined);
    }, []);

    // Deep links from the Guides pages (?open=automation) land you straight
    // in the panel the guide is about, rather than on this page with a
    // "now go find Automation → Manage Rules yourself" instruction. The
    // param is stripped afterward so a refresh or a later back-navigation
    // doesn't keep re-opening the modal.
    useEffect(() => {
        if (hasHandledOpenParam.current) {
            return;
        }
        const target = searchParams.get("open");
        if (!target) {
            return;
        }
        hasHandledOpenParam.current = true;
        if (target === "automation") {
            setIsAutomationOpen(true);
        } else if (target === "addon-templates") {
            setIsCreateSnapshotOpen(true);
        }
        router.replace("/tasks");
    }, [searchParams, router]);

    const fetchSnapshots = () => {
        setLoadingSnapshots(true);
        api.getSnapshots()
            .then(setSnapshots)
            .catch((e: unknown) =>
                toast.error(readErrorMessage(e, "Failed to load addon templates"))
            )
            .finally(() => setLoadingSnapshots(false));
    };
    useEffect(fetchSnapshots, []);

    // Restore from Backup - Automatic Backups already wrote timestamped
    // config-backup-*.json files to data/backup/, but nothing in the UI ever
    // listed, downloaded, or restored from them - only a manual "Backup Now"
    // trigger and a frequency picker existed.
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [loadingBackups, setLoadingBackups] = useState(false);
    useLastKnown<BackupFile[]>("/settings/backups", (cached) => setBackups(cached));
    const [restoringBackup, setRestoringBackup] = useState<string | null>(null);
    const [deletingBackup, setDeletingBackup] = useState<string | null>(null);

    const fetchBackups = () => {
        setLoadingBackups(true);
        api.listBackups()
            .then(setBackups)
            .catch((e: unknown) => toast.error(readErrorMessage(e, "Failed to load backups")))
            .finally(() => setLoadingBackups(false));
    };
    useEffect(fetchBackups, []);

    // Disaster Recovery Kit - unlike the regular config backup above (Users/
    // Groups/Addons only), this also bundles every Vault secret, re-encrypted
    // under a passphrase chosen here instead of this instance's own
    // ENCRYPTION_KEY - so the file is portable to a brand-new instance if
    // this one and its key are both lost. Manual/on-demand only.
    const [drkExportPassphrase, setDrkExportPassphrase] = useState("");
    const [drkExportPassphraseVisible, setDrkExportPassphraseVisible] = useState(false);
    const [isExportingDrk, setIsExportingDrk] = useState(false);
    const [drkImportPassphrase, setDrkImportPassphrase] = useState("");
    const [drkImportPassphraseVisible, setDrkImportPassphraseVisible] = useState(false);
    const [isImportingDrk, setIsImportingDrk] = useState(false);
    const drkFileInputRef = useRef<HTMLInputElement>(null);

    const handleExportDrk = async () => {
        if (drkExportPassphrase.trim().length < 12) {
            toast.error("Passphrase must be at least 12 characters");
            return;
        }
        setIsExportingDrk(true);
        try {
            const kit = await api.exportDisasterRecoveryKit(drkExportPassphrase.trim());
            const blob = new Blob([JSON.stringify(kit, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const date = new Date().toISOString().split("T")[0];
            const a = document.createElement("a");
            a.href = url;
            a.download = `slicksync-recovery-kit-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(
                `Kit downloaded: ${kit.counts.users} users, ${kit.counts.groups} groups, ${kit.counts.addons} addons, ${kit.counts.vaultEntries} Vault entries`
            );
            setDrkExportPassphrase("");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to build recovery kit"));
        } finally {
            setIsExportingDrk(false);
        }
    };

    const handleImportDrkFile = (file: File) => {
        if (drkImportPassphrase.trim().length === 0) {
            toast.error("Enter the passphrase this kit was exported with first");
            return;
        }
        openConfirm({
            description:
                "This replaces all current Users, Groups, and Addons with the kit's contents, and adds every Vault entry from the kit. This cannot be undone.",
            onConfirm: async () => {
                setIsImportingDrk(true);
                try {
                    const text = await file.text();
                    const kit: DisasterRecoveryKit = JSON.parse(text);
                    const result = await api.importDisasterRecoveryKit(
                        drkImportPassphrase.trim(),
                        kit
                    );
                    toast.success(
                        `Restored: ${result.counts.users} users, ${result.counts.groups} groups, ${result.counts.addons} addons, ${result.restoredVaultCount} Vault entries`
                    );
                    setDrkImportPassphrase("");
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to restore recovery kit"));
                } finally {
                    setIsImportingDrk(false);
                }
            },
            title: "Restore Disaster Recovery Kit",
            variant: "danger",
        });
    };

    // Scheduling settings
    const [syncFrequency, setSyncFrequency] = useState("0");
    const [backupDays, setBackupDays] = useState(0);
    const [healthCheckMinutes, setHealthCheckMinutes] = useState(30);
    const [isHealthCheckLoading, setIsHealthCheckLoading] = useState(false);
    const [isRunningHealthCheck, setIsRunningHealthCheck] = useState(false);

    // Load the real persisted schedule settings on mount - all three
    // (syncFrequency, backupDays, healthCheckMinutes) were previously only
    // ever set locally by their own change handlers, never loaded from the
    // server, so every one of them silently reset to its useState default the
    // moment the component remounted (navigating away and back, a hard
    // refresh). syncFrequency's default (Disabled/'0') made this obvious;
    // backupDays/healthCheckMinutes have the identical bug, just harder to
    // notice since their defaults (0, 30) happen to be common real values.
    // Confirmed real report: github.com/slicknsliding/slicksync/issues/22.
    useEffect(() => {
        api.getSyncSettings()
            .then((s) => {
                if (typeof s?.frequency === "string") {
                    setSyncFrequency(s.frequency);
                }
            })
            .catch(() => undefined);
        api.getBackupFrequency()
            .then((s) => {
                if (typeof s?.days === "number") {
                    setBackupDays(s.days);
                }
            })
            .catch(() => undefined);
        api.getAddonHealthCheckSettings()
            .then((s) => {
                if (typeof s?.intervalMinutes === "number") {
                    setHealthCheckMinutes(s.intervalMinutes);
                }
            })
            .catch(() => undefined);
    }, []);

    // Metrics migration - DISABLED
    // const [migrationPreview, setMigrationPreview] = useState<{
    //   migrationStatus: { hasExistingData: boolean; alreadyMigrated: boolean; sessionsCount: number; episodesCount: number; activitiesCount: number };
    //   users: { userId: string; username: string; movies: number; shows: number; watchTimeHours: number }[];
    //   totals: { users: number; movies: number; shows: number; watchTimeHours: number; pendingMigration: boolean };
    // } | null>(null);
    // const [isLoadingMigration, setIsLoadingMigration] = useState(false);
    // const [isRunningMigration, setIsRunningMigration] = useState(false);
    // const [showMigrationConfirm, setShowMigrationConfirm] = useState(false);

    // // Metrics migration handlers
    // const handleLoadMigrationPreview = async () => {
    //   setIsLoadingMigration(true);
    //   try {
    //     const preview = await api.getMetricsMigrationPreview();
    //     setMigrationPreview(preview);
    //   } catch (e: any) {
    //     toast.error(e.message || 'Failed to load migration preview');
    //   } finally {
    //     setIsLoadingMigration(false);
    //   }
    // };
    //
    // const handleRunMigration = async () => {
    //   setIsRunningMigration(true);
    //   try {
    //     const result = await api.runMetricsMigration();
    //     if (result.migrated) {
    //       toast.success(`Migration complete: ${result.sessionsCreated} sessions, ${result.episodesCreated} episodes created`);
    //       setMigrationPreview(null);
    //       setShowMigrationConfirm(false);
    //     } else {
    //       toast.info(result.reason || 'Migration skipped');
    //     }
    //   } catch (e: any) {
    //     toast.error(e.message || 'Failed to run migration');
    //   } finally {
    //     setIsRunningMigration(false);
    //   }
    // };

    const openConfirm = (config: typeof confirmConfig) => {
        setConfirmConfig(config);
        setConfirmOpen(true);
    };

    /*
  // Metrics migration handlers
  const handleLoadMigrationPreview = async () => {
    setIsLoadingMigration(true);
    try {
      const preview = await api.getMetricsMigrationPreview();
      setMigrationPreview(preview);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load migration preview');
    } finally {
      setIsLoadingMigration(false);
    }
  };

  const handleRunMigration = async () => {
    setIsMigrating(true);
    try {
      const result = await api.runMetricsMigration();
      if (result.migrated) {
        toast.success(`Migration complete: ${result.sessionsCreated} sessions, ${result.episodesCreated} episodes created`);
        setMigrationPreview(null);
        setShowMigrationConfirm(false);
      } else {
        toast.success(result.reason === 'already_has_data' ? 'Data already migrated' : 'No data to migrate');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to run migration');
    } finally {
      setIsMigrating(false);
    }
  };
  */

    // User actions
    const handleSyncAllUsers = async () => {
        setSyncingUsers(true);
        try {
            const result = await api.syncAllUsers();
            if (result.failed === 0) {
                toast.success(
                    `Synced ${result.success} user${result.success === 1 ? "" : "s"} successfully`
                );
            } else {
                toast.success(
                    `Synced ${result.success} user${result.success === 1 ? "" : "s"}, ${result.failed} failed`
                );
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to sync users"));
        } finally {
            setSyncingUsers(false);
        }
    };

    const handleDeleteAllUsers = () => {
        openConfirm({
            description: "Are you sure you want to delete ALL users? This cannot be undone.",
            onConfirm: async () => {
                setDeletingUsers(true);
                try {
                    const result = await api.deleteAllUsers();
                    toast.success(
                        `Deleted ${result.success} user${result.success === 1 ? "" : "s"}`
                    );
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to delete users"));
                } finally {
                    setDeletingUsers(false);
                }
            },
            title: "Delete All Users",
            variant: "danger",
        });
    };

    const handleClearAllUserAddons = () => {
        openConfirm({
            description:
                "Clear addons from ALL users? This will remove addons from users but keep the users and addons themselves.",
            onConfirm: async () => {
                setClearingUserAddons(true);
                try {
                    const result = await api.clearAllUserAddons();
                    toast.success(
                        `Cleared addons from ${result.success} user${result.success === 1 ? "" : "s"}`
                    );
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to clear user addons"));
                } finally {
                    setClearingUserAddons(false);
                }
            },
            title: "Clear All User Addons",
            variant: "warning",
        });
    };

    // Group actions
    const handleSyncAllGroups = async () => {
        setSyncingGroups(true);
        try {
            const result = await api.syncAllGroups();
            if (result.failedGroups === 0) {
                toast.success(
                    `Synced ${result.syncedGroups} group${result.syncedGroups === 1 ? "" : "s"} (${result.totalUsersSynced} user${result.totalUsersSynced === 1 ? "" : "s"})`
                );
            } else {
                toast.success(
                    `Synced ${result.syncedGroups} group${result.syncedGroups === 1 ? "" : "s"}, ${result.failedGroups} failed`
                );
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to sync groups"));
        } finally {
            setSyncingGroups(false);
        }
    };

    const handleDeleteAllGroups = () => {
        openConfirm({
            description: "Are you sure you want to delete ALL groups? This cannot be undone.",
            onConfirm: async () => {
                setDeletingGroups(true);
                try {
                    const result = await api.deleteAllGroups();
                    toast.success(
                        `Deleted ${result.success} group${result.success === 1 ? "" : "s"}`
                    );
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to delete groups"));
                } finally {
                    setDeletingGroups(false);
                }
            },
            title: "Delete All Groups",
            variant: "danger",
        });
    };

    // Addon actions
    const handleImportAddons = async (file: File) => {
        setImportingAddons(true);
        try {
            const result = await api.importAddons(file);
            toast.success(
                `Import complete: ${result.successful} successful, ${result.failed} failed, ${result.redundant} redundant`
            );
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to import addons"));
        } finally {
            setImportingAddons(false);
        }
    };

    const handleExportAddons = async () => {
        try {
            const data = await api.exportAddons();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
            const a = document.createElement("a");
            a.href = url;
            a.download = `${date}-slicksync-addons.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Addons exported");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to export addons"));
        }
    };

    const handleReloadAllAddons = async () => {
        setReloadingAddons(true);
        try {
            const result = await api.reloadAllAddons();
            toast.success(`Reloaded ${result.reloaded} addon${result.reloaded === 1 ? "" : "s"}`);
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to reload addons"));
        } finally {
            setReloadingAddons(false);
        }
    };

    const handleRepairAddons = async () => {
        setRepairingAddons(true);
        try {
            const result = await api.repairAddons();
            toast.success(
                `Repaired ${result.updated} of ${result.inspected} addon${result.inspected === 1 ? "" : "s"}`
            );
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to repair addons"));
        } finally {
            setRepairingAddons(false);
        }
    };

    const handleDeleteAllAddons = () => {
        openConfirm({
            description: "Are you sure you want to delete ALL addons? This cannot be undone.",
            onConfirm: async () => {
                setDeletingAddons(true);
                try {
                    const result = await api.deleteAllAddons();
                    toast.success(
                        `Deleted ${result.success} addon${result.success === 1 ? "" : "s"}`
                    );
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to delete addons"));
                } finally {
                    setDeletingAddons(false);
                }
            },
            title: "Delete All Addons",
            variant: "danger",
        });
    };

    // Configuration actions
    const handleImportConfig = async (file: File, passphrase?: string) => {
        setImportingConfig(true);
        try {
            const result = await api.importConfig(file, passphrase);
            const parts = [];
            if (result.users.created > 0) {
                parts.push(`${result.users.created} user${result.users.created === 1 ? "" : "s"}`);
            }
            if (result.groups.created > 0) {
                parts.push(
                    `${result.groups.created} group${result.groups.created === 1 ? "" : "s"}`
                );
            }
            if (result.addons.created > 0) {
                parts.push(
                    `${result.addons.created} addon${result.addons.created === 1 ? "" : "s"}`
                );
            }
            toast.success(`Configuration imported${parts.length ? `: ${parts.join(", ")}` : ""}`);
        } catch (e) {
            // Encrypted off-site backup (.enc): ask for its passphrase and retry
            // once - the file itself is fine, it just needs the key.
            if (e instanceof ApiError && e.code === "PASSPHRASE_REQUIRED" && !passphrase) {
                const entered = window.prompt("This backup is encrypted. Enter its passphrase:");
                setImportingConfig(false);
                if (entered) {
                    return handleImportConfig(file, entered);
                }
                return;
            }
            toast.error(readErrorMessage(e, "Failed to import configuration"));
        } finally {
            setImportingConfig(false);
        }
    };

    const handleExportConfig = async () => {
        try {
            const data = await api.exportConfig();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
            const a = document.createElement("a");
            a.href = url;
            a.download = `${date}-slicksync-config.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Configuration exported");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to export configuration"));
        }
    };

    const handleResetConfig = () => {
        openConfirm({
            description: "Reset all configuration (users, groups, addons)? This cannot be undone.",
            onConfirm: async () => {
                setResettingConfig(true);
                try {
                    await api.resetConfig();
                    toast.success("Configuration reset");
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to reset configuration"));
                } finally {
                    setResettingConfig(false);
                }
            },
            title: "Reset Configuration",
            variant: "danger",
        });
    };

    // Library export
    const handleExportLibrary = async () => {
        if (!selectedUserId) {
            toast.error("Please select a user");
            return;
        }
        setIsExportingLibrary(true);
        try {
            await api.backupUserLibrary(selectedUserId);
            toast.success("Library exported successfully");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to export library"));
        } finally {
            setIsExportingLibrary(false);
        }
    };

    // History export
    const handleExportHistory = async () => {
        setIsExportingHistory(true);
        try {
            const userId = selectedHistoryUserId === "all" ? undefined : selectedHistoryUserId;
            await api.exportHistory(userId);
            toast.success("History exported successfully");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to export history"));
        } finally {
            setIsExportingHistory(false);
        }
    };

    // History import
    const handleImportHistory = async (file: File) => {
        setIsImportingHistory(true);
        try {
            const targetUserId =
                selectedHistoryUserId === "all" ? undefined : selectedHistoryUserId;
            const result = await api.importHistory(file, targetUserId);
            const total =
                (result.results?.watchSessions?.imported || 0) +
                (result.results?.episodeWatchHistory?.imported || 0) +
                (result.results?.watchActivity?.imported || 0);
            toast.success(`Imported ${total} history records`);
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to import history"));
        } finally {
            setIsImportingHistory(false);
        }
    };

    // Clear library
    const handleClearLibrary = () => {
        if (!selectedUserId) {
            toast.error("Please select a user");
            return;
        }
        openConfirm({
            description:
                "This will remove ALL items from the user's Stremio library. This action cannot be undone.",
            onConfirm: async () => {
                setIsClearingLibrary(true);
                try {
                    const result = await api.clearUserLibrary(selectedUserId);
                    toast.success(`Library cleared: ${result.deleted} items removed`);
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to clear library"));
                } finally {
                    setIsClearingLibrary(false);
                }
            },
            title: "Clear Library",
            variant: "danger",
        });
    };

    // Clear history
    const handleClearHistory = () => {
        if (selectedHistoryUserId === "all") {
            toast.error('Please select a specific user (not "All Users")');
            return;
        }
        openConfirm({
            description:
                "This will delete ALL local watch history for this user. This action cannot be undone.",
            onConfirm: async () => {
                setIsClearingHistory(true);
                try {
                    const result = await api.clearUserHistory(selectedHistoryUserId);
                    const total =
                        (result.deleted?.watchSessions || 0) +
                        (result.deleted?.episodeWatchHistory || 0) +
                        (result.deleted?.watchActivity || 0) +
                        (result.deleted?.watchSnapshots || 0);
                    toast.success(`History cleared: ${total} records deleted`);
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to clear history"));
                } finally {
                    setIsClearingHistory(false);
                }
            },
            title: "Clear History",
            variant: "danger",
        });
    };

    // Backup actions
    const handleBackupNow = async () => {
        setIsBackupRunning(true);
        try {
            await api.runBackupNow();
            toast.success("Backup started");
            fetchBackups();
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to start backup"));
        } finally {
            setIsBackupRunning(false);
        }
    };

    const handleBackupFrequencyChange = async (days: number) => {
        setBackupDays(days);
        try {
            await api.setBackupFrequency(days);
            toast.success("Backup schedule updated");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to update backup schedule"));
        }
    };

    const formatBackupDate = (iso: string) => new Date(iso).toLocaleString();

    const handleDownloadBackup = async (filename: string) => {
        try {
            await api.downloadBackup(filename);
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to download backup"));
        }
    };

    // DESTRUCTIVE - replaces all current users/groups/addons. Reload after a
    // successful restore so every part of the app (this page included) picks
    // up the new data instead of continuing to show now-stale state.
    // One-code migration - see server/routes/migration.js for the model.
    const [migrationCode, setMigrationCode] = useState<string | null>(null);
    const [isOfferingMigration, setIsOfferingMigration] = useState(false);
    const [receiveCode, setReceiveCode] = useState("");
    const [isReceivingMigration, setIsReceivingMigration] = useState(false);

    const handleOfferMigration = async () => {
        setIsOfferingMigration(true);
        try {
            const r = await api.offerMigration();
            setMigrationCode(r.code);
            toast.success("Code ready - paste it on the new instance within 15 minutes");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to create migration code"));
        } finally {
            setIsOfferingMigration(false);
        }
    };

    const handleReceiveMigration = () => {
        openConfirm({
            description:
                "This REPLACES everything on this instance - users, groups, addons, settings, and Vault - with the data from the old server. Meant for a fresh install. This cannot be undone.",
            onConfirm: async () => {
                setIsReceivingMigration(true);
                try {
                    const r = await api.receiveMigration(receiveCode.trim());
                    toast.success(
                        `Migration complete${r?.counts ? `: ${r.counts.users ?? "?"} users, ${r.counts.groups ?? "?"} groups, ${r.counts.addons ?? "?"} addons` : ""} - reloading`
                    );
                    setTimeout(() => window.location.reload(), 1500);
                } catch (err) {
                    toast.error(readErrorMessage(err, "Migration failed"));
                    setIsReceivingMigration(false);
                }
            },
            title: "Receive Migration",
            variant: "danger",
        });
    };

    // Per-user restore - Time Machine scoped to one person. Pick a backup's
    // person icon, pick who, see exactly what would rewind for them, confirm.
    // Everyone else is untouched, and the user's pre-restore state goes to the
    // Trash first, so even this rewind is undoable for 30 days.
    const [userRestore, setUserRestore] = useState<{ backup: BackupFile } | null>(null);
    const [userRestoreUsers, setUserRestoreUsers] = useState<User[]>([]);
    const [userRestoreUserId, setUserRestoreUserId] = useState("");
    const [userRestorePreview, setUserRestorePreview] = useState<Awaited<
        ReturnType<typeof api.restoreBackupUser>
    > | null>(null);
    const [userRestoreBusy, setUserRestoreBusy] = useState(false);

    const openUserRestore = (backup: BackupFile) => {
        setUserRestore({ backup });
        setUserRestoreUserId("");
        setUserRestorePreview(null);
        if (userRestoreUsers.length === 0) {
            api.getUsers()
                .then(setUserRestoreUsers)
                .catch(() => undefined);
        }
    };

    const previewUserRestore = async (userId: string) => {
        setUserRestoreUserId(userId);
        setUserRestorePreview(null);
        if (!(userId && userRestore)) {
            return;
        }
        setUserRestoreBusy(true);
        try {
            setUserRestorePreview(
                await api.restoreBackupUser(userRestore.backup.filename, userId, true)
            );
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not preview"));
            setUserRestoreUserId("");
        } finally {
            setUserRestoreBusy(false);
        }
    };

    const applyUserRestore = async () => {
        if (!(userRestore && userRestoreUserId)) {
            return;
        }
        setUserRestoreBusy(true);
        try {
            const r = await api.restoreBackupUser(
                userRestore.backup.filename,
                userRestoreUserId,
                false
            );
            toast.success(
                `${r.username} rewound to this backup - the previous state is in the Trash for 30 days`
            );
            setUserRestore(null);
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to restore user"));
        } finally {
            setUserRestoreBusy(false);
        }
    };

    const handleRestoreBackup = async (backup: BackupFile) => {
        // Time Machine: show what this restore would actually DO before asking
        // for the irreversible yes. "Replaces everything" was true but useless -
        // the question someone is really asking is "does Tuesday's backup still
        // contain what I added on Wednesday?", and now the dialog answers it.
        let detail = "";
        try {
            const d = await api.diffBackup(backup.filename);
            const list = (names: string[]) =>
                names.slice(0, 6).join(", ") +
                (names.length > 6 ? ` and ${names.length - 6} more` : "");
            const parts: string[] = [];
            if (d.addons.removed.length) {
                parts.push(
                    `REMOVE ${d.addons.removed.length} addon${d.addons.removed.length === 1 ? "" : "s"} added since (${list(d.addons.removed)})`
                );
            }
            if (d.addons.added.length) {
                parts.push(
                    `bring back ${d.addons.added.length} addon${d.addons.added.length === 1 ? "" : "s"} (${list(d.addons.added)})`
                );
            }
            if (d.addons.changed.length) {
                parts.push(
                    `rewind ${d.addons.changed.length} addon config${d.addons.changed.length === 1 ? "" : "s"} (${list(d.addons.changed)})`
                );
            }
            if (d.users.removed.length) {
                parts.push(
                    `REMOVE ${d.users.removed.length} user${d.users.removed.length === 1 ? "" : "s"} (${list(d.users.removed)})`
                );
            }
            if (d.users.added.length) {
                parts.push(
                    `bring back ${d.users.added.length} user${d.users.added.length === 1 ? "" : "s"} (${list(d.users.added)})`
                );
            }
            if (d.groups.removed.length) {
                parts.push(
                    `REMOVE ${d.groups.removed.length} group${d.groups.removed.length === 1 ? "" : "s"} (${list(d.groups.removed)})`
                );
            }
            if (d.groups.added.length) {
                parts.push(
                    `bring back ${d.groups.added.length} group${d.groups.added.length === 1 ? "" : "s"} (${list(d.groups.added)})`
                );
            }
            detail =
                parts.length === 0
                    ? " Nothing differs from the current state - restoring changes nothing."
                    : ` This restore would: ${parts.join("; ")}.`;
        } catch {
            /* diff is best-effort - the generic warning below still stands */
        }
        openConfirm({
            description: `Restores the backup from ${formatBackupDate(backup.createdAt)}.${detail} This cannot be undone.`,
            onConfirm: async () => {
                setRestoringBackup(backup.filename);
                try {
                    const result = await api.restoreBackup(backup.filename);
                    toast.success(
                        `Restored ${result.users.created + result.users.reused} users, ${result.groups.created + result.groups.reused} groups, ${result.addons.created + result.addons.reused} addons`
                    );
                    setTimeout(() => window.location.reload(), 1500);
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to restore backup"));
                    setRestoringBackup(null);
                }
            },
            title: "Restore Backup",
            variant: "danger",
        });
    };

    const handleDeleteBackup = (backup: BackupFile) => {
        openConfirm({
            description: `Delete the backup from ${formatBackupDate(backup.createdAt)}? This cannot be undone.`,
            onConfirm: async () => {
                setDeletingBackup(backup.filename);
                try {
                    await api.deleteBackup(backup.filename);
                    toast.success("Backup deleted");
                    fetchBackups();
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to delete backup"));
                } finally {
                    setDeletingBackup(null);
                }
            },
            title: "Delete Backup",
            variant: "danger",
        });
    };

    // Addon Template actions
    const handleCreateSnapshot = async () => {
        if (!(newSnapshotName.trim() && newSnapshotSourceId)) {
            toast.error("Name and source are required");
            return;
        }
        setCreatingSnapshot(true);
        try {
            await api.createSnapshot({
                description: newSnapshotDescription.trim() || undefined,
                name: newSnapshotName.trim(),
                sourceId: newSnapshotSourceId,
                sourceType: newSnapshotSourceType,
            });
            toast.success("Template saved");
            setIsCreateSnapshotOpen(false);
            setNewSnapshotName("");
            setNewSnapshotDescription("");
            setNewSnapshotSourceId("");
            fetchSnapshots();
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to save template"));
        } finally {
            setCreatingSnapshot(false);
        }
    };

    const handleDeploySnapshot = async () => {
        if (!(deployingSnapshot && deployTargetUserId)) {
            return;
        }
        setIsDeploying(true);
        try {
            const result = await api.deploySnapshot(deployingSnapshot.id, deployTargetUserId);
            // Say which ones did not make it, not just how many.
            const leftOut = result.leftOut?.length
                ? `, left out: ${result.leftOut.join(", ")}`
                : result.failed
                  ? `, ${result.failed} failed`
                  : "";
            toast.success(
                `Deployed ${result.deployed} addon${result.deployed === 1 ? "" : "s"}${leftOut}`
            );
            setDeployingSnapshot(null);
            setDeployTargetUserId("");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to deploy template"));
        } finally {
            setIsDeploying(false);
        }
    };

    const handleDeleteSnapshot = (snapshot: AddonSnapshot) => {
        openConfirm({
            description: `Delete the "${snapshot.name}" template? This cannot be undone.`,
            onConfirm: async () => {
                setDeletingSnapshotId(snapshot.id);
                try {
                    await api.deleteSnapshot(snapshot.id);
                    toast.success("Template deleted");
                    fetchSnapshots();
                } catch (e) {
                    toast.error(readErrorMessage(e, "Failed to delete template"));
                } finally {
                    setDeletingSnapshotId(null);
                }
            },
            title: "Delete Template",
            variant: "danger",
        });
    };

    // Sync actions
    const handleSyncNow = async () => {
        setIsSyncRunning(true);
        try {
            const result = await api.syncAllGroups();
            toast.success(
                `Sync completed: ${result.syncedGroups} synced, ${result.failedGroups} failed`
            );
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to start sync"));
        } finally {
            setIsSyncRunning(false);
        }
    };

    // Sync schedule
    const handleSyncFrequencyChange = async (frequency: string) => {
        setSyncFrequency(frequency);
        try {
            await api.updateSyncSettings({
                enabled: frequency !== "0",
                frequency,
            });
            toast.success("Sync schedule updated");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to update sync schedule"));
        }
    };

    // Addon health check schedule
    const handleHealthCheckIntervalChange = async (minutes: number) => {
        setHealthCheckMinutes(minutes);
        setIsHealthCheckLoading(true);
        try {
            await api.setAddonHealthCheckInterval(minutes);
            toast.success("Health check interval updated. Restart server to apply changes.");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to update health check interval"));
        } finally {
            setIsHealthCheckLoading(false);
        }
    };

    const handleRunHealthCheckNow = async () => {
        setIsRunningHealthCheck(true);
        try {
            await api.runAddonHealthCheckNow();
            toast.success("Health check started");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to start health check"));
        } finally {
            setIsRunningHealthCheck(false);
        }
    };

    // File input handlers
    const handleAddonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleImportAddons(file);
            e.target.value = "";
        }
    };

    const handleConfigFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleImportConfig(file);
            e.target.value = "";
        }
    };

    const handleHistoryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleImportHistory(file);
            e.target.value = "";
        }
    };

    // Drag and drop handlers
    const handleAddonDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingAddons(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            handleImportAddons(file);
        }
    };

    const handleConfigDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingConfig(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            handleImportConfig(file);
        }
    };

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    subtitle="Keep things running. The right tool, right where you need it."
                    title="Tasks"
                />
            )}

            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-6 lg:p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={{ maxWidth: layoutMode === "nebula" ? "min(92rem, 92vw)" : "70rem" }}
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            subtitle="Keep things running. The right tool, right where you need it."
                            title="Tasks"
                        />
                    )}
                    <nav aria-label="Task categories" className="task-category-nav mb-8">
                        {[
                            {
                                description: "People, addons, and automation",
                                icon: BoltIcon,
                                key: "daily",
                                label: "Everyday tools",
                            },
                            {
                                description: "Libraries, history, and configuration",
                                icon: DocumentTextIcon,
                                key: "data",
                                label: "Data & templates",
                            },
                            {
                                description: "Keep a copy. Pick up where you left off.",
                                icon: ArchiveBoxIcon,
                                key: "backup",
                                label: "Backup & recovery",
                            },
                            {
                                description: "Maintenance that runs for you",
                                icon: ClockIcon,
                                key: "schedule",
                                label: "Schedules & health",
                            },
                        ].map((category) => {
                            const Icon = category.icon;
                            return (
                                <button
                                    aria-pressed={taskCategory === category.key}
                                    className="task-category-button flex items-start gap-3 rounded-2xl p-4 text-left"
                                    key={category.key}
                                    onClick={() =>
                                        setTaskCategory(category.key as typeof taskCategory)
                                    }
                                    type="button"
                                >
                                    <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                                    <span>
                                        <span className="block font-semibold text-sm">
                                            {category.label}
                                        </span>
                                        <span className="task-category-description mt-1.5 block text-xs leading-relaxed">
                                            {category.description}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                    {/* Sections stay mounted so switching categories preserves selected
            users, pending imports, and the file-input references. */}
                    <div className="tasks-catalog-grid" hidden={taskCategory !== "daily"}>
                        {/* Users */}
                        <PageSection>
                            <TaskCard
                                description="Manage users and their data"
                                icon={<UsersIcon className="h-5 w-5 text-secondary" />}
                                iconBg="bg-secondary-muted"
                                title="Users"
                            >
                                <ActionButton
                                    icon={<ArrowPathIcon className="h-4 w-4" />}
                                    isLoading={syncingUsers}
                                    label="Sync All Users"
                                    loadingLabel="Syncing..."
                                    onClick={handleSyncAllUsers}
                                />
                                <ActionButton
                                    icon={<TrashIcon className="h-4 w-4" />}
                                    isLoading={deletingUsers}
                                    label="Delete All Users"
                                    loadingLabel="Deleting..."
                                    onClick={handleDeleteAllUsers}
                                    variant="danger"
                                />
                                <ActionButton
                                    icon={<ArrowPathIcon className="h-4 w-4" />}
                                    isLoading={clearingUserAddons}
                                    label="Clear User Addons"
                                    loadingLabel="Clearing..."
                                    onClick={handleClearAllUserAddons}
                                />
                            </TaskCard>
                        </PageSection>

                        {/* Groups */}
                        <PageSection delay={0.05}>
                            <TaskCard
                                description="Manage groups and sync operations"
                                icon={<UserGroupIcon className="h-5 w-5 text-primary" />}
                                iconBg="bg-primary-muted"
                                title="Groups"
                            >
                                <ActionButton
                                    icon={<ArrowPathIcon className="h-4 w-4" />}
                                    isLoading={syncingGroups}
                                    label="Sync All Groups"
                                    loadingLabel="Syncing..."
                                    onClick={handleSyncAllGroups}
                                />
                                <ActionButton
                                    icon={<TrashIcon className="h-4 w-4" />}
                                    isLoading={deletingGroups}
                                    label="Delete All Groups"
                                    loadingLabel="Deleting..."
                                    onClick={handleDeleteAllGroups}
                                    variant="danger"
                                />
                            </TaskCard>
                        </PageSection>

                        {/* Addons */}
                        <PageSection delay={0.1}>
                            <TaskCard
                                description="Import, export, and manage addons"
                                icon={<PuzzlePieceIcon className="h-5 w-5 text-success" />}
                                iconBg="bg-success-muted"
                                title="Addons"
                            >
                                <div
                                    onDragLeave={() => setIsDraggingAddons(false)}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setIsDraggingAddons(true);
                                    }}
                                    onDrop={handleAddonDrop}
                                    role="none"
                                >
                                    <ActionButton
                                        icon={<ArrowDownTrayIcon className="h-4 w-4" />}
                                        isDragging={isDraggingAddons}
                                        isLoading={importingAddons}
                                        label={isDraggingAddons ? "Drop Addons" : "Import Addons"}
                                        loadingLabel="Importing..."
                                        onClick={() => addonFileInputRef.current?.click()}
                                    />
                                </div>
                                <ActionButton
                                    icon={<ArrowUpTrayIcon className="h-4 w-4" />}
                                    label="Export Addons"
                                    onClick={handleExportAddons}
                                />
                                <ActionButton
                                    icon={<ArrowPathIcon className="h-4 w-4" />}
                                    isLoading={reloadingAddons}
                                    label="Reload All"
                                    loadingLabel="Reloading..."
                                    onClick={handleReloadAllAddons}
                                />
                                <ActionButton
                                    icon={<WrenchScrewdriverIcon className="h-4 w-4" />}
                                    isLoading={repairingAddons}
                                    label="Repair"
                                    loadingLabel="Repairing..."
                                    onClick={handleRepairAddons}
                                />
                                <ActionButton
                                    icon={<TrashIcon className="h-4 w-4" />}
                                    isLoading={deletingAddons}
                                    label="Delete All"
                                    loadingLabel="Deleting..."
                                    onClick={handleDeleteAllAddons}
                                    variant="danger"
                                />
                            </TaskCard>
                            <input
                                accept=".json"
                                className="hidden"
                                onChange={handleAddonFileChange}
                                ref={addonFileInputRef}
                                type="file"
                            />
                        </PageSection>

                        {/* Automation - "when X happens, do Y" rules (server/utils/automation/).
            Operator tooling, same category as everything else on this page -
            lives in a Modal here rather than its own nav-level route. */}
                        <PageSection delay={0.11}>
                            <TaskCard
                                description="When something happens, do something about it"
                                icon={<BoltIcon className="h-5 w-5 text-primary" />}
                                iconBg="bg-primary-muted"
                                title="Automation"
                            >
                                <ActionButton
                                    icon={<BoltIcon className="h-4 w-4" />}
                                    label="Manage Rules"
                                    onClick={() => setIsAutomationOpen(true)}
                                />
                            </TaskCard>
                        </PageSection>

                        {/* AIOSync - copy watch history between sign-ins and profiles, or
            keep them in step (components/user/WatchSyncCard.tsx). */}
                        <PageSection>
                            <WatchSyncCard />
                        </PageSection>
                    </div>
                    <div className="tasks-data-group" hidden={taskCategory !== "data"}>
                        {/* Addon Templates - the backend (/api/snapshots) already existed
            fully built (save a user's/group's current addon set, deploy it
            to any user later) but had no UI anywhere calling it. */}
                        <PageSection delay={0.12}>
                            <TaskCard
                                description="Save a user's or group's addon set, deploy it to anyone"
                                icon={<DocumentDuplicateIcon className="h-5 w-5 text-secondary" />}
                                iconBg="bg-secondary-muted"
                                title="Addon Templates"
                            >
                                <ActionButton
                                    icon={<DocumentDuplicateIcon className="h-4 w-4" />}
                                    label="Save New Template"
                                    onClick={() => setIsCreateSnapshotOpen(true)}
                                />
                                <ActionButton
                                    icon={<LinkIcon className="h-4 w-4" />}
                                    label="Import from Code"
                                    onClick={() => setShowPasteTemplate(true)}
                                />
                            </TaskCard>
                            {!loadingSnapshots && snapshots.length === 0 && (
                                <p className="-mt-3 mb-6 text-muted text-xs">
                                    No templates saved yet.
                                </p>
                            )}
                            {snapshots.length > 0 && (
                                <Card className="mb-6" padding="lg">
                                    <div className="space-y-2">
                                        {snapshots.map((snap) => {
                                            const sourceName =
                                                snap.sourceType === "user"
                                                    ? users.find((u) => u.id === snap.sourceId)
                                                          ?.name ||
                                                      displayEmail(
                                                          users.find((u) => u.id === snap.sourceId)
                                                              ?.email
                                                      ) ||
                                                      "Unknown user"
                                                    : groups.find((g) => g.id === snap.sourceId)
                                                          ?.name || "Unknown group";
                                            return (
                                                <div
                                                    className="flex items-center justify-between gap-3 rounded-lg border border-default bg-subtle p-3"
                                                    key={snap.id}
                                                >
                                                    <div className="min-w-0">
                                                        <p className="truncate font-medium text-default text-sm">
                                                            {snap.name}
                                                        </p>
                                                        <p className="truncate text-muted text-xs">
                                                            {snap.addonCount} addon
                                                            {snap.addonCount === 1 ? "" : "s"}{" "}
                                                            &middot;{" "}
                                                            {snap.sourceType === "user"
                                                                ? "User"
                                                                : "Group"}
                                                            : {sourceName} &middot;{" "}
                                                            {new Date(
                                                                snap.createdAt
                                                            ).toLocaleDateString()}
                                                        </p>
                                                        {snap.description && (
                                                            <p className="mt-0.5 truncate text-subtle text-xs">
                                                                {snap.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-2">
                                                        <Button
                                                            leftIcon={
                                                                <LinkIcon className="h-4 w-4" />
                                                            }
                                                            onClick={() => setSharingSnapshot(snap)}
                                                            size="sm"
                                                            title="Turn this template into a copy-paste share code"
                                                            variant="ghost"
                                                        >
                                                            Share
                                                        </Button>
                                                        <Button
                                                            leftIcon={
                                                                <PaperAirplaneIcon className="h-4 w-4" />
                                                            }
                                                            onClick={() => {
                                                                setDeployingSnapshot(snap);
                                                                setDeployTargetUserId("");
                                                            }}
                                                            size="sm"
                                                            variant="secondary"
                                                        >
                                                            Deploy
                                                        </Button>
                                                        <Button
                                                            isLoading={
                                                                deletingSnapshotId === snap.id
                                                            }
                                                            leftIcon={
                                                                deletingSnapshotId ===
                                                                snap.id ? undefined : (
                                                                    <TrashIcon className="h-4 w-4" />
                                                                )
                                                            }
                                                            onClick={() =>
                                                                handleDeleteSnapshot(snap)
                                                            }
                                                            size="sm"
                                                            variant="danger"
                                                        >
                                                            Delete
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </Card>
                            )}
                        </PageSection>

                        {/* Library */}
                        <PageSection delay={0.15}>
                            <Card className="mb-6" padding="lg">
                                <div className="mb-4 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning-muted">
                                        <FolderArrowDownIcon className="h-5 w-5 text-warning" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Library
                                        </h3>
                                        <p className="text-muted text-xs">
                                            Export a user's Stremio or Nuvio library
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="relative min-w-[200px] flex-1">
                                        <select
                                            className="input-base w-full appearance-none px-3 py-2 pr-10 text-sm"
                                            onChange={(e) => setSelectedUserId(e.target.value)}
                                            value={selectedUserId}
                                        >
                                            <option value="">Select a user...</option>
                                            {users.map((user) => (
                                                <option key={user.id} value={user.id}>
                                                    {user.name ||
                                                        displayEmail(user.email) ||
                                                        user.id}{" "}
                                                    ({providerTypeLabel(user.providerType)})
                                                </option>
                                            ))}
                                        </select>
                                        <div className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
                                            <UserIcon className="h-4 w-4 text-muted" />
                                        </div>
                                    </div>
                                    <Button
                                        disabled={!selectedUserId}
                                        isLoading={isExportingLibrary}
                                        leftIcon={
                                            isExportingLibrary ? undefined : (
                                                <ArrowUpTrayIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={handleExportLibrary}
                                        size="sm"
                                        variant="secondary"
                                    >
                                        {isExportingLibrary ? "Exporting..." : "Export"}
                                    </Button>
                                    <Button
                                        // Clearing reaches into a Stremio account only; for anyone
                                        // else the server would just answer "not connected to Stremio".
                                        disabled={
                                            !selectedUserId ||
                                            (users.find((u) => u.id === selectedUserId)
                                                ?.providerType || "stremio") !== "stremio"
                                        }
                                        isLoading={isClearingLibrary}
                                        leftIcon={
                                            isClearingLibrary ? undefined : (
                                                <TrashIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={handleClearLibrary}
                                        size="sm"
                                        title={
                                            selectedUserId &&
                                            (users.find((u) => u.id === selectedUserId)
                                                ?.providerType || "stremio") !== "stremio"
                                                ? "Clearing a library works for Stremio accounts only"
                                                : undefined
                                        }
                                        variant="danger"
                                    >
                                        {isClearingLibrary ? "Clearing..." : "Clear Library"}
                                    </Button>
                                </div>
                                {selectedUserId &&
                                    (() => {
                                        const user = users.find((u) => u.id === selectedUserId);
                                        if (!user) {
                                            return null;
                                        }
                                        return (
                                            <div className="mt-3 flex items-center gap-2 rounded-lg border border-default bg-subtle px-3 py-2">
                                                <UserAvatar
                                                    colorIndex={user.colorIndex}
                                                    email={user.email}
                                                    name={user.name || user.email || "U"}
                                                    size="sm"
                                                    src={user.avatarUrl || undefined}
                                                    useGravatar={user.useGravatar}
                                                    userId={user.id}
                                                />
                                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                                    <div className="min-w-0">
                                                        <p className="truncate font-medium text-default text-sm">
                                                            {user.name ||
                                                                displayEmail(user.email) ||
                                                                user.id}
                                                        </p>
                                                        {user.email && user.name && (
                                                            <p className="truncate text-muted text-xs">
                                                                {displayEmail(user.email)}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <Badge
                                                        size="sm"
                                                        variant={providerBadgeVariant(user)}
                                                    >
                                                        {providerTypeLabel(user.providerType)}
                                                    </Badge>
                                                </div>
                                            </div>
                                        );
                                    })()}
                            </Card>
                        </PageSection>

                        {/* History */}
                        <PageSection delay={0.2}>
                            <Card className="mb-6" padding="lg">
                                <div className="mb-4 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20">
                                        <ClockIcon className="h-5 w-5 text-rose-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            History
                                        </h3>
                                        <p className="text-muted text-xs">
                                            Import or export watch history and sessions
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="relative min-w-[200px] flex-1">
                                        <select
                                            className="input-base w-full appearance-none px-3 py-2 pr-10 text-sm"
                                            onChange={(e) =>
                                                setSelectedHistoryUserId(e.target.value)
                                            }
                                            value={selectedHistoryUserId}
                                        >
                                            <option value="all">All Users</option>
                                            {users.map((user) => (
                                                <option key={user.id} value={user.id}>
                                                    {user.name ||
                                                        displayEmail(user.email) ||
                                                        user.id}{" "}
                                                    ({providerTypeLabel(user.providerType)})
                                                </option>
                                            ))}
                                        </select>
                                        <div className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
                                            <UserIcon className="h-4 w-4 text-muted" />
                                        </div>
                                    </div>
                                    <Button
                                        isLoading={isImportingHistory}
                                        leftIcon={
                                            isImportingHistory ? undefined : (
                                                <ArrowDownTrayIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={() => historyFileInputRef.current?.click()}
                                        size="sm"
                                        variant="secondary"
                                    >
                                        {isImportingHistory ? "Importing..." : "Import"}
                                    </Button>
                                    <Button
                                        isLoading={isExportingHistory}
                                        leftIcon={
                                            isExportingHistory ? undefined : (
                                                <ArrowUpTrayIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={handleExportHistory}
                                        size="sm"
                                        variant="secondary"
                                    >
                                        {isExportingHistory ? "Exporting..." : "Export"}
                                    </Button>
                                    <Button
                                        disabled={selectedHistoryUserId === "all"}
                                        isLoading={isClearingHistory}
                                        leftIcon={
                                            isClearingHistory ? undefined : (
                                                <TrashIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={handleClearHistory}
                                        size="sm"
                                        variant="danger"
                                    >
                                        {isClearingHistory ? "Clearing..." : "Clear History"}
                                    </Button>
                                </div>
                                {selectedHistoryUserId !== "all" &&
                                    (() => {
                                        const user = users.find(
                                            (u) => u.id === selectedHistoryUserId
                                        );
                                        if (!user) {
                                            return null;
                                        }
                                        return (
                                            <div className="mt-3 flex items-center gap-2 rounded-lg border border-default bg-subtle px-3 py-2">
                                                <UserAvatar
                                                    colorIndex={user.colorIndex}
                                                    email={user.email}
                                                    name={user.name || user.email || "U"}
                                                    size="sm"
                                                    src={user.avatarUrl || undefined}
                                                    useGravatar={user.useGravatar}
                                                    userId={user.id}
                                                />
                                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                                    <div className="min-w-0">
                                                        <p className="truncate font-medium text-default text-sm">
                                                            {user.name ||
                                                                displayEmail(user.email) ||
                                                                user.id}
                                                        </p>
                                                        {user.email && user.name && (
                                                            <p className="truncate text-muted text-xs">
                                                                {displayEmail(user.email)}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <Badge
                                                        size="sm"
                                                        variant={providerBadgeVariant(user)}
                                                    >
                                                        {providerTypeLabel(user.providerType)}
                                                    </Badge>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                <p className="mt-3 text-muted text-xs">
                                    {selectedHistoryUserId === "all"
                                        ? "Export all users' watch history, or import history for existing users. Select a specific user to clear their history."
                                        : "Export or import watch history for the selected user only. Clear history will delete all local watch records."}
                                </p>
                            </Card>
                            <input
                                accept=".json"
                                className="hidden"
                                onChange={handleHistoryFileChange}
                                ref={historyFileInputRef}
                                type="file"
                            />
                        </PageSection>

                        {/* Configuration */}
                        <PageSection delay={0.25}>
                            <TaskCard
                                description="Import or export full configuration"
                                icon={<Cog6ToothIcon className="h-5 w-5 text-indigo-400" />}
                                iconBg="bg-indigo-500/20"
                                title="Configuration"
                            >
                                <div
                                    onDragLeave={() => setIsDraggingConfig(false)}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setIsDraggingConfig(true);
                                    }}
                                    onDrop={handleConfigDrop}
                                    role="none"
                                >
                                    <ActionButton
                                        icon={<DocumentArrowDownIcon className="h-4 w-4" />}
                                        isDragging={isDraggingConfig}
                                        isLoading={importingConfig}
                                        label={isDraggingConfig ? "Drop Config" : "Import Config"}
                                        loadingLabel="Importing..."
                                        onClick={() => configFileInputRef.current?.click()}
                                    />
                                </div>
                                <ActionButton
                                    icon={<DocumentArrowUpIcon className="h-4 w-4" />}
                                    label="Export Config"
                                    onClick={handleExportConfig}
                                />
                                <ActionButton
                                    icon={<ExclamationTriangleIcon className="h-4 w-4" />}
                                    isLoading={resettingConfig}
                                    label="Reset Config"
                                    loadingLabel="Resetting..."
                                    onClick={handleResetConfig}
                                    variant="danger"
                                />
                            </TaskCard>
                            <input
                                accept=".json"
                                className="hidden"
                                onChange={handleConfigFileChange}
                                ref={configFileInputRef}
                                type="file"
                            />
                        </PageSection>
                    </div>
                    <div className="tasks-backup-group" hidden={taskCategory !== "backup"}>
                        {/* Automatic Backups */}
                        <PageSection delay={0.3}>
                            <Card className="mb-6" padding="lg">
                                <div className="mb-4 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20">
                                        <ArchiveBoxIcon className="h-5 w-5 text-purple-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Automatic Backups
                                        </h3>
                                        <p className="text-muted text-xs">
                                            Save configuration snapshots on a schedule
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <select
                                        className="input-base min-w-[180px] flex-1 px-3 py-2 text-sm"
                                        onChange={(e) =>
                                            handleBackupFrequencyChange(Number(e.target.value))
                                        }
                                        value={backupDays}
                                    >
                                        <option value={0}>Disabled</option>
                                        <option value={1}>Every day</option>
                                        <option value={7}>Every week</option>
                                        <option value={15}>Every 15 days</option>
                                        <option value={30}>Every month</option>
                                    </select>
                                    <Button
                                        isLoading={isBackupRunning}
                                        leftIcon={
                                            isBackupRunning ? undefined : (
                                                <ArrowPathIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={handleBackupNow}
                                        size="sm"
                                        title="Run backup now"
                                        variant="ghost"
                                    >
                                        Backup Now
                                    </Button>
                                </div>
                                {backups.length > 0 ? (
                                    <div className="mt-4 max-h-64 space-y-2 overflow-y-auto border-default border-t pt-4">
                                        {backups.map((backup) => (
                                            <div
                                                className="flex items-center justify-between gap-3 rounded-lg border border-default bg-subtle p-2.5"
                                                key={backup.filename}
                                            >
                                                <div className="min-w-0">
                                                    <p className="truncate text-default text-sm">
                                                        {formatBackupDate(backup.createdAt)}
                                                    </p>
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="text-muted text-xs">
                                                            {(backup.size / 1024).toFixed(1)} KB
                                                        </p>
                                                        {/* Confirms this backup would actually restore (or
                            says exactly why not), instead of only finding
                            out mid-emergency - see backupValidation.js.
                            Absent (no badge) for backups written before
                            this existed. */}
                                                        {backup.validation &&
                                                            (backup.validation.valid ? (
                                                                <span
                                                                    className="flex items-center gap-1 text-success text-xs"
                                                                    title="This backup would restore cleanly"
                                                                >
                                                                    <CheckCircleIcon className="h-3.5 w-3.5" />
                                                                    {backup.validation.counts
                                                                        ? `${backup.validation.counts.users}u/${backup.validation.counts.groups}g/${backup.validation.counts.addons}a`
                                                                        : "Valid"}
                                                                </span>
                                                            ) : (
                                                                <span
                                                                    className="flex items-center gap-1 text-error text-xs"
                                                                    title={backup.validation.issues.join(
                                                                        "\n"
                                                                    )}
                                                                >
                                                                    <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                                                                    {
                                                                        backup.validation.issues
                                                                            .length
                                                                    }{" "}
                                                                    issue
                                                                    {backup.validation.issues
                                                                        .length === 1
                                                                        ? ""
                                                                        : "s"}
                                                                </span>
                                                            ))}
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <Button
                                                        onClick={() =>
                                                            handleDownloadBackup(backup.filename)
                                                        }
                                                        size="sm"
                                                        title="Download"
                                                        variant="ghost"
                                                    >
                                                        <ArrowDownTrayIcon className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        onClick={() => openUserRestore(backup)}
                                                        size="sm"
                                                        title="Restore just one user from this backup"
                                                        variant="ghost"
                                                    >
                                                        <UserIcon className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        isLoading={
                                                            restoringBackup === backup.filename
                                                        }
                                                        onClick={() => handleRestoreBackup(backup)}
                                                        size="sm"
                                                        title="Restore this backup"
                                                        variant="ghost"
                                                    >
                                                        {restoringBackup !== backup.filename && (
                                                            <ArrowUturnLeftIcon className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        isLoading={
                                                            deletingBackup === backup.filename
                                                        }
                                                        onClick={() => handleDeleteBackup(backup)}
                                                        size="sm"
                                                        title="Delete"
                                                        variant="ghost"
                                                    >
                                                        {deletingBackup !== backup.filename && (
                                                            <TrashIcon className="h-4 w-4 text-error" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-2 text-muted text-xs">
                                        {loadingBackups
                                            ? "Loading backups..."
                                            : 'No backups yet - click "Backup Now" or wait for the schedule. Files are saved under server folder: data/backup/'}
                                    </p>
                                )}
                            </Card>
                        </PageSection>

                        {/* Disaster Recovery Kit - the regular backup above never touches
            Vault (its secrets are encrypted under THIS instance's own
            ENCRYPTION_KEY, so a backup file sitting next to a lost VPS is
            useless without it). This bundles the same config export plus
            every Vault secret, re-encrypted under a passphrase chosen here
            instead - portable to a brand-new instance. Manual only, never
            scheduled - it's real, usable credential access protected only
            as strongly as the passphrase, not something to generate on a
            timer and forget about. */}
                        <PageSection delay={0.32}>
                            <Card className="mb-6" padding="lg">
                                <div className="mb-4 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20">
                                        <LockClosedIcon className="h-5 w-5 text-amber-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Disaster Recovery Kit
                                        </h3>
                                        <p className="text-muted text-xs">
                                            Users, Groups, Addons AND Vault in one
                                            passphrase-protected file you keep - restores onto a
                                            fresh instance even after this server is gone
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label
                                            className="mb-1.5 block font-medium text-muted text-xs"
                                            htmlFor={`${fieldId1}-1`}
                                        >
                                            Export
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <div className="relative flex-1">
                                                <input
                                                    className="input-base w-full px-3 py-2 pr-9 text-sm"
                                                    id={`${fieldId1}-1`}
                                                    onChange={(e) =>
                                                        setDrkExportPassphrase(e.target.value)
                                                    }
                                                    placeholder="Choose a passphrase (12+ characters)"
                                                    type={
                                                        drkExportPassphraseVisible
                                                            ? "text"
                                                            : "password"
                                                    }
                                                    value={drkExportPassphrase}
                                                />
                                                <button
                                                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle hover:text-default"
                                                    onClick={() =>
                                                        setDrkExportPassphraseVisible((v) => !v)
                                                    }
                                                    type="button"
                                                >
                                                    {drkExportPassphraseVisible ? (
                                                        <EyeSlashIcon className="h-4 w-4" />
                                                    ) : (
                                                        <EyeIcon className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </div>
                                            <Button
                                                isLoading={isExportingDrk}
                                                leftIcon={
                                                    isExportingDrk ? undefined : (
                                                        <ArrowDownTrayIcon className="h-4 w-4" />
                                                    )
                                                }
                                                onClick={handleExportDrk}
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Download Kit
                                            </Button>
                                        </div>
                                        <p className="mt-1 text-[11px] text-subtle">
                                            Write this passphrase down somewhere safe - it's the
                                            only thing standing between this file and every
                                            credential in Vault, and it can't be recovered if lost.
                                        </p>
                                    </div>

                                    <div className="border-default border-t pt-3">
                                        <label
                                            className="mb-1.5 block font-medium text-muted text-xs"
                                            htmlFor={`${fieldId1}-2`}
                                        >
                                            Restore
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <div className="relative flex-1">
                                                <input
                                                    className="input-base w-full px-3 py-2 pr-9 text-sm"
                                                    id={`${fieldId1}-2`}
                                                    onChange={(e) =>
                                                        setDrkImportPassphrase(e.target.value)
                                                    }
                                                    placeholder="Passphrase this kit was exported with"
                                                    type={
                                                        drkImportPassphraseVisible
                                                            ? "text"
                                                            : "password"
                                                    }
                                                    value={drkImportPassphrase}
                                                />
                                                <button
                                                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle hover:text-default"
                                                    onClick={() =>
                                                        setDrkImportPassphraseVisible((v) => !v)
                                                    }
                                                    type="button"
                                                >
                                                    {drkImportPassphraseVisible ? (
                                                        <EyeSlashIcon className="h-4 w-4" />
                                                    ) : (
                                                        <EyeIcon className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </div>
                                            <Button
                                                isLoading={isImportingDrk}
                                                leftIcon={
                                                    isImportingDrk ? undefined : (
                                                        <ArrowUpTrayIcon className="h-4 w-4" />
                                                    )
                                                }
                                                onClick={() => drkFileInputRef.current?.click()}
                                                size="sm"
                                                variant="danger"
                                            >
                                                Choose Kit File
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                            <input
                                accept=".json"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        handleImportDrkFile(file);
                                    }
                                    e.target.value = "";
                                }}
                                ref={drkFileInputRef}
                                type="file"
                            />
                        </PageSection>

                        {/* One-code migration - the DR Kit's live sibling: one code moves
            the whole household to a new instance in a minute, instead of
            export-file / carry / import / retype-passphrase. */}
                        <PageSection className="mb-6">
                            <Card padding="lg">
                                <div className="mb-1 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-muted">
                                        <ArrowsRightLeftIcon className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Move to a New Server
                                        </h3>
                                        <p className="text-muted text-sm">
                                            One code moves everything, live, no file to handle - for
                                            when the old server is still running. If it is already
                                            gone, restore a Disaster Recovery Kit instead
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    <fieldset
                                        aria-labelledby={`${groupLabelId1}-1`}
                                        className="mx-0 min-w-0 border-0 p-0"
                                    >
                                        <p
                                            className="mb-1.5 block font-medium text-muted text-xs"
                                            id={`${groupLabelId1}-1`}
                                        >
                                            This is the OLD server
                                        </p>
                                        <p className="mb-2 text-subtle text-xs">
                                            Generate a code here, paste it on the new instance.
                                            Single-use, dies in 15 minutes, and the new server
                                            fetches directly from this one - both must be able to
                                            reach each other.
                                        </p>
                                        <Button
                                            isLoading={isOfferingMigration}
                                            onClick={handleOfferMigration}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            Generate migration code
                                        </Button>
                                        {migrationCode && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <code className="flex-1 break-all rounded-lg bg-surface-hover p-2 font-mono text-subtle text-xs">
                                                    {migrationCode}
                                                </code>
                                                <Button
                                                    onClick={async () => {
                                                        (await copyToClipboard(migrationCode))
                                                            ? toast.success("Code copied")
                                                            : toast.error(
                                                                  "Copy failed - select the code text"
                                                              );
                                                    }}
                                                    size="sm"
                                                    variant="ghost"
                                                >
                                                    <DocumentDuplicateIcon className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                    </fieldset>
                                    <div>
                                        <label
                                            className="mb-1.5 block font-medium text-muted text-xs"
                                            htmlFor={`${accessibleFieldId1}-2`}
                                        >
                                            This is the NEW server
                                        </label>
                                        <p className="mb-2 text-subtle text-xs">
                                            Paste the code from the old instance. This REPLACES
                                            everything currently here - meant for a fresh install.
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <input
                                                autoComplete="off"
                                                className="input-base flex-1 px-3 py-2 font-mono text-sm"
                                                id={`${accessibleFieldId1}-2`}
                                                onChange={(e) => setReceiveCode(e.target.value)}
                                                placeholder="slickmig1.…"
                                                spellCheck={false}
                                                value={receiveCode}
                                            />
                                            <Button
                                                disabled={!receiveCode.trim()}
                                                isLoading={isReceivingMigration}
                                                onClick={handleReceiveMigration}
                                                size="sm"
                                                variant="primary"
                                            >
                                                Receive
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </PageSection>
                    </div>
                    <div className="tasks-schedule-group" hidden={taskCategory !== "schedule"}>
                        {/* Maintenance - off-site backup targets, database upkeep, and
            applying updates. All set-once-and-forget, which is why they
            live behind one card rather than as three more things on the
            page. */}
                        <PageSection delay={0.115}>
                            <TaskCard
                                description="Off-site backups, database upkeep, and updates"
                                icon={<WrenchScrewdriverIcon className="h-5 w-5 text-primary" />}
                                iconBg="bg-primary-muted"
                                title="Maintenance"
                            >
                                <ActionButton
                                    icon={<WrenchScrewdriverIcon className="h-4 w-4" />}
                                    label="Open Maintenance"
                                    onClick={() => setIsMaintenanceOpen(true)}
                                />
                            </TaskCard>
                        </PageSection>

                        {/* Automatic Sync */}
                        <PageSection delay={0.35}>
                            <Card className="mb-6" padding="lg">
                                <div className="mb-4 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20">
                                        <CalendarDaysIcon className="h-5 w-5 text-cyan-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Automatic Sync
                                        </h3>
                                        <p className="text-muted text-xs">
                                            Automatically sync groups on a schedule
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <select
                                        className="input-base min-w-[180px] flex-1 px-3 py-2 text-sm"
                                        onChange={(e) => handleSyncFrequencyChange(e.target.value)}
                                        value={syncFrequency}
                                    >
                                        <option value="0">Disabled</option>
                                        <option value="1h">Every hour</option>
                                        <option value="1d">Every day</option>
                                        <option value="7d">Every 7 days</option>
                                        <option value="15d">Every 15 days</option>
                                        <option value="30d">Every 30 days</option>
                                    </select>
                                    <Button
                                        isLoading={isSyncRunning}
                                        leftIcon={
                                            isSyncRunning ? undefined : (
                                                <ArrowPathIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={handleSyncNow}
                                        size="sm"
                                        title="Run sync now"
                                        variant="ghost"
                                    >
                                        Sync Now
                                    </Button>
                                </div>
                            </Card>
                        </PageSection>

                        {/* Addon Health Check */}
                        <PageSection delay={0.375}>
                            <Card className="mb-6" padding="lg">
                                <div className="mb-4 flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20">
                                        <HeartIcon className="h-5 w-5 text-rose-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Addon Health Check
                                        </h3>
                                        <p className="text-muted text-xs">
                                            Monitor addon availability by checking manifests
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <select
                                        className="input-base min-w-[180px] flex-1 px-3 py-2 text-sm"
                                        disabled={isHealthCheckLoading}
                                        onChange={(e) =>
                                            handleHealthCheckIntervalChange(Number(e.target.value))
                                        }
                                        value={healthCheckMinutes}
                                    >
                                        <option value={0}>Disabled</option>
                                        <option value={5}>Every 5 minutes</option>
                                        <option value={15}>Every 15 minutes</option>
                                        <option value={30}>Every 30 minutes</option>
                                        <option value={60}>Every hour</option>
                                        <option value={180}>Every 3 hours</option>
                                        <option value={360}>Every 6 hours</option>
                                        <option value={720}>Every 12 hours</option>
                                        <option value={1440}>Every 24 hours</option>
                                    </select>
                                    <Button
                                        isLoading={isRunningHealthCheck}
                                        leftIcon={
                                            isRunningHealthCheck ? undefined : (
                                                <ArrowPathIcon className="h-4 w-4" />
                                            )
                                        }
                                        onClick={handleRunHealthCheckNow}
                                        size="sm"
                                        title="Run health check now"
                                        variant="ghost"
                                    >
                                        Check Now
                                    </Button>
                                </div>
                                <p className="mt-2 text-muted text-xs">
                                    Checks if addon manifests are reachable and tracks
                                    online/offline status
                                </p>
                            </Card>
                        </PageSection>

                        {/*
        <PageSection delay={0.38}>
          <Card padding="lg" className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500/20">
                <ArrowPathIcon className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold font-display text-default">Data Migration</h3>
                <p className="text-xs text-muted">Import old metrics from previous SlickSync version</p>
              </div>
            </div>
            
            {!migrationPreview ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleLoadMigrationPreview}
                  isLoading={isLoadingMigration}
                  leftIcon={!isLoadingMigration ? <ArrowPathIcon className="w-4 h-4" /> : undefined}
                >
                  Check for Migration
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {migrationPreview.totals.pendingMigration ? (
                  <>
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <p className="text-sm text-amber-400 font-medium">Migration Available</p>
                      <p className="text-xs text-muted mt-1">
                        Found {migrationPreview.totals.movies} movies, {migrationPreview.totals.shows} shows, 
                        {migrationPreview.totals.watchTimeHours}h watch time across {migrationPreview.totals.users} users
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setShowMigrationConfirm(true)}
                      >
                        Migrate Now
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMigrationPreview(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                    <p className="text-sm text-green-400 font-medium">Already Migrated</p>
                    <p className="text-xs text-muted mt-1">
                      {migrationPreview.migrationStatus.sessionsCount} sessions, {migrationPreview.migrationStatus.episodesCount} episodes
                    </p>
                  </div>
                )}
              </div>
            )}

            // Migration Confirm Modal
            {showMigrationConfirm && migrationPreview && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-surface border border-default rounded-xl p-6 w-full mx-4" style={{ maxWidth: '448px' }}>
                  <h3 className="text-lg font-semibold text-default mb-2">Confirm Migration</h3>
                  <p className="text-sm text-muted mb-4">
                    This will import {migrationPreview.totals.movies} movies, {migrationPreview.totals.shows} shows, 
                    and {migrationPreview.totals.watchTimeHours}h of watch time into the new metrics system.
                  </p>
                  {migrationPreview.users.length > 0 && (
                    <div className="mb-4 max-h-40 overflow-y-auto">
                      <p className="text-xs text-muted mb-2">Users to migrate:</p>
                      {migrationPreview.users.slice(0, 5).map((u) => (
                        <div key={u.userId} className="text-xs text-default flex justify-between py-1">
                          <span>{u.username}</span>
                          <span className="text-muted">{u.movies + u.shows} items, {u.watchTimeHours}h</span>
                        </div>
                      ))}
                      {migrationPreview.users.length > 5 && (
                        <p className="text-xs text-muted">...and {migrationPreview.users.length - 5} more</p>
                      )}
                    </div>
                  )}
                  <div className="flex justify-end gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMigrationConfirm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleRunMigration}
                      isLoading={isRunningMigration}
                    >
                      Run Migration
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </PageSection>
        */}

                        {/* Scheduled Tasks */}
                        <PageSection delay={0.4}>
                            <ScheduledTasksSection
                                backupDays={backupDays}
                                healthCheckMinutes={healthCheckMinutes}
                                syncFrequency={syncFrequency}
                            />
                        </PageSection>
                    </div>
                </div>
            </div>

            {/* Confirm Modal */}
            <ConfirmModal
                confirmText="Confirm"
                description={confirmConfig.description}
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={() => {
                    setConfirmOpen(false);
                    confirmConfig.onConfirm();
                }}
                title={confirmConfig.title}
                variant={confirmConfig.variant}
            />

            {/* Template share codes. The warning is not boilerplate: an addon's
          manifest URL frequently embeds a debrid/API key, so a template
          code can carry real credentials to whoever receives it. */}
            <ShareCodeDialog
                extraContent={
                    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                        <input
                            checked={stripKeysOnExport}
                            className="mt-0.5"
                            onChange={(e) => setStripKeysOnExport(e.target.checked)}
                            type="checkbox"
                        />
                        <span className="text-default">
                            Strip API keys{" "}
                            <span className="text-muted">
                                — share the setup, not your credentials. Whoever imports it fills in
                                their own keys.
                            </span>
                        </span>
                    </label>
                }
                generate={async () => {
                    if (!sharingSnapshot) {
                        throw new Error("No template selected");
                    }
                    const detail = await api.getSnapshot(sharingSnapshot.id);
                    let addons = detail.addons.map((a) => ({
                        manifestUrl: a.manifestUrl,
                        name: a.name,
                        stremioAddonId: a.stremioAddonId,
                        version: a.version,
                    }));
                    if (stripKeysOnExport) {
                        const { sanitizeTemplateAddons } = await import(
                            "@/lib/addonTemplateSanitize"
                        );
                        const result = sanitizeTemplateAddons(addons);
                        addons = result.addons;
                        if (result.excluded.length > 0) {
                            toast(
                                `${result.excluded.length} addon${result.excluded.length === 1 ? "" : "s"} left out of the code - their config couldn't be safely stripped: ${result.excluded.join(", ")}`,
                                { duration: 6000, icon: "⚠️" }
                            );
                        }
                    }
                    return encodeAddonTemplateShareCode({
                        addons,
                        description: detail.description || undefined,
                        name: detail.name,
                    });
                }}
                isOpen={!!sharingSnapshot}
                onClose={() => setSharingSnapshot(null)}
                summary={
                    sharingSnapshot
                        ? `the template “${sharingSnapshot.name}” and its ${sharingSnapshot.addonCount} addon${sharingSnapshot.addonCount === 1 ? "" : "s"}, including each addon's install URL`
                        : ""
                }
                title="Share template as code"
                warning={
                    stripKeysOnExport
                        ? "Even with keys stripped, this still shares which addons you use and how they're set up. Only share it with people you're comfortable knowing that."
                        : "Addon install URLs often contain API keys (Real-Debrid, TorBox and similar). Anyone you send this code to gets those keys, and can use your subscription. Only share it with people you'd hand your credentials to."
                }
            />
            <PasteCodeDialog
                isOpen={showPasteTemplate}
                onClose={() => setShowPasteTemplate(false)}
                onImport={async (text) => {
                    const decoded = decodeShareCode(text);
                    if (decoded?.kind !== "addonTemplate") {
                        throw new Error("That code isn't an addon template share code");
                    }
                    // A code generated with "Strip API keys" on has each redacted
                    // field carrying a placeholder instead of a real value - detect
                    // that BEFORE creating anything, so the addons this template
                    // deploys never end up broken from a still-placeholder'd key with
                    // no warning why.
                    const { findPlaceholderFields } = await import("@/lib/addonTemplateSanitize");
                    const placeholders = findPlaceholderFields(decoded.payload.addons);
                    if (placeholders.length > 0) {
                        setPendingTemplateImport({
                            // Share-code payloads carry these two as optional; normalize
                            // to the explicit-null shape the sanitizer and importSnapshot
                            // both expect.
                            addons: decoded.payload.addons.map((a) => ({
                                manifestUrl: a.manifestUrl,
                                name: a.name,
                                stremioAddonId: a.stremioAddonId ?? null,
                                version: a.version ?? null,
                            })),
                            description: decoded.payload.description,
                            name: decoded.payload.name,
                            placeholders,
                        });
                        return;
                    }
                    const created = await api.importSnapshot({
                        addons: decoded.payload.addons,
                        description: decoded.payload.description,
                        name: decoded.payload.name,
                    });
                    toast.success(
                        `Imported "${created.name}" (${created.addonCount} addon${created.addonCount === 1 ? "" : "s"})`
                    );
                    fetchSnapshots();
                }}
                placeholder="Paste an SSA1: template code…"
                title="Import template from a code"
            />

            {/* Fill-in-your-own-keys step, only shown when the imported template
          code had "Strip API keys" applied on the export side (see
          addonTemplateSanitize.ts) - the template's structure imports fine
          without this, but any redacted field left as the placeholder would
          otherwise deploy a broken addon with no indication why. */}
            <Modal
                isOpen={!!pendingTemplateImport}
                onClose={() => {
                    setPendingTemplateImport(null);
                    setTemplateKeyValues({});
                }}
                size="md"
                title={`Finish importing "${pendingTemplateImport?.name || ""}"`}
            >
                {pendingTemplateImport && (
                    <div className="space-y-4">
                        <p className="text-muted text-sm">
                            This template had its API keys stripped before sharing. Fill in your own
                            for each addon below before it's created.
                        </p>
                        <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                            {pendingTemplateImport.placeholders.map(({ addonName, fieldKeys }) => (
                                <div key={addonName}>
                                    <p className="mb-1.5 font-medium text-default text-sm">
                                        {addonName}
                                    </p>
                                    <div className="space-y-2">
                                        {fieldKeys.map((fieldKey) => {
                                            const stateKey = `${addonName}::${fieldKey}`;
                                            return (
                                                <input
                                                    autoComplete="off"
                                                    className="input-base w-full px-3 py-2 text-sm"
                                                    key={stateKey}
                                                    onChange={(e) =>
                                                        setTemplateKeyValues((prev) => ({
                                                            ...prev,
                                                            [stateKey]: e.target.value,
                                                        }))
                                                    }
                                                    placeholder={fieldKey}
                                                    spellCheck={false}
                                                    type="text"
                                                    value={templateKeyValues[stateKey] || ""}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button
                                onClick={() => {
                                    setPendingTemplateImport(null);
                                    setTemplateKeyValues({});
                                }}
                                size="sm"
                                variant="ghost"
                            >
                                Cancel
                            </Button>
                            <Button
                                isLoading={submittingTemplateKeys}
                                onClick={async () => {
                                    if (!pendingTemplateImport) {
                                        return;
                                    }
                                    setSubmittingTemplateKeys(true);
                                    try {
                                        const { applyPlaceholderValues } = await import(
                                            "@/lib/addonTemplateSanitize"
                                        );
                                        const addons = applyPlaceholderValues(
                                            pendingTemplateImport.addons,
                                            templateKeyValues
                                        );
                                        const created = await api.importSnapshot({
                                            addons,
                                            description: pendingTemplateImport.description,
                                            name: pendingTemplateImport.name,
                                        });
                                        toast.success(
                                            `Imported "${created.name}" (${created.addonCount} addon${created.addonCount === 1 ? "" : "s"})`
                                        );
                                        fetchSnapshots();
                                        setPendingTemplateImport(null);
                                        setTemplateKeyValues({});
                                    } catch (e) {
                                        toast.error(
                                            e instanceof Error
                                                ? e.message
                                                : "Failed to import template"
                                        );
                                    } finally {
                                        setSubmittingTemplateKeys(false);
                                    }
                                }}
                                size="sm"
                                variant="primary"
                            >
                                Create addons
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Per-user restore: pick a person, see their diff, rewind just them */}
            <Modal
                isOpen={!!userRestore}
                onClose={() => setUserRestore(null)}
                size="md"
                title="Restore one user"
            >
                <div className="space-y-4">
                    <p className="text-muted text-sm">
                        Rewinds a single person to this backup - identity, provider connection,
                        addon exclusions, notification settings and group memberships. Nobody else
                        changes, watch history is untouched, and their current state goes to the
                        Trash first (undoable for 30 days).
                    </p>
                    <select
                        className="input-base w-full appearance-none px-3 py-2 pr-10 text-sm"
                        onChange={(e) => previewUserRestore(e.target.value)}
                        value={userRestoreUserId}
                    >
                        <option value="">Pick a user...</option>
                        {userRestoreUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.username}
                            </option>
                        ))}
                    </select>
                    {userRestoreBusy && !userRestorePreview && (
                        <p className="text-subtle text-xs">Working out what would change...</p>
                    )}
                    {userRestorePreview && (
                        <div
                            className="rounded-lg p-3 text-sm"
                            style={{ background: "var(--color-surface-hover)" }}
                        >
                            {userRestorePreview.nothingToDo ? (
                                <p className="text-muted">
                                    Nothing differs for {userRestorePreview.username} - this backup
                                    matches their current state.
                                </p>
                            ) : (
                                <ul className="space-y-1 text-muted">
                                    {userRestorePreview.changedFields.length > 0 && (
                                        <li>
                                            Rewinds:{" "}
                                            <span className="text-default">
                                                {userRestorePreview.changedFields.join(", ")}
                                            </span>
                                        </li>
                                    )}
                                    {userRestorePreview.groupsJoin.length > 0 && (
                                        <li>
                                            Rejoins:{" "}
                                            <span className="text-default">
                                                {userRestorePreview.groupsJoin.join(", ")}
                                            </span>
                                        </li>
                                    )}
                                    {userRestorePreview.groupsLeave.length > 0 && (
                                        <li>
                                            Leaves:{" "}
                                            <span className="text-default">
                                                {userRestorePreview.groupsLeave.join(", ")}
                                            </span>
                                        </li>
                                    )}
                                    {userRestorePreview.missingGroups.length > 0 && (
                                        <li className="text-subtle">
                                            Was also in{" "}
                                            {userRestorePreview.missingGroups.join(", ")} - those
                                            groups no longer exist and are not resurrected.
                                        </li>
                                    )}
                                </ul>
                            )}
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setUserRestore(null)} size="sm" variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={!userRestorePreview || userRestorePreview.nothingToDo}
                            isLoading={userRestoreBusy && !!userRestorePreview}
                            onClick={applyUserRestore}
                            size="sm"
                            variant="danger"
                        >
                            Restore this user
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Maintenance: off-site backups, database upkeep, updates */}
            <Modal
                isOpen={isMaintenanceOpen}
                onClose={() => setIsMaintenanceOpen(false)}
                size="xl"
                title="Maintenance"
            >
                <MaintenancePanel />
            </Modal>

            {/* Automation rules */}
            <Modal
                isOpen={isAutomationOpen}
                onClose={() => {
                    setIsAutomationOpen(false);
                    // Arrived here from another page's "Automate" button (e.g. an
                    // addon detail page)? Closing the panel goes BACK there instead
                    // of stranding the user on Tasks - a page they never chose.
                    // Read-and-clear so a normal later visit to Tasks stays put.
                    try {
                        const returnTo = sessionStorage.getItem("slicksync-automation-return");
                        if (returnTo) {
                            sessionStorage.removeItem("slicksync-automation-return");
                            if (returnTo.startsWith("/")) {
                                router.push(returnTo);
                            }
                        }
                    } catch {
                        /* private mode - stay on Tasks */
                    }
                }}
                size="xl"
                title="Automation"
            >
                <AutomationPanel />
            </Modal>

            {/* Save Addon Template */}
            <Modal
                description="Capture a user's or group's current addon set as a reusable template"
                isOpen={isCreateSnapshotOpen}
                onClose={() => setIsCreateSnapshotOpen(false)}
                size="md"
                title="Save Addon Template"
            >
                <div className="space-y-4">
                    <Input
                        label="Template Name"
                        onChange={(e) => setNewSnapshotName(e.target.value)}
                        placeholder="e.g. Standard Streaming Set"
                        size="sm"
                        value={newSnapshotName}
                    />
                    <Input
                        label="Description (optional)"
                        onChange={(e) => setNewSnapshotDescription(e.target.value)}
                        placeholder="What's in this template?"
                        size="sm"
                        value={newSnapshotDescription}
                    />
                    <div>
                        <label
                            className="mb-2 block font-medium text-sm"
                            htmlFor={`${accessibleFieldId1}-4`}
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            Source
                        </label>
                        <div className="mb-2 flex gap-2">
                            <Button
                                onClick={() => {
                                    setNewSnapshotSourceType("user");
                                    setNewSnapshotSourceId("");
                                }}
                                size="sm"
                                variant={newSnapshotSourceType === "user" ? "primary" : "secondary"}
                            >
                                User
                            </Button>
                            <Button
                                onClick={() => {
                                    setNewSnapshotSourceType("group");
                                    setNewSnapshotSourceId("");
                                }}
                                size="sm"
                                variant={
                                    newSnapshotSourceType === "group" ? "primary" : "secondary"
                                }
                            >
                                Group
                            </Button>
                        </div>
                        <select
                            className="input-base w-full px-3 py-2 text-sm"
                            id={`${accessibleFieldId1}-4`}
                            onChange={(e) => setNewSnapshotSourceId(e.target.value)}
                            value={newSnapshotSourceId}
                        >
                            <option value="">Select a {newSnapshotSourceType}...</option>
                            {(newSnapshotSourceType === "user" ? users : groups).map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name ||
                                        ("email" in item ? displayEmail(item.email) : null) ||
                                        item.id}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            onClick={() => setIsCreateSnapshotOpen(false)}
                            size="sm"
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                        <Button
                            isLoading={creatingSnapshot}
                            onClick={handleCreateSnapshot}
                            size="sm"
                            variant="primary"
                        >
                            Save Template
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Deploy Addon Template */}
            <Modal
                description={
                    deployingSnapshot
                        ? `Push this template's ${deployingSnapshot.addonCount} addon${deployingSnapshot.addonCount === 1 ? "" : "s"} onto a user's account`
                        : undefined
                }
                isOpen={!!deployingSnapshot}
                onClose={() => setDeployingSnapshot(null)}
                size="md"
                title={deployingSnapshot ? `Deploy "${deployingSnapshot.name}"` : "Deploy Template"}
            >
                <div className="space-y-4">
                    <div>
                        <label
                            className="mb-2 block font-medium text-sm"
                            htmlFor={`${fieldId1}-7`}
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            Target User
                        </label>
                        <select
                            className="input-base w-full px-3 py-2 text-sm"
                            id={`${fieldId1}-7`}
                            onChange={(e) => setDeployTargetUserId(e.target.value)}
                            value={deployTargetUserId}
                        >
                            <option value="">Select a user...</option>
                            {users.map((user) => (
                                <option key={user.id} value={user.id}>
                                    {user.name || displayEmail(user.email) || user.id} (
                                    {providerTypeLabel(user.providerType)})
                                </option>
                            ))}
                        </select>
                    </div>
                    <p className="text-warning text-xs">
                        This replaces the target user&apos;s current addon set.
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            onClick={() => setDeployingSnapshot(null)}
                            size="sm"
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={!deployTargetUserId}
                            isLoading={isDeploying}
                            onClick={handleDeploySnapshot}
                            size="sm"
                            variant="primary"
                        >
                            Deploy
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
}

// Scheduled Tasks Section Component
function ScheduledTasksSection({
    syncFrequency,
    backupDays,
    healthCheckMinutes,
}: {
    syncFrequency: string;
    backupDays: number;
    healthCheckMinutes: number;
}) {
    // Calculate next run times
    const getNextSyncTime = (): Date | null => {
        if (syncFrequency === "0") {
            return null;
        }
        const now = new Date();
        const next = new Date(now);

        switch (syncFrequency) {
            case "1h":
                next.setHours(next.getHours() + 1, 0, 0, 0);
                break;
            case "1d":
                next.setDate(next.getDate() + 1);
                next.setHours(0, 0, 0, 0);
                break;
            case "7d":
                next.setDate(next.getDate() + (7 - next.getDay()));
                next.setHours(0, 0, 0, 0);
                break;
            case "15d":
                next.setDate(next.getDate() + 15);
                next.setHours(0, 0, 0, 0);
                break;
            case "30d":
                next.setMonth(next.getMonth() + 1, 1);
                next.setHours(0, 0, 0, 0);
                break;
            default:
                return null;
        }
        return next;
    };

    const getNextBackupTime = (): Date | null => {
        if (backupDays === 0) {
            return null;
        }
        const now = new Date();
        const next = new Date(now);
        next.setDate(next.getDate() + backupDays);
        next.setHours(3, 0, 0, 0); // Assume backups run at 3 AM
        return next;
    };

    const formatNextRun = (date: Date | null): string => {
        if (!date) {
            return "Not scheduled";
        }
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffHours < 1) {
            return "In less than an hour";
        }
        if (diffHours < 24) {
            return `In ${diffHours} hour${diffHours === 1 ? "" : "s"}`;
        }
        if (diffDays === 1) {
            return "Tomorrow";
        }
        return `In ${diffDays} days`;
    };

    const formatDateTime = (date: Date | null): string => {
        if (!date) {
            return "-";
        }
        return date.toLocaleDateString("en-US", {
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            month: "short",
            weekday: "short",
        });
    };

    const getNextHealthCheckTime = (): Date | null => {
        if (healthCheckMinutes < 1) {
            return null;
        }
        const now = new Date();
        const next = new Date(now);
        next.setMinutes(next.getMinutes() + healthCheckMinutes);
        return next;
    };

    const formatHealthCheckFrequency = (minutes: number): string => {
        if (minutes < 60) {
            return `Every ${minutes} minutes`;
        }
        if (minutes === 60) {
            return "Every hour";
        }
        if (minutes < 1440) {
            return `Every ${Math.floor(minutes / 60)} hours`;
        }
        return "Every 24 hours";
    };

    const nextSyncTime = getNextSyncTime();
    const nextBackupTime = getNextBackupTime();
    const nextHealthCheckTime = getNextHealthCheckTime();

    // Build list of scheduled tasks
    const scheduledTasks = [];

    if (nextSyncTime) {
        scheduledTasks.push({
            description: "Sync all groups with their users",
            frequency:
                syncFrequency === "1h"
                    ? "Every hour"
                    : syncFrequency === "1d"
                      ? "Daily"
                      : syncFrequency === "7d"
                        ? "Weekly"
                        : syncFrequency === "15d"
                          ? "Every 15 days"
                          : "Monthly",
            icon: <ArrowPathIcon className="h-5 w-5 text-cyan-400" />,
            iconBg: "bg-cyan-500/20",
            id: "sync",
            name: "Automatic Sync",
            nextRun: nextSyncTime,
        });
    }

    if (nextBackupTime) {
        scheduledTasks.push({
            description: "Save configuration snapshot",
            frequency:
                backupDays === 1
                    ? "Daily"
                    : backupDays === 7
                      ? "Weekly"
                      : backupDays === 15
                        ? "Every 15 days"
                        : "Monthly",
            icon: <ArchiveBoxIcon className="h-5 w-5 text-purple-400" />,
            iconBg: "bg-purple-500/20",
            id: "backup",
            name: "Automatic Backup",
            nextRun: nextBackupTime,
        });
    }

    if (nextHealthCheckTime) {
        scheduledTasks.push({
            description: "Check addon manifest availability",
            frequency: formatHealthCheckFrequency(healthCheckMinutes),
            icon: <HeartIcon className="h-5 w-5 text-rose-400" />,
            iconBg: "bg-rose-500/20",
            id: "healthcheck",
            name: "Addon Health Check",
            nextRun: nextHealthCheckTime,
        });
    }

    // Sort by next run time
    scheduledTasks.sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());

    if (scheduledTasks.length === 0) {
        return (
            <Card padding="lg">
                <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-hover">
                        <ClockIcon className="h-5 w-5 text-muted" />
                    </div>
                    <div>
                        <h3 className="font-display font-semibold text-base text-default">
                            Scheduled Tasks
                        </h3>
                        <p className="text-muted text-xs">No automatic tasks configured</p>
                    </div>
                </div>
                <p className="text-muted text-sm">
                    Enable automatic sync or backup schedules above to see upcoming tasks here.
                </p>
            </Card>
        );
    }

    return (
        <Card padding="lg">
            <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-hover">
                    <ClockIcon className="h-5 w-5 text-muted" />
                </div>
                <div>
                    <h3 className="font-display font-semibold text-base text-default">
                        Scheduled Tasks
                    </h3>
                    <p className="text-muted text-xs">
                        {scheduledTasks.length} upcoming task
                        {scheduledTasks.length === 1 ? "" : "s"}
                    </p>
                </div>
            </div>

            <div className="space-y-3">
                {scheduledTasks.map((task) => (
                    <div
                        className="flex items-center gap-4 rounded-xl border border-default bg-surface-hover p-3"
                        key={task.id}
                    >
                        <div
                            className={`flex h-10 w-10 items-center justify-center rounded-xl ${task.iconBg}`}
                        >
                            {task.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h4 className="truncate font-medium text-default text-sm">
                                    {task.name}
                                </h4>
                                <Badge size="sm" variant="muted">
                                    {task.frequency}
                                </Badge>
                            </div>
                            <p className="text-muted text-xs">{task.description}</p>
                        </div>
                        <div className="text-right">
                            <p className="font-medium text-primary text-sm">
                                {formatNextRun(task.nextRun)}
                            </p>
                            <p className="text-subtle text-xs">{formatDateTime(task.nextRun)}</p>
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}
