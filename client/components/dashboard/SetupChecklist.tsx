"use client";

import { CheckCircleIcon, ChevronDownIcon, XMarkIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// What this instance hasn't been set up with yet.
//
// Every fact here was already discoverable - but only by opening five
// different pages and knowing what to look for, which is exactly what a new
// operator cannot do. This puts the unfinished items in one place with a
// link each.
//
// Deliberately NOT a nag: nothing listed is required for SlickSync to work,
// items disappear as they're done, the whole card can be dismissed forever,
// and it hides itself once everything is complete. Dismissal is per-device
// (localStorage) for the same reason Beginner Mode is - it's about one
// person's view, not a shared setting somebody else flips.

const DISMISS_KEY = "slicksync-setup-checklist-dismissed";

interface ChecklistItem {
    detail: string;
    done: boolean;
    href: string;
    key: string;
    label: string;
}

export function SetupChecklist() {
    const [items, setItems] = useState<ChecklistItem[] | null>(null);
    const [dismissed, setDismissed] = useState(true); // assume hidden until localStorage is read post-mount
    const [open, setOpen] = useState(false);

    useEffect(() => {
        try {
            setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
        } catch {
            setDismissed(false);
        }
    }, []);

    const load = useCallback(async () => {
        try {
            const s = await api.getSetupStatus();
            setItems([
                {
                    detail: "Connect a Stremio or Nuvio account so there is something to sync.",
                    done: s.users.done,
                    href: "/users",
                    key: "users",
                    label: "Add a user",
                },
                {
                    detail: "Browse the directory or paste a manifest URL.",
                    done: s.addons.done,
                    href: "/addons",
                    key: "addons",
                    label: "Add an addon",
                },
                {
                    detail: "Otherwise nothing tells you when an addon goes down or a backup fails.",
                    done: s.notifications.done,
                    href: "/settings",
                    key: "notifications",
                    label: "Turn on notifications",
                },
                {
                    detail: 'Watch Time Today and streaks bucket by day - this decides when "today" ends.',
                    done: s.timezone.done,
                    href: "/settings",
                    key: "timezone",
                    label: "Set your timezone",
                },
                {
                    detail: "A backup sitting next to a dead server is not a backup.",
                    done: s.offsiteBackup.done,
                    href: "/tasks",
                    key: "offsiteBackup",
                    label: "Send backups off-site",
                },
                {
                    detail: "The only way to restore Vault credentials onto a brand-new instance.",
                    done: s.recoveryKit.done,
                    href: "/settings",
                    key: "recoveryKit",
                    label: "Export a Recovery Kit",
                },
                {
                    detail: 'One click sets up "tell me when an addon goes down".',
                    done: s.automation.done,
                    href: "/tasks",
                    key: "automation",
                    label: "Try an automation recipe",
                },
            ]);
        } catch {
            // Silent: a checklist that cannot load is not worth an error banner on
            // someone's dashboard.
            setItems([]);
        }
    }, []);

    useEffect(() => {
        if (!dismissed) {
            load();
        }
    }, [dismissed, load]);

    if (dismissed || !items) {
        return null;
    }
    const remaining = items.filter((i) => !i.done);
    // Nothing left to do - the card retires itself rather than sitting there
    // as a wall of ticks.
    if (remaining.length === 0) {
        return null;
    }

    const handleDismiss = () => {
        try {
            localStorage.setItem(DISMISS_KEY, "1");
        } catch {
            /* private mode */
        }
        setDismissed(true);
    };

    return (
        <div
            className="mb-5 rounded-2xl"
            style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
            }}
        >
            {/* One line, closed by default - opened only when someone wants it. */}
            <div className="flex items-center gap-2 px-4 py-2.5">
                <button
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                    onClick={() => {
                        if (!open) {
                            load();
                        }
                        setOpen(!open);
                    }}
                    type="button"
                >
                    <span className="font-medium text-default">Finish setting up</span>
                    <span className="text-muted">· {remaining.length} left</span>
                    <span className="hidden truncate text-subtle text-xs sm:inline">
                        - optional, the things people usually turn on
                    </span>
                    <ChevronDownIcon
                        className={`ml-auto h-4 w-4 shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`}
                    />
                </button>
                <button
                    aria-label="Hide setup checklist"
                    className="shrink-0 rounded-lg p-1 text-subtle hover:text-default"
                    onClick={handleDismiss}
                    title="Hide this for good"
                    type="button"
                >
                    <XMarkIcon className="h-4 w-4" />
                </button>
            </div>

            {open && (
                <div className="px-4 pb-4">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {remaining.map((item) => (
                            <Link
                                className="nav-item-hover-pill block rounded-xl p-3 transition-colors"
                                href={item.href}
                                key={item.key}
                                style={{ background: "var(--color-surface-hover)" }}
                            >
                                <span className="block font-medium text-default text-sm">
                                    {item.label}
                                </span>
                                <span className="mt-0.5 block text-muted text-xs">
                                    {item.detail}
                                </span>
                            </Link>
                        ))}
                    </div>
                    {items.length - remaining.length > 0 && (
                        <p className="mt-3 flex items-center gap-1.5 text-muted text-xs">
                            <CheckCircleIcon
                                className="h-4 w-4 shrink-0"
                                style={{ color: "var(--color-success)" }}
                            />
                            Done:{" "}
                            {items
                                .filter((i) => i.done)
                                .map((i) => i.label)
                                .join(" · ")}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
