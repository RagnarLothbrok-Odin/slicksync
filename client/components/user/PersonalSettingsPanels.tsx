"use client";

import { type ReactNode, useEffect, useState } from "react";
import { AboutPanel } from "@/components/settings/AboutPanel";
import { SettingRow, ToggleSwitch } from "@/components/settings/SettingRow";
import { Button, Card, ConfirmModal } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import {
    type HistoryPreview,
    type PersonalDevice,
    type PersonalPreferences,
    type PersonalSyncPlan,
    type PersonalSyncStatus,
    personalRequest,
} from "@/lib/user-api";
import { usePersonalPreferences } from "./PersonalPreferences";

function Section({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <Card padding="lg">
            <div className="mb-5">
                <h3 className="font-display font-semibold text-base text-default">{title}</h3>
                <p className="mt-1 text-muted text-xs">{description}</p>
            </div>
            {children}
        </Card>
    );
}
const date = (value: string | null) => (value ? new Date(value).toLocaleString() : "Not yet");
function Failure({ message, retry }: { message: string; retry: () => void }) {
    return (
        <div className="flex flex-wrap items-center gap-3 text-muted text-sm" role="alert">
            <p>{message}</p>
            <Button onClick={retry} size="sm" variant="secondary">
                Try again
            </Button>
        </div>
    );
}

export function PersonalDisplayPanel() {
    const { preferences, ready, saving, error, reload, save } = usePersonalPreferences();
    const rows: Array<{ key: keyof PersonalPreferences; label: string; description: string }> = [
        {
            description: "Show short explanations and help on your pages.",
            key: "beginnerMode",
            label: "Beginner Mode",
        },
        {
            description: "Hide your email, group names, and key details while sharing your screen.",
            key: "hideSensitive",
            label: "Private Mode",
        },
        {
            description: "Show IMDb scores on Discover posters.",
            key: "posterRatings",
            label: "Poster ratings",
        },
        {
            description: "Start a trailer when you open a title in Discover.",
            key: "autoplayTrailer",
            label: "Autoplay trailer",
        },
        {
            description:
                "Start autoplayed trailers with sound. Your browser may still require a tap.",
            key: "trailerSound",
            label: "Autoplay with sound",
        },
    ];
    return (
        <Section description="Your preferences, saved to your account." title="Privacy & Display">
            {error && <Failure message={error} retry={reload} />}
            {!(ready || error) && (
                <p className="text-muted text-sm" role="status">
                    Loading preferences...
                </p>
            )}
            {rows.map((row) => (
                <SettingRow description={row.description} key={row.key} label={row.label}>
                    <ToggleSwitch
                        disabled={
                            !ready ||
                            saving ||
                            (row.key === "trailerSound" && !preferences.autoplayTrailer)
                        }
                        enabled={preferences[row.key]}
                        label={row.label}
                        onChange={(value) => save({ [row.key]: value })}
                    />
                </SettingRow>
            ))}
        </Section>
    );
}

