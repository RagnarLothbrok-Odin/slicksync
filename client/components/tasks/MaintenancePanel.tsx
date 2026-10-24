"use client";

import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button, Card, ToggleSwitch } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import {
    api,
    type BackupTargets,
    type DataBackupSettings,
    type DbMaintenanceSettings,
    type UpdateCapability,
} from "@/lib/api";
import { TrashPanel } from "./TrashPanel";

// Everything that keeps an instance healthy without anyone watching it:
// where backups go besides this box, what the database does to look after
// itself, and applying an update. Grouped in one panel on the Tasks page
// because they're the same job - and because none of them are things
// anyone wants a dashboard for; they're set once and then forgotten.
//
// Every destructive capability here is off by default and says plainly
// what it does. Nothing in this panel is required for SlickSync to work.

function relative(iso: string | null | undefined): string {
    if (!iso) {
        return "never";
    }
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days > 0) {
        return `${days}d ago`;
    }
    const hours = Math.floor(diff / 3_600_000);
    if (hours > 0) {
        return `${hours}h ago`;
    }
    return "just now";
}

const inputClass =
    "w-full px-3 py-2 rounded-lg text-sm border border-transparent focus:border-primary focus:outline-none";
const inputStyle = {
    background: "var(--color-surface-hover)",
    color: "var(--color-text)",
} as const;

