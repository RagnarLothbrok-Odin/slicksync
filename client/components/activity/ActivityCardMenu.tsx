"use client";

// The menu on an Activity poster: right-click on a computer, press and hold on
// a phone. One menu for the whole page (the page keeps which card it's for),
// drawn at the click or the finger with the shared ContextMenu.
//
// "Remove from Activity" asks first, in the menu itself, because it takes the
// viewing out of that person's watch time and history too (into the Trash).

import {
    ArchiveBoxIcon,
    BookmarkIcon,
    CheckCircleIcon,
    FunnelIcon,
    InformationCircleIcon,
    UserIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { useRef, useState } from "react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { UserAvatar } from "@/components/ui/UserAvatar";

export interface MenuWatcher {
    userAvatarUrl?: string | null;
    userColorIndex?: number;
    userEmail?: string;
    userId: string;
    userName: string;
    userUseGravatar?: boolean;
}
export interface MenuTarget {
    detail: string; // "47 min · today 3:18 PM"
    isShow: boolean;
    title: string; // "Twin Peaks · S1 E2"
    watchers: MenuWatcher[];
    x: number;
    y: number;
}

/** Right-click and press-and-hold on one card. `suppressClick()` is true for
 * the tap that ends a hold, so it doesn't also open the details. */
export function useCardMenuPress(open: (x: number, y: number) => void) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const start = useRef<{ x: number; y: number } | null>(null);
    const held = useRef(false);
    const clear = () => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    };
    return {
        handlers: {
            onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                open(e.clientX, e.clientY);
            },
            onTouchCancel: clear,
            onTouchEnd: clear,
            onTouchMove: (e: React.TouchEvent) => {
                const t = e.touches[0];
                if (!(t && start.current)) {
                    return;
                }
                if (
                    Math.abs(t.clientX - start.current.x) > 10 ||
                    Math.abs(t.clientY - start.current.y) > 10
                ) {
                    clear();
                }
            },
            onTouchStart: (e: React.TouchEvent) => {
                const t = e.touches[0];
                if (!t) {
                    return;
                }
                held.current = false;
                start.current = { x: t.clientX, y: t.clientY };
                clear();
                timer.current = setTimeout(() => {
                    held.current = true;
                    timer.current = null;
                    open(t.clientX, t.clientY);
                }, 500);
            },
        },
        suppressClick: () => {
            const h = held.current;
            held.current = false;
            return h;
        },
    };
}

