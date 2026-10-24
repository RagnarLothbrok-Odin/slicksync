"use client";

// On an invitation: "Make them a Jellyfin account on…" - the household's
// real Jellyfin servers where someone here signs in as an administrator
// (server/utils/jellyfinInviteAccounts.js). Shows nothing when there are no
// Jellyfin servers at all. A server without an administrator's sign-in is
// listed but can't be picked, with the reason.

import { ServerStackIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Server {
    key: string;
    name: string;
    canCreate: boolean;
}

export function InviteJellyfinAccountPicker({
    value,
    onChange,
}: {
    value: string | null;
    onChange: (key: string | null) => void;
}) {
    const [servers, setServers] = useState<Server[] | null>(null);
    useEffect(() => {
        api.getJellyfinInviteServers()
            .then((r) => setServers(r.servers))
            .catch(() => setServers([]));
    }, []);
    if (!servers || servers.length === 0) {
        return null;
    }

    const choices: (Server | null)[] = [null, ...servers];
    return (
        <div>
            <p className="mb-1 font-medium text-sm" style={{ color: "var(--color-text)" }}>
                Make them a Jellyfin account
            </p>
            <p className="mb-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                They pick a password when they join; the account stays off until you accept them,
                and switches off if they expire or you deactivate them.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {choices.map((s) => {
                    const on = (s?.key || null) === (value || null);
                    const blocked = !!s && !s.canCreate;
                    return (
                        <button
                            aria-pressed={on}
                            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-primary bg-primary/10" : "border-default hover:bg-surface-hover"}`}
                            disabled={blocked}
                            key={s?.key || "none"}
                            onClick={() => onChange(s ? s.key : null)}
                            title={
                                blocked
                                    ? "Needs someone here who signs in to this server as an administrator"
                                    : undefined
                            }
                            type="button"
                        >
                            <ServerStackIcon className="h-4 w-4 shrink-0 text-muted" />
                            <span className="min-w-0">
                                <span
                                    className="block truncate text-sm"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    {s ? s.name : "No account"}
                                </span>
                                {blocked && (
                                    <span
                                        className="block text-[11px]"
                                        style={{ color: "var(--color-text-muted)" }}
                                    >
                                        Needs an administrator here
                                    </span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