export function PersonalSyncPanel() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const [status, setStatus] = useState<PersonalSyncStatus | null>(null);
    const [plan, setPlan] = useState<PersonalSyncPlan | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        if (!(isReady && userId && authKey)) {
            return;
        }
        const load = () =>
            personalRequest<PersonalSyncStatus>(userId, authKey, "/sync-status")
                .then((value) => {
                    if (active) {
                        setStatus(value);
                        setError("");
                    }
                })
                .catch(() => {
                    if (active) {
                        setError("Could not load your sync status.");
                    }
                });
        load();
        const timer = setInterval(load, 30_000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [userId, authKey, isReady, revision]);
    const preview = async () => {
        if (!(userId && authKey)) {
            return;
        }
        setBusy(true);
        setError("");
        setPlan(null);
        try {
            setPlan(await personalRequest<PersonalSyncPlan>(userId, authKey, "/sync-plan"));
        } catch (errorLocal) {
            setError(
                errorLocal instanceof Error
                    ? errorLocal.message
                    : "Could not load your sync preview."
            );
        } finally {
            setBusy(false);
        }
    };
    return (
        <Section
            description="Your connection and the changes waiting for your next sync."
            title="Sync status"
        >
            {error && <Failure message={error} retry={() => setRevision((value) => value + 1)} />}
            {!(status || error) && (
                <p className="text-muted text-sm" role="status">
                    Loading sync status...
                </p>
            )}
            {status && (
                <>
                    <SettingRow
                        description={date(status.lastSyncedAt)}
                        label="Last successful sync"
                    >
                        <span className="text-default text-sm capitalize">
                            {status.supported ? status.status : "Not applicable"}
                        </span>
                    </SettingRow>
                    {status.error && (
                        <p className="mb-3 text-error text-sm" role="status">
                            {status.error}
                        </p>
                    )}
                    {status.connectionProblem && (
                        <p className="mb-3 text-sm text-warning">
                            Your provider connection needs attention. Sign in again to reconnect.
                        </p>
                    )}
                    {status.supported ? (
                        <Button isLoading={busy} onClick={preview} size="sm" variant="secondary">
                            Preview next sync
                        </Button>
                    ) : (
                        <p className="text-muted text-sm">
                            Jellyfin manages its libraries on the server; there is no addon list to
                            sync.
                        </p>
                    )}
                </>
            )}
            {plan && (
                <div aria-live="polite" className="mt-5 space-y-4 border-default border-t pt-5">
                    <p className="font-medium text-default text-sm">
                        {plan.noGroup
                            ? "No group supplies addons to your account."
                            : plan.alreadySynced
                              ? "You are up to date."
                              : "Changes waiting for your next sync"}
                    </p>
                    {[
                        ["Add", plan.additions],
                        ["Remove", plan.removals],
                    ].map(([label, names]) => (
                        <div key={String(label)}>
                            <h4 className="font-medium text-muted text-xs">{String(label)}</h4>
                            <p className="text-default text-sm">
                                {(names as string[]).join(", ") || "None"}
                            </p>
                        </div>
                    ))}
                    {plan.updates > 0 && (
                        <p className="text-muted text-sm">
                            {plan.updates} addon manifests will be refreshed.
                        </p>
                    )}
                    <details className="text-muted text-sm">
                        <summary className="cursor-pointer">Current and expected addons</summary>
                        <p className="mt-2">Current: {plan.current.join(", ") || "None"}</p>
                        <p className="mt-2">Expected: {plan.desired.join(", ") || "None"}</p>
                    </details>
                </div>
            )}
        </Section>
    );
}

