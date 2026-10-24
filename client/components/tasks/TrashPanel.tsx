"use client";

import { TrashIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

// Recently deleted things, restorable for 30 days - grown from catalogs and
// addons to the full destructive set: users, groups, group memberships,
// vault entries, graveyard wipes and history imports.
//
// The undo toast (see undoToast.tsx) covers the "I just did that by mistake"
// case; this covers "I deleted that last week and want it back". Same
// archive behind both.

type TrashRow = Awaited<ReturnType<typeof api.getTrash>>[number];

// The stored kind keys are compact - render them as words. An import entry
// inverts the verb: "restoring" it REMOVES the rows that import created.
const KIND_LABELS: Record<string, string> = {
    addon: "Addon",
    catalog: "Catalog",
    group: "Group",
    import: "History import",
    membership: "Group removal",
    user: "User",
    vault: "Vault entry",
    viewing: "Removed viewing",
    wipe: "Graveyard wipe",
};

export function TrashPanel() {
    const [items, setItems] = useState<TrashRow[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setItems(await api.getTrash());
        } catch {
            // A trash list that cannot load is not worth an error banner - the
            // panel simply shows nothing.
            setItems([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const restore = async (item: TrashRow) => {
        setBusyId(item.id);
        try {
            await api.restoreFromTrash(item.id);
            toast.success(
                item.kind === "import"
                    ? `Import undone - ${item.label} removed again`
                    : `Restored ${item.label}`
            );
            setItems((prev) => (prev || []).filter((i) => i.id !== item.id));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Restore failed");
        } finally {
            setBusyId(null);
        }
    };

    const purge = async (item: TrashRow) => {
        // This is the one delete with nothing behind it, so it asks first.
        if (!confirm(`Permanently delete "${item.label}"? This cannot be undone.`)) {
            return;
        }
        setBusyId(item.id);
        try {
            await api.purgeTrashItem(item.id);
            setItems((prev) => (prev || []).filter((i) => i.id !== item.id));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not remove that item");
        } finally {
            setBusyId(null);
        }
    };

    if (!items || items.length === 0) {
        return null;
    }

    return (
        <Card padding="lg">
            <h3 className="mb-1 font-semibold text-base text-default">Recently deleted</h3>
            <p className="mb-4 text-muted text-xs">
                Deleted users, groups, addons, catalogs, vault entries, graveyard wipes and history
                imports are kept for 30 days. Restoring puts one back exactly as it was.
            </p>
            <div className="space-y-2">
                {items.map((item) => (
                    <div
                        className="flex items-center gap-3 rounded-xl p-3"
                        key={item.id}
                        style={{ background: "var(--color-surface-hover)" }}
                    >
                        <TrashIcon className="h-4 w-4 shrink-0 text-subtle" />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate font-medium text-default text-sm">
                                    {item.label}
                                </span>
                                <Badge size="sm" variant="muted">
                                    {KIND_LABELS[item.kind] || item.kind}
                                </Badge>
                            </div>
                            <p className="mt-0.5 text-muted text-xs">
                                Deleted {new Date(item.deletedAt).toLocaleDateString()} ·{" "}
                                {item.expiresInDays} day{item.expiresInDays === 1 ? "" : "s"} left
                            </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <Button
                                isLoading={busyId === item.id}
                                onClick={() => restore(item)}
                                size="sm"
                                variant="secondary"
                            >
                                {item.kind === "import" ? "Undo import" : "Restore"}
                            </Button>
                            <Button
                                disabled={busyId === item.id}
                                onClick={() => purge(item)}
                                size="sm"
                                variant="ghost"
                            >
                                Delete forever
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}