export function ActivityCardMenu({
    target,
    onClose,
    actions,
}: {
    target: MenuTarget | null;
    onClose: () => void;
    actions: {
        openDetails: () => void;
        onlyTitle: () => void;
        onlyPerson: (userId: string) => void;
        addToWatchlist: () => void;
        markNotWatched: () => void;
        buryShow: () => void;
        remove: (watcher: MenuWatcher) => Promise<void>;
    };
}) {
    const [confirm, setConfirm] = useState<MenuWatcher | null>(null);
    const [busy, setBusy] = useState(false);
    if (!target) {
        return null;
    }
    const close = () => {
        setConfirm(null);
        onClose();
    };
    const item =
        "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-default hover:bg-surface-hover transition-colors text-left";
    const icon = "w-4 h-4 text-muted shrink-0";
    const run = (fn: () => void) => () => {
        close();
        fn();
    };
    return (
        <ContextMenu isOpen onClose={close} position={{ x: target.x, y: target.y }}>
            <div className="w-[min(296px,calc(100vw-1.5rem))]">
                <div className="mb-1 border-default border-b px-3.5 pt-2 pb-2.5">
                    <div className="truncate font-semibold text-[15px] text-default">
                        {target.title}
                    </div>
                    {/* Who watched it, each with their picture, in the theme's accent
              lightened for reading; when and how long underneath. */}
                    <div className="mt-1.5 flex flex-col gap-1">
                        {target.watchers.map((w) => (
                            <div
                                className="flex min-w-0 items-center gap-2 font-semibold text-[14px]"
                                key={w.userId}
                                style={{
                                    color: "color-mix(in srgb, var(--color-primary) 45%, #ffffff)",
                                }}
                            >
                                <UserAvatar
                                    colorIndex={w.userColorIndex}
                                    email={w.userEmail}
                                    name={w.userName}
                                    size="xs"
                                    src={w.userAvatarUrl || undefined}
                                    useGravatar={w.userUseGravatar}
                                    userId={w.userId}
                                />
                                <span className="truncate">{w.userName}</span>
                            </div>
                        ))}
                    </div>
                    {target.detail && (
                        <div
                            className="mt-1 truncate text-[13px]"
                            style={{
                                color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
                            }}
                        >
                            Watched {target.detail}
                        </div>
                    )}
                </div>
                {confirm ? (
                    <div className="px-3 py-2">
                        <p className="font-medium text-[15px] text-default">
                            Remove {confirm.userName}&rsquo;s viewing?
                        </p>
                        <p className="mt-1 text-[13px] text-muted">
                            It comes off the Activity page and out of {confirm.userName}&rsquo;s
                            watch time and history for that day, so their totals and stats drop too.
                            The Trash keeps it for 30 days if you want it back.
                        </p>
                        <div className="mt-3 flex justify-end gap-2">
                            <button
                                className="rounded-lg px-3 py-1.5 text-default text-sm hover:bg-surface-hover"
                                onClick={() => setConfirm(null)}
                                type="button"
                            >
                                Cancel
                            </button>
                            <button
                                className="rounded-lg px-3 py-1.5 font-semibold text-sm text-white disabled:opacity-60"
                                disabled={busy}
                                onClick={async () => {
                                    setBusy(true);
                                    try {
                                        await actions.remove(confirm);
                                    } finally {
                                        setBusy(false);
                                        close();
                                    }
                                }}
                                style={{ background: "var(--color-error)" }}
                                type="button"
                            >
                                {busy ? "Removing…" : "Remove"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <button className={item} onClick={run(actions.openDetails)} type="button">
                            <InformationCircleIcon className={icon} />
                            Open details
                        </button>
                        <button className={item} onClick={run(actions.onlyTitle)} type="button">
                            <FunnelIcon className={icon} />
                            <span className="truncate">
                                Only show {target.title.split(" · ")[0]}
                            </span>
                        </button>
                        {target.watchers.map((w) => (
                            <button
                                className={item}
                                key={`only-${w.userId}`}
                                onClick={run(() => actions.onlyPerson(w.userId))}
                                type="button"
                            >
                                <UserIcon className={icon} />
                                <span className="truncate">
                                    Only show {w.userName}&rsquo;s activity
                                </span>
                            </button>
                        ))}
                        <div className="my-1 h-px bg-[color:var(--color-surface-border)]" />
                        <button
                            className={item}
                            onClick={run(actions.addToWatchlist)}
                            type="button"
                        >
                            <BookmarkIcon className={icon} />
                            Add to Watchlist
                        </button>
                        <button
                            className={item}
                            onClick={run(actions.markNotWatched)}
                            type="button"
                        >
                            <CheckCircleIcon className={icon} />
                            Mark as not watched
                        </button>
                        {target.isShow && (
                            <button className={item} onClick={run(actions.buryShow)} type="button">
                                <ArchiveBoxIcon className={icon} />
                                Bury show in the Graveyard
                            </button>
                        )}
                        <div className="my-1 h-px bg-[color:var(--color-surface-border)]" />
                        {target.watchers.map((w) => (
                            <button
                                className={item}
                                key={`rm-${w.userId}`}
                                onClick={() => setConfirm(w)}
                                style={{ color: "var(--color-error)" }}
                                type="button"
                            >
                                <XCircleIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate">
                                    {target.watchers.length > 1
                                        ? `Remove ${w.userName}’s viewing`
                                        : "Remove from Activity"}
                                </span>
                            </button>
                        ))}
                    </>
                )}
            </div>
        </ContextMenu>
    );
}