export function PersonalDevicesPanel() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const [devices, setDevices] = useState<PersonalDevice[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const refresh = () => setRevision((value) => value + 1);
        window.addEventListener("personal-devices-changed", refresh);
        return () => window.removeEventListener("personal-devices-changed", refresh);
    }, []);
    const [busy, setBusy] = useState(false);
    const [revoke, setRevoke] = useState<PersonalDevice | null>(null);
    useEffect(() => {
        let active = true;
        if (!(isReady && userId && authKey)) {
            return;
        }
        personalRequest<{ devices: PersonalDevice[] }>(userId, authKey, "/devices")
            .then((data) => {
                if (active) {
                    setDevices(data.devices);
                    setLoaded(true);
                    setError("");
                }
            })
            .catch(() => {
                if (active) {
                    setError("Could not load your devices.");
                }
            });
        return () => {
            active = false;
        };
    }, [isReady, userId, authKey, revision]);
    const change = async (device: PersonalDevice, method: "PATCH" | "DELETE") => {
        if (!(userId && authKey)) {
            return;
        }
        setBusy(true);
        try {
            await personalRequest(userId, authKey, `/devices/${encodeURIComponent(device.id)}`, {
                method,
                ...(method === "PATCH"
                    ? { body: JSON.stringify({ label: device.label || "" }) }
                    : {}),
            });
            setRevision((value) => value + 1);
            setRevoke(null);
            toast.success(method === "PATCH" ? "Device renamed" : "Notifications revoked");
            window.dispatchEvent(new Event("personal-devices-changed"));
        } catch {
            toast.error("Could not update that device");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Section
            description="Only devices registered to your personal account appear here."
            title="Notification devices"
        >
            {error && <Failure message={error} retry={() => setRevision((value) => value + 1)} />}
            {!(loaded || error) && (
                <p className="text-muted text-sm" role="status">
                    Loading devices...
                </p>
            )}
            {loaded && !devices.length && (
                <p className="text-muted text-sm">
                    No devices registered. Turn on notifications above to add this device.
                </p>
            )}
            <div className="space-y-4">
                {devices.map((device) => (
                    <div className="settings-row space-y-3" key={device.id}>
                        <div>
                            <p className="break-words font-medium text-default text-sm">
                                {device.label || device.userAgent || "Notification device"}
                            </p>
                            <p className="mt-1 text-muted text-xs">
                                Added {date(device.createdAt)}
                                {device.lastSeenAt ? ` · Last seen ${date(device.lastSeenAt)}` : ""}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <input
                                aria-label="Device name"
                                className="input-base min-w-0 flex-1 px-3 py-2 text-sm"
                                maxLength={60}
                                onChange={(event) =>
                                    setDevices((items) =>
                                        items.map((item) =>
                                            item.id === device.id
                                                ? { ...item, label: event.target.value }
                                                : item
                                        )
                                    )
                                }
                                placeholder="Name this device"
                                value={device.label || ""}
                            />
                            <Button
                                disabled={busy}
                                onClick={() => change(device, "PATCH")}
                                size="sm"
                                variant="secondary"
                            >
                                Save name
                            </Button>
                            <Button
                                disabled={busy}
                                onClick={() => setRevoke(device)}
                                size="sm"
                                variant="ghost"
                            >
                                Revoke
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
            <Button
                className="mt-4"
                onClick={() => setRevision((value) => value + 1)}
                size="sm"
                variant="ghost"
            >
                Refresh devices
            </Button>
            <ConfirmModal
                confirmText="Revoke"
                description="This device will stop receiving your personal notifications. You can enable them again on that device."
                isLoading={busy}
                isOpen={!!revoke}
                onClose={() => setRevoke(null)}
                onConfirm={() => (revoke ? change(revoke, "DELETE") : Promise.resolve())}
                title="Revoke notifications?"
                variant="danger"
            />
        </Section>
    );
}

export function PersonalHistoryPanel({
    onExport,
    exporting,
}: {
    onExport: () => void;
    exporting: boolean;
}) {
    const { userId, authKey } = useUserAuthHeaders();
    const [preview, setPreview] = useState<HistoryPreview | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState("");
    const choose = async (file?: File) => {
        setPreview(null);
        setError("");
        setResult("");
        if (!(file && userId && authKey)) {
            return;
        }
        if (file.size > 1024 * 1024) {
            setError("Choose a file smaller than 1 MB.");
            return;
        }
        setBusy(true);
        try {
            setPreview(
                await personalRequest<HistoryPreview>(userId, authKey, "/history/preview", {
                    body: JSON.stringify({ text: await file.text() }),
                    method: "POST",
                })
            );
        } catch (errorLocal) {
            setError(errorLocal instanceof Error ? errorLocal.message : "Could not read your file");
        } finally {
            setBusy(false);
        }
    };
    const importRows = async () => {
        if (!(preview && userId && authKey)) {
            return;
        }
        setBusy(true);
        setError("");
        try {
            const resultLocal = await personalRequest<{ imported: number; skipped: number }>(
                userId,
                authKey,
                "/history/import",
                { body: JSON.stringify({ token: preview.token }), method: "POST" }
            );
            setResult(
                `Imported ${resultLocal.imported} movies. ${resultLocal.skipped} already present.`
            );
            setPreview(null);
        } catch (errorLocal) {
            setError(
                errorLocal instanceof Error ? errorLocal.message : "Could not import your history"
            );
        } finally {
            setBusy(false);
        }
    };
    return (
        <Section
            description="Preview a CSV or Trakt movie history JSON before adding it to your own account."
            title="Import watch history"
        >
            <div className="mb-5">
                <Button disabled={exporting} onClick={onExport} size="sm" variant="secondary">
                    {exporting ? "Exporting..." : "Download my data"}
                </Button>
            </div>
            <p className="mb-4 text-muted text-xs">
                Files need an IMDb ID and watch date. Movie history only, up to 2,000 rows and 1 MB.
                Existing history stays intact. Ratings and undated watchlists are skipped.
            </p>
            <label
                className="mb-2 block font-medium text-default text-sm"
                htmlFor="personal-history-file"
            >
                History file
            </label>
            <input
                accept=".csv,.json,text/csv,application/json"
                className="input-base w-full p-3 text-sm"
                disabled={busy}
                id="personal-history-file"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void choose(file);
                }}
                type="file"
            />
            <p className="mt-3 text-muted text-xs">
                CSV example: <code>imdbID,Title,Watched Date</code>, then{" "}
                <code>tt0133093,The Matrix,1999-03-31</code>.
            </p>
            {busy && (
                <p className="mt-4 text-muted text-sm" role="status">
                    Processing your history...
                </p>
            )}
            {error && (
                <p className="mt-4 text-error text-sm" role="alert">
                    {error}
                </p>
            )}
            {result && (
                <p className="mt-4 text-sm text-success" role="status">
                    {result}
                </p>
            )}
            {preview && (
                <div className="mt-5 border-default border-t pt-5">
                    <p className="text-default text-sm">
                        {preview.rows.length} new movies · {preview.duplicates} duplicates ·{" "}
                        {preview.skipped} unsupported or undated entries
                    </p>
                    <ul className="my-4 space-y-2 text-muted text-xs">
                        {preview.rows.slice(0, 8).map((row) => (
                            <li key={row.itemId}>
                                {row.itemName} · {new Date(row.watchedAt).toLocaleDateString()}
                            </li>
                        ))}
                    </ul>
                    {preview.rows.length > 8 && (
                        <p className="mb-3 text-muted text-xs">
                            And {preview.rows.length - 8} more.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <Button
                            disabled={busy || !preview.rows.length}
                            onClick={importRows}
                            size="sm"
                        >
                            Import {preview.rows.length} movies
                        </Button>
                        <Button
                            disabled={busy}
                            onClick={() => setPreview(null)}
                            size="sm"
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </Section>
    );
}

export function PersonalHelpPanel() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const [version, setVersion] = useState("");
    useEffect(() => {
        let active = true;
        if (isReady && userId && authKey) {
            personalRequest<{ version: string }>(userId, authKey, "/about")
                .then((data) => {
                    if (active) {
                        setVersion(data.version);
                    }
                })
                .catch(() => undefined);
        }
        return () => {
            active = false;
        };
    }, [isReady, userId, authKey]);
    return (
        <div className="space-y-6">
            <Section
                description={
                    version
                        ? `SlickSync v${version} · Help for your account`
                        : "Help for your account"
                }
                title="Help"
            >
                <div className="space-y-5 text-muted text-sm">
                    <div>
                        <h4 className="mb-1 font-medium text-default">
                            Discover and your watchlist
                        </h4>
                        <p>
                            Browse movies and shows, open a title for details, and save it to My
                            watchlist. Your saved titles and reactions belong to you.
                        </p>
                    </div>
                    <div>
                        <h4 className="mb-1 font-medium text-default">Syncing your addons</h4>
                        <p>
                            Use Sync on Home to apply the addons supplied by your groups. Settings →
                            Sync shows the last result and lets you preview additions and removals
                            first. Jellyfin libraries are managed by the server instead.
                        </p>
                    </div>
                    <div>
                        <h4 className="mb-1 font-medium text-default">Reconnect your provider</h4>
                        <p>
                            If your connection stops working, sign out and sign in again with the
                            same Stremio, Nuvio, or Jellyfin account. Ask your household
                            administrator if it stays disconnected.
                        </p>
                    </div>
                    <div>
                        <h4 className="mb-1 font-medium text-default">Your data and privacy</h4>
                        <p>
                            Activity Visibility controls what group members see. Public Stats is a
                            separate public link. You can download your data from General, import
                            movie history here, and remove your own account from Security.
                        </p>
                    </div>
                    <div>
                        <h4 className="mb-1 font-medium text-default">Phone notifications</h4>
                        <p>
                            Install this site to your home screen if your browser requires it, allow
                            notifications, and turn them on in Notifications. You can rename or
                            revoke your devices there.
                        </p>
                    </div>
                </div>
            </Section>
            <AboutPanel lumiere={false} shared={false} />
            <Section
                description="The person running this instance controls the server."
                title="Your household administrator"
            >
                <p className="text-muted text-sm">
                    They can access data stored on it, including provider connections and watch
                    history. Hiding your activity from group members does not hide it from the
                    server administrator.
                </p>
            </Section>
        </div>
    );
}