export function MaintenancePanel() {
    const repeatedFieldId1 = useId();
    const fieldId1 = useId();
    // History Doctor - scan is read-only; repair re-scans server-side (see
    // utils/historyDoctor.js) rather than trusting ids from this page.
    const [historyScan, setHistoryScan] = useState<Awaited<
        ReturnType<typeof api.scanHistory>
    > | null>(null);
    const [scanningHistory, setScanningHistory] = useState(false);
    const [repairingHistory, setRepairingHistory] = useState(false);
    const runHistoryScan = async () => {
        setScanningHistory(true);
        try {
            setHistoryScan(await api.scanHistory());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "History scan failed");
        } finally {
            setScanningHistory(false);
        }
    };
    const runHistoryRepair = async () => {
        setRepairingHistory(true);
        try {
            const res = await api.repairHistory();
            toast.success(`Removed ${res.removed} bad record${res.removed === 1 ? "" : "s"}`);
            setHistoryScan(await api.scanHistory());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "History repair failed");
        } finally {
            setRepairingHistory(false);
        }
    };

    const [targets, setTargets] = useState<BackupTargets | null>(null);
    const [dataBackup, setDataBackup] = useState<DataBackupSettings | null>(null);
    const [maint, setMaint] = useState<DbMaintenanceSettings | null>(null);
    const [capability, setCapability] = useState<UpdateCapability | null>(null);
    const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
    const [autoUpdateHour, setAutoUpdateHour] = useState(4);
    const saveAutoUpdate = async (enabled: boolean, hour: number) => {
        setAutoUpdateEnabled(enabled);
        setAutoUpdateHour(hour);
        try {
            await api.updateSyncSettings({ autoUpdateEnabled: enabled, autoUpdateHour: hour });
            toast.success(
                enabled
                    ? `Automatic updates on - daily at ${String(hour).padStart(2, "0")}:00`
                    : "Automatic updates off"
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        }
    };
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        const id = setTimeout(() => {
            api.getBackupTargets()
                .then(setTargets)
                .catch(() => setTargets(null));
            api.getDataBackup()
                .then(setDataBackup)
                .catch(() => setDataBackup(null));
            api.getDbMaintenance()
                .then(setMaint)
                .catch(() => setMaint(null));
            api.getUpdateCapability()
                .then(setCapability)
                .catch(() => setCapability(null));
            api.getSyncSettings()
                .then((ss) => {
                    setAutoUpdateEnabled(ss.autoUpdateEnabled === true);
                    if (Number.isInteger(ss.autoUpdateHour)) {
                        setAutoUpdateHour(ss.autoUpdateHour as number);
                    }
                })
                .catch(() => undefined);
        }, 0);
        return () => clearTimeout(id);
    }, []);

    const saveTargets = async (patch: Partial<BackupTargets>) => {
        setBusy("targets");
        try {
            setTargets(await api.saveBackupTargets(patch));
            toast.success("Backup target saved");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        } finally {
            setBusy(null);
        }
    };

    const saveDataBackup = async (patch: Partial<DataBackupSettings>) => {
        try {
            const next = await api.saveDataBackup(patch);
            setDataBackup((prev) => ({
                ...next,
                available: prev?.available,
                hasPassphrase: prev?.hasPassphrase,
                snapshots: prev?.snapshots,
            }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        }
    };

    const runDataBackup = async () => {
        setBusy("dataBackup");
        try {
            const r = await api.runDataBackup();
            const mb = (r.sizeBytes / 1_048_576).toFixed(1);
            const verified =
                r.verified === true
                    ? ", verified readable"
                    : r.verified === false
                      ? " - WARNING: failed verification"
                      : "";
            toast.success(
                `Snapshot written (${mb}MB${r.encrypted ? ", encrypted" : ""}${verified})`
            );
            if (r.upload?.skipped) {
                toast.error(`Off-site copy skipped: ${r.upload.skipped}`);
            }
            setDataBackup(await api.getDataBackup());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Snapshot failed");
        } finally {
            setBusy(null);
        }
    };

    const deleteSnapshot = async (filename: string) => {
        try {
            await api.deleteDataSnapshot(filename);
            setDataBackup(await api.getDataBackup());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed");
        }
    };

    const runAction = async (action: "integrity" | "vacuum" | "prune" | "pruneNotifications") => {
        setBusy(action);
        try {
            const result = await api.runDbMaintenance(action);
            if (action === "integrity") {
                const ok = (result as { ok?: boolean }).ok;
                if (ok) {
                    toast.success("Database integrity verified - no problems found");
                } else {
                    toast.error("Integrity check found problems - restore from a backup");
                }
            } else if (action === "prune") {
                const r = result as {
                    healthHistoryDeleted?: number;
                    automationRunsDeleted?: number;
                };
                toast.success(
                    `Pruned ${(r.healthHistoryDeleted || 0) + (r.automationRunsDeleted || 0)} old log rows`
                );
            } else if (action === "pruneNotifications") {
                const r = result as { notificationsDeleted?: number; days?: number };
                toast.success(
                    `Cleared ${r.notificationsDeleted || 0} read notifications older than ${r.days} days`
                );
            } else {
                toast.success("Database compacted");
            }
            setMaint(await api.getDbMaintenance());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Action failed");
        } finally {
            setBusy(null);
        }
    };

    const toggleMaint = async (
        key:
            | "vacuumEnabled"
            | "integrityCheckEnabled"
            | "pruneLogsEnabled"
            | "pruneNotificationsEnabled",
        value: boolean
    ) => {
        try {
            setMaint(await api.saveDbMaintenance({ [key]: value }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        }
    };

    const saveNotifDays = async (raw: string) => {
        const days = Math.round(Number(raw));
        if (!Number.isFinite(days) || days < 1 || days > 365) {
            toast.error("Days must be between 1 and 365");
            return;
        }
        if (days === maint?.pruneNotificationsDays) {
            return;
        }
        try {
            setMaint(await api.saveDbMaintenance({ pruneNotificationsDays: days }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        }
    };

    return (
        <div className="space-y-5">
            {/* --- History Doctor --- */}
            <Card padding="lg">
                <h3 className="mb-1 font-semibold text-base text-default">Watch history check</h3>
                <p className="mb-4 text-muted text-xs">
                    Looks for watch records that are provably wrong - duplicates copied between
                    providers, or rows belonging to a user that no longer exists. Scanning never
                    changes anything.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        isLoading={scanningHistory}
                        onClick={runHistoryScan}
                        size="sm"
                        variant="secondary"
                    >
                        {historyScan ? "Scan again" : "Scan history"}
                    </Button>
                    {historyScan && historyScan.counts.total > 0 && (
                        <Button
                            isLoading={repairingHistory}
                            onClick={runHistoryRepair}
                            size="sm"
                            variant="primary"
                        >
                            Fix {historyScan.counts.total} issue
                            {historyScan.counts.total === 1 ? "" : "s"}
                        </Button>
                    )}
                </div>

                {historyScan && (
                    <div className="mt-3">
                        {historyScan.counts.total === 0 ? (
                            <p className="text-muted text-sm">
                                No problems found - watch history looks clean.
                            </p>
                        ) : (
                            <>
                                <p className="mb-2 text-default text-sm">
                                    Found {historyScan.counts.total}:{" "}
                                    {historyScan.counts.cross_provider_duplicate} duplicate
                                    {historyScan.counts.cross_provider_duplicate === 1 ? "" : "s"},{" "}
                                    {historyScan.counts.orphaned} orphaned.
                                </p>
                                <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                                    {historyScan.findings.slice(0, 50).map((f) => (
                                        <div
                                            className="rounded-lg p-2.5"
                                            key={f.id}
                                            style={{ background: "var(--color-surface-hover)" }}
                                        >
                                            <p className="text-default text-sm">{f.summary}</p>
                                            <p className="mt-0.5 text-muted text-xs">{f.detail}</p>
                                        </div>
                                    ))}
                                </div>
                                <p className="mt-2 text-muted text-xs">
                                    Fixing deletes only these redundant rows. The original watch
                                    record each duplicate was copied from is kept.
                                </p>
                            </>
                        )}
                    </div>
                )}
            </Card>

            {/* --- Recently deleted --- */}
            <TrashPanel />

            {/* --- Database upkeep --- */}
            <Card padding="lg">
                <h3 className="mb-1 font-semibold text-base text-default">Database upkeep</h3>
                <p className="mb-4 text-muted text-xs">
                    Runs on its own in the background. Nothing here touches watch history, users,
                    catalogs, or the Vault.
                </p>
                {!maint || maint.available === false ? (
                    <p className="text-muted text-sm">Not applicable on this instance.</p>
                ) : (
                    <div className="space-y-3">
                        <MaintRow
                            detail={`Read-only - verifies the database file is not corrupted. Last run ${relative(maint.lastIntegrityCheckAt)}${maint.lastIntegrityOk === false ? " and FAILED" : maint.lastIntegrityOk ? " - healthy" : ""}.`}
                            enabled={maint.integrityCheckEnabled}
                            onRun={() => runAction("integrity")}
                            onToggle={(v) => toggleMaint("integrityCheckEnabled", v)}
                            running={busy === "integrity"}
                            status={
                                maint.lastIntegrityOk === false
                                    ? "bad"
                                    : maint.lastIntegrityOk
                                      ? "good"
                                      : null
                            }
                            title="Integrity checks"
                        />
                        <MaintRow
                            detail={`Reclaims space left behind by deletions. Skipped automatically if the disk is too full to do it safely. Last run ${relative(maint.lastVacuumAt)}.`}
                            enabled={maint.vacuumEnabled}
                            onRun={() => runAction("vacuum")}
                            onToggle={(v) => toggleMaint("vacuumEnabled", v)}
                            running={busy === "vacuum"}
                            title="Compact the database"
                        />
                        <MaintRow
                            detail={`Caps addon health-check history and automation run history, which otherwise grow forever. Only those two - never anything a feature reads by date. Last run ${relative(maint.lastPruneAt)}.`}
                            enabled={maint.pruneLogsEnabled}
                            onRun={() => runAction("prune")}
                            onToggle={(v) => toggleMaint("pruneLogsEnabled", v)}
                            running={busy === "prune"}
                            title="Trim old logs"
                        />
                        <MaintRow
                            detail={`Bell notifications you've already read are cleared once they're older than the cutoff. Unread ones are never touched, no matter how old. Last run ${relative(maint.lastNotificationsPruneAt)}.`}
                            enabled={maint.pruneNotificationsEnabled}
                            extra={
                                <label className="mt-1.5 flex items-center gap-1.5 text-muted text-xs">
                                    Older than
                                    <input
                                        className="w-14 rounded px-1.5 py-0.5 text-center text-xs"
                                        defaultValue={maint.pruneNotificationsDays}
                                        max={365}
                                        min={1}
                                        onBlur={(e) => saveNotifDays(e.target.value)}
                                        style={{
                                            background: "var(--color-surface)",
                                            border: "1px solid var(--color-surface-border)",
                                            color: "var(--color-text)",
                                        }}
                                        type="number"
                                    />
                                    days
                                </label>
                            }
                            onRun={() => runAction("pruneNotifications")}
                            onToggle={(v) => toggleMaint("pruneNotificationsEnabled", v)}
                            running={busy === "pruneNotifications"}
                            title="Clear old read notifications"
                        />
                    </div>
                )}
            </Card>

            {/* --- Updates --- */}
            <Card padding="lg">
                <h3 className="mb-1 font-semibold text-base text-default">Applying updates</h3>
                {capability ? (
                    capability.canSelfUpdate ? (
                        <div className="space-y-3">
                            <p className="text-muted text-xs">
                                This instance can update itself: it backs up first, downloads the
                                new image, then restarts into it. A watchdog stays behind for the
                                switch - if the new version fails its health check within two
                                minutes, the previous image is restored automatically. The restart
                                takes a few seconds and everyone is briefly disconnected.
                            </p>
                            <Button
                                disabled={busy === "update"}
                                onClick={async () => {
                                    setBusy("update");
                                    try {
                                        const r = await api.applyUpdate();
                                        toast.success(r.note || "Update started");
                                    } catch (e) {
                                        toast.error(
                                            e instanceof Error ? e.message : "Update failed"
                                        );
                                    } finally {
                                        setBusy(null);
                                    }
                                }}
                                size="sm"
                                variant="secondary"
                            >
                                {busy === "update" ? "Updating…" : "Back up and update now"}
                            </Button>
                            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-hover p-3">
                                <div className="min-w-0">
                                    <p className="font-medium text-default text-sm">
                                        Update automatically
                                    </p>
                                    <p className="mt-0.5 text-muted text-xs">
                                        Checks once a day at{" "}
                                        <select
                                            className="inline-block rounded px-1 py-0.5 text-xs"
                                            onChange={(e) =>
                                                saveAutoUpdate(
                                                    autoUpdateEnabled,
                                                    Number(e.target.value)
                                                )
                                            }
                                            style={{
                                                background: "var(--color-surface)",
                                                border: "1px solid var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            value={autoUpdateHour}
                                        >
                                            {Array.from({ length: 24 }, (_, h) => (
                                                <option key={h} value={h}>
                                                    {String(h).padStart(2, "0")}:00
                                                </option>
                                            ))}
                                        </select>{" "}
                                        and applies new releases on its own - backup first, watchdog
                                        rollback if the new version fails its health check.
                                    </p>
                                </div>
                                <ToggleSwitch
                                    checked={autoUpdateEnabled}
                                    onChange={() =>
                                        saveAutoUpdate(!autoUpdateEnabled, autoUpdateHour)
                                    }
                                    title="Toggle automatic updates"
                                />
                            </div>
                            <Button
                                disabled={busy === "rollback"}
                                onClick={async () => {
                                    setBusy("rollback");
                                    try {
                                        const r = await api.rollbackUpdate();
                                        toast.success(r.note || "Rollback started");
                                    } catch (e) {
                                        toast.error(
                                            e instanceof Error ? e.message : "Rollback failed"
                                        );
                                    } finally {
                                        setBusy(null);
                                    }
                                }}
                                size="sm"
                                variant="ghost"
                            >
                                {busy === "rollback"
                                    ? "Rolling back…"
                                    : "Roll back to the previous version"}
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-muted text-xs">
                                {capability.reason || "Updating from here is not available."}
                            </p>
                            <p className="text-muted text-xs">Update from the host instead:</p>
                            <code
                                className="block rounded-lg px-3 py-2 font-mono text-xs"
                                style={{
                                    background: "var(--color-surface-hover)",
                                    color: "var(--color-text)",
                                }}
                            >
                                docker compose pull &amp;&amp; docker compose up -d
                            </code>
                            <p className="text-[11px] text-subtle">
                                Updating in place needs the Docker socket mounted into this
                                container, which grants it full control of the host&apos;s Docker -
                                a deliberate trade, so it is never enabled for you.
                            </p>
                        </div>
                    )
                ) : (
                    <p className="text-muted text-sm">Checking…</p>
                )}
            </Card>
            {/* --- Off-site backups --- */}
            <Card padding="lg">
                <h3 className="mb-1 font-semibold text-base text-default">Off-site backups</h3>
                <p className="mb-4 text-muted text-xs">
                    Scheduled backups are written next to the database they protect. Sending a copy
                    somewhere else is what covers losing the whole machine.
                </p>
                {targets ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label
                                    className="mb-1 block font-medium text-muted text-xs"
                                    htmlFor={`${fieldId1}-2`}
                                >
                                    Destination
                                </label>
                                <select
                                    className={inputClass}
                                    id={`${fieldId1}-2`}
                                    onChange={(e) =>
                                        saveTargets({
                                            type: e.target.value as BackupTargets["type"],
                                        })
                                    }
                                    style={inputStyle}
                                    value={targets.type}
                                >
                                    <option value="none">Local only</option>
                                    <option value="s3">S3 (AWS, B2, R2, MinIO…)</option>
                                    <option value="webdav">WebDAV (Nextcloud, rsync.net…)</option>
                                </select>
                            </div>
                            <div>
                                <label
                                    className="mb-1 block font-medium text-muted text-xs"
                                    htmlFor={`${fieldId1}-3`}
                                >
                                    Keep locally <span className="text-subtle">(0 = keep all)</span>
                                </label>
                                <input
                                    className={inputClass}
                                    defaultValue={targets.keepLocal}
                                    id={`${fieldId1}-3`}
                                    max={1000}
                                    min={0}
                                    onBlur={(e) => {
                                        const n = Number(e.target.value);
                                        if (n !== targets.keepLocal) {
                                            saveTargets({ keepLocal: n });
                                        }
                                    }}
                                    style={inputStyle}
                                    type="number"
                                />
                            </div>
                        </div>

                        {targets.type === "s3" && (
                            <div className="grid grid-cols-2 gap-3">
                                {(
                                    [
                                        ["bucket", "Bucket"],
                                        ["region", "Region"],
                                        ["endpoint", "Endpoint (blank for AWS)"],
                                        ["prefix", "Path prefix"],
                                        ["accessKeyId", "Access key ID"],
                                        ["secretAccessKey", "Secret access key"],
                                    ] as [keyof BackupTargets["s3"], string][]
                                ).map(([key, label]) => (
                                    <div key={key}>
                                        <label
                                            className="mb-1 block font-medium text-muted text-xs"
                                            htmlFor={`${repeatedFieldId1}-2-${key}`}
                                        >
                                            {label}
                                        </label>
                                        <input
                                            className={inputClass}
                                            defaultValue={targets.s3[key]}
                                            id={`${repeatedFieldId1}-2-${key}`}
                                            onBlur={(e) => {
                                                if (e.target.value !== targets.s3[key]) {
                                                    saveTargets({
                                                        s3: {
                                                            ...targets.s3,
                                                            [key]: e.target.value,
                                                        },
                                                    });
                                                }
                                            }}
                                            spellCheck={false}
                                            style={inputStyle}
                                            type={key === "secretAccessKey" ? "password" : "text"}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {targets.type === "webdav" && (
                            <div className="grid grid-cols-2 gap-3">
                                {(
                                    [
                                        ["url", "Folder URL"],
                                        ["username", "Username"],
                                        ["password", "Password"],
                                    ] as [keyof BackupTargets["webdav"], string][]
                                ).map(([key, label]) => (
                                    <div key={key}>
                                        <label
                                            className="mb-1 block font-medium text-muted text-xs"
                                            htmlFor={`${repeatedFieldId1}-3-${key}`}
                                        >
                                            {label}
                                        </label>
                                        <input
                                            className={inputClass}
                                            defaultValue={targets.webdav[key]}
                                            id={`${repeatedFieldId1}-3-${key}`}
                                            onBlur={(e) => {
                                                if (e.target.value !== targets.webdav[key]) {
                                                    saveTargets({
                                                        webdav: {
                                                            ...targets.webdav,
                                                            [key]: e.target.value,
                                                        },
                                                    });
                                                }
                                            }}
                                            spellCheck={false}
                                            style={inputStyle}
                                            type={key === "password" ? "password" : "text"}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {targets.type !== "none" && (
                            <div>
                                <label
                                    className="mb-1 block font-medium text-muted text-xs"
                                    htmlFor={`${fieldId1}-6`}
                                >
                                    Encryption passphrase{" "}
                                    <span className="text-subtle">(optional)</span>
                                </label>
                                <input
                                    className={inputClass}
                                    defaultValue={targets.encryptPassphrase || ""}
                                    id={`${fieldId1}-6`}
                                    onBlur={(e) => {
                                        if (e.target.value !== (targets.encryptPassphrase || "")) {
                                            saveTargets({ encryptPassphrase: e.target.value });
                                        }
                                    }}
                                    placeholder="Leave empty to upload plain JSON"
                                    spellCheck={false}
                                    style={inputStyle}
                                    type="password"
                                />
                                <p className="mt-1 text-[11px] text-subtle">
                                    With a passphrase set, uploads are encrypted (.enc) so a leaked
                                    bucket leaks nothing - backups carry addon URLs, which often
                                    embed API keys. Local backups stay unencrypted, so restores from
                                    this box work exactly as before; an .enc file imports through
                                    the normal Import with its passphrase. If the passphrase is
                                    lost, the remote copies cannot be read - keep it somewhere safe.
                                </p>
                            </div>
                        )}

                        {targets.type !== "none" && (
                            <div className="flex items-center justify-between gap-3 pt-1">
                                <p className="text-[11px] text-subtle">
                                    A failed upload never fails the backup - the local copy is
                                    already written, and you get a notification rather than silence.
                                </p>
                                <Button
                                    disabled={busy === "test"}
                                    onClick={async () => {
                                        setBusy("test");
                                        try {
                                            const r = await api.testBackupTarget();
                                            if (r.ok) {
                                                toast.success(
                                                    "Target reachable - test file uploaded"
                                                );
                                            } else {
                                                toast.error(r.error || "Target test failed");
                                            }
                                        } finally {
                                            setBusy(null);
                                        }
                                    }}
                                    size="sm"
                                    variant="secondary"
                                >
                                    {busy === "test" ? "Testing…" : "Test target"}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-muted text-sm">Not available on this instance.</p>
                )}
            </Card>

            {/* --- Full-data backups --- */}
            <Card padding="lg">
                <h3 className="mb-1 font-semibold text-base text-default">
                    Backups: your data (watch history)
                </h3>
                <p className="mb-4 text-muted text-xs">
                    The config backups above deliberately carry no watch history - so every episode
                    anyone has ever watched lives in exactly one place: the database file. This lane
                    snapshots that database. Same destination as above, different contents: config
                    restores your setup, this restores what everyone actually watched.
                </p>
                {!dataBackup || dataBackup.available === false ? (
                    <p className="text-muted text-sm">Not applicable on this instance.</p>
                ) : (
                    <div className="space-y-3">
                        <div
                            className="flex items-start justify-between gap-3 rounded-xl p-3"
                            style={{ background: "var(--color-surface-hover)" }}
                        >
                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 font-medium text-default text-sm">
                                    Scheduled snapshots
                                    {dataBackup.lastError ? (
                                        <ExclamationTriangleIcon
                                            className="h-4 w-4"
                                            style={{ color: "var(--color-error)" }}
                                        />
                                    ) : dataBackup.lastOkAt ? (
                                        <CheckCircleIcon
                                            className="h-4 w-4"
                                            style={{ color: "var(--color-success)" }}
                                        />
                                    ) : null}
                                </p>
                                <p className="mt-0.5 text-muted text-xs">
                                    {dataBackup.lastError
                                        ? `Last attempt failed: ${dataBackup.lastError}`
                                        : `Last snapshot ${relative(dataBackup.lastOkAt)}${dataBackup.lastSizeBytes ? ` (${(dataBackup.lastSizeBytes / 1_048_576).toFixed(1)}MB)` : ""}${dataBackup.lastVerified === true ? ", verified readable" : ""}.`}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-3">
                                    <label className="flex items-center gap-1.5 text-muted text-xs">
                                        Every
                                        <input
                                            className="w-14 rounded px-1.5 py-0.5 text-center text-xs"
                                            defaultValue={dataBackup.frequencyDays}
                                            max={30}
                                            min={1}
                                            onBlur={(e) => {
                                                const n = Number(e.target.value);
                                                if (n !== dataBackup.frequencyDays) {
                                                    saveDataBackup({ frequencyDays: n });
                                                }
                                            }}
                                            style={{
                                                background: "var(--color-surface)",
                                                border: "1px solid var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            type="number"
                                        />
                                        day(s)
                                    </label>
                                    <label className="flex items-center gap-1.5 text-muted text-xs">
                                        Keep
                                        <input
                                            className="w-14 rounded px-1.5 py-0.5 text-center text-xs"
                                            defaultValue={dataBackup.keepLocal}
                                            max={100}
                                            min={1}
                                            onBlur={(e) => {
                                                const n = Number(e.target.value);
                                                if (n !== dataBackup.keepLocal) {
                                                    saveDataBackup({ keepLocal: n });
                                                }
                                            }}
                                            style={{
                                                background: "var(--color-surface)",
                                                border: "1px solid var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            type="number"
                                        />
                                        locally
                                    </label>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <Button
                                    disabled={busy === "dataBackup"}
                                    onClick={runDataBackup}
                                    size="sm"
                                    variant="ghost"
                                >
                                    {busy === "dataBackup" ? "Working…" : "Snapshot now"}
                                </Button>
                                <ToggleSwitch
                                    checked={dataBackup.enabled}
                                    onChange={() =>
                                        saveDataBackup({ enabled: !dataBackup.enabled })
                                    }
                                />
                            </div>
                        </div>

                        <div
                            className="flex items-start justify-between gap-3 rounded-xl p-3"
                            style={{ background: "var(--color-surface-hover)" }}
                        >
                            <div className="min-w-0 flex-1">
                                <p className="font-medium text-default text-sm">
                                    Send snapshots off-site too
                                </p>
                                <p className="mt-0.5 text-muted text-xs">
                                    Uses the same S3/WebDAV target as config backups. A snapshot is
                                    the whole database, so it only ever leaves this box encrypted:{" "}
                                    {dataBackup.hasPassphrase
                                        ? "your encryption passphrase is set, so uploads are allowed."
                                        : "set an encryption passphrase above first, or uploads are skipped and only local copies are kept."}
                                </p>
                            </div>
                            <ToggleSwitch
                                checked={dataBackup.offsite}
                                onChange={() => saveDataBackup({ offsite: !dataBackup.offsite })}
                            />
                        </div>

                        {(dataBackup.snapshots?.length ?? 0) > 0 && (
                            <div className="space-y-1.5">
                                {(dataBackup.snapshots ?? []).slice(0, 6).map((s) => (
                                    <div
                                        className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
                                        key={s.filename}
                                        style={{ background: "var(--color-surface-hover)" }}
                                    >
                                        <span className="min-w-0 truncate text-default">
                                            {s.filename}
                                            <span className="text-muted">
                                                {" "}
                                                · {(s.sizeBytes / 1_048_576).toFixed(1)}MB
                                                {s.encrypted ? " · encrypted" : ""}
                                            </span>
                                        </span>
                                        <span className="flex shrink-0 items-center gap-1">
                                            <Button
                                                onClick={() =>
                                                    api
                                                        .downloadDataSnapshot(s.filename)
                                                        .catch(() => toast.error("Download failed"))
                                                }
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Download
                                            </Button>
                                            <Button
                                                onClick={() => deleteSnapshot(s.filename)}
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Delete
                                            </Button>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <p className="text-[11px] text-subtle">
                            Restoring is deliberately not a button here: swapping the database while
                            the app is holding it open is how a restore goes wrong. Download a
                            snapshot, stop the container, and run{" "}
                            <code style={{ color: "var(--color-text)" }}>
                                node scripts/restore-data-snapshot.js &lt;file&gt;
                            </code>{" "}
                            (add <code style={{ color: "var(--color-text)" }}>--passphrase</code>{" "}
                            for an encrypted one). It moves your current database aside rather than
                            deleting it, so even the restore is reversible.
                        </p>
                    </div>
                )}
            </Card>
        </div>
    );
}

function MaintRow({
    title,
    detail,
    enabled,
    onToggle,
    onRun,
    running,
    status,
    extra,
}: {
    title: string;
    detail: string;
    enabled: boolean;
    onToggle: (v: boolean) => void;
    onRun: () => void;
    running: boolean;
    status?: "good" | "bad" | null;
    extra?: ReactNode;
}) {
    return (
        <div
            className="flex items-start justify-between gap-3 rounded-xl p-3"
            style={{ background: "var(--color-surface-hover)" }}
        >
            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-medium text-default text-sm">
                    {title}
                    {status === "good" && (
                        <CheckCircleIcon
                            className="h-4 w-4"
                            style={{ color: "var(--color-success)" }}
                        />
                    )}
                    {status === "bad" && (
                        <ExclamationTriangleIcon
                            className="h-4 w-4"
                            style={{ color: "var(--color-error)" }}
                        />
                    )}
                </p>
                <p className="mt-0.5 text-muted text-xs">{detail}</p>
                {extra}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <Button disabled={running} onClick={onRun} size="sm" variant="ghost">
                    {running ? "Running…" : "Run now"}
                </Button>
                {/* ToggleSwitch's onChange takes no argument - it just signals a
            flip, so the new value is derived here. */}
                <ToggleSwitch checked={enabled} onChange={() => onToggle(!enabled)} />
            </div>
        </div>
    );
}
