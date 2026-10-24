"use client";

import { CheckIcon, PlusIcon, RectangleStackIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { api, type CustomList } from "@/lib/api";

interface CatalogItem {
    id: string;
    name: string;
    poster?: string | null;
    type: "movie" | "series";
}

// Shared picker body - fetches the account's catalogs on mount, lets you
// toggle the current title into any of them, and create a new one inline.
// Extracted so both AddToListButton's own dropdown (media detail modal) and
// Discover's right-click "Add to Catalogs" menu item render the exact same
// logic instead of two copies drifting apart.
export function CatalogPickerMenu({
    item,
    onBack,
    onDone,
}: {
    item: CatalogItem;
    /** Present when this picker replaces another menu's content in place
     *  (Discover's right-click menu) - renders a "← Back" row above the list. */
    onBack?: () => void;
    /** Fires after a successful toggle/create - callers that close their own
     *  menu on any action (Discover's right-click menu) pass close() here. */
    onDone?: () => void;
}) {
    const [lists, setLists] = useState<CustomList[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [creatingName, setCreatingName] = useState("");
    const [showCreate, setShowCreate] = useState(false);

    useEffect(() => {
        // getLists() now also returns catalogs OTHER accounts have shared with
        // this one (read-only) - this picker adds/removes titles, a write, so
        // it must only ever offer catalogs this account actually owns. Every
        // write route already 404s for a non-owner regardless, but filtering
        // here keeps a shared-with-you catalog from even appearing as a
        // pickable target in the first place.
        api.getLists()
            .then((r) => setLists(Array.isArray(r) ? r.filter((l) => l.isOwner) : []))
            .catch(() => setLists([]))
            .finally(() => setLoaded(true));
    }, []);

    const inList = (list: CustomList) => list.items.some((i) => i.id === item.id);

    const handleToggle = async (list: CustomList) => {
        setBusyId(list.id);
        try {
            if (inList(list)) {
                const updated = await api.removeFromList(list.id, item.id);
                setLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
                toast.success(`Removed from "${list.name}"`);
            } else {
                const updated = await api.addToList(list.id, {
                    id: item.id,
                    name: item.name,
                    poster: item.poster,
                    type: item.type,
                });
                setLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
                toast.success(`Added to "${list.name}"`);
            }
            onDone?.();
        } catch {
            toast.error("Failed to update catalog");
        } finally {
            setBusyId(null);
        }
    };

    const handleCreate = async () => {
        const name = creatingName.trim();
        if (!name) {
            return;
        }
        try {
            const list = await api.createList(name);
            const updated = await api.addToList(list.id, {
                id: item.id,
                name: item.name,
                poster: item.poster,
                type: item.type,
            });
            setLists((prev) => [updated, ...prev]);
            setCreatingName("");
            setShowCreate(false);
            toast.success(`Added to "${name}"`);
            onDone?.();
        } catch {
            toast.error("Failed to create catalog");
        }
    };

    return (
        <>
            {onBack && (
                <button
                    className="mb-1 flex w-full items-center gap-2 rounded-lg border-default border-b px-2 py-2 text-left text-muted text-sm transition-colors hover:bg-surface-hover"
                    onClick={onBack}
                    type="button"
                >
                    ← Back
                </button>
            )}
            {loaded ? (
                <>
                    {lists.length === 0 && !showCreate && (
                        <p className="px-2 py-2 text-muted text-xs">No catalogs yet.</p>
                    )}
                    {lists.map((list) => {
                        const active = inList(list);
                        return (
                            <button
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-default text-sm transition-colors hover:bg-surface-hover"
                                disabled={busyId === list.id}
                                key={list.id}
                                onClick={() => handleToggle(list)}
                                type="button"
                            >
                                <span
                                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${active ? "border-primary bg-primary" : "border-default"}`}
                                >
                                    {active && <CheckIcon className="h-3 w-3 text-white" />}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{list.name}</span>
                                <span className="text-subtle text-xs">{list.items.length}</span>
                            </button>
                        );
                    })}

                    {showCreate ? (
                        <div className="mt-1 border-default border-t p-1.5">
                            <input
                                autoFocus
                                className="w-full rounded-lg border border-transparent bg-surface-hover px-2 py-1.5 text-default text-sm focus:border-primary focus:outline-none"
                                onChange={(e) => setCreatingName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleCreate();
                                    }
                                    if (e.key === "Escape") {
                                        setShowCreate(false);
                                    }
                                }}
                                placeholder="New catalog name"
                                type="text"
                                value={creatingName}
                            />
                        </div>
                    ) : (
                        <button
                            className="mt-1 flex w-full items-center gap-2 rounded-lg border-default border-t px-2 py-2 text-left text-primary text-sm transition-colors hover:bg-surface-hover"
                            onClick={() => setShowCreate(true)}
                            type="button"
                        >
                            <PlusIcon className="h-4 w-4" />
                            New catalog…
                        </button>
                    )}
                </>
            ) : (
                <p className="px-2 py-2 text-muted text-xs">Loading…</p>
            )}
        </>
    );
}

// "Add to catalog" control for the media detail modal (roadmap #7). Thin
// trigger + popover wrapper around CatalogPickerMenu above.
/** `compact` renders an icon-only trigger, for action rows where a labelled
 *  button would be the sixth in a line and push the row onto two. */
export function AddToListButton({
    item,
    compact = false,
    pill = false,
}: {
    item: CatalogItem;
    compact?: boolean;
    pill?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const toggleOpen = useCallback(() => setOpen((v) => !v), []);

    return (
        <div className="relative">
            <button
                aria-label={compact ? "Add to a catalog" : undefined}
                className={
                    pill
                        ? "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-default px-2 py-1 font-medium text-muted text-xs transition-colors hover:text-primary"
                        : compact
                          ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-muted transition-colors hover:bg-primary/20 hover:text-primary"
                          : "flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 font-medium text-default text-sm transition-colors hover:bg-primary/20 hover:text-primary"
                }
                onClick={toggleOpen}
                title={compact ? "Add to a catalog" : undefined}
                type="button"
            >
                {pill ? (
                    <PlusIcon className="h-3.5 w-3.5" />
                ) : (
                    <RectangleStackIcon className={compact ? "h-5 w-5" : "h-4 w-4"} />
                )}
                {pill ? "Catalog" : !compact && "Add to catalog"}
            </button>

            {open && (
                <>
                    {/* Click-away backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 z-50 mt-2 max-h-72 w-60 overflow-y-auto rounded-xl border border-default bg-surface p-1.5 shadow-xl">
                        <CatalogPickerMenu item={item} />
                    </div>
                </>
            )}
        </div>
    );
}
