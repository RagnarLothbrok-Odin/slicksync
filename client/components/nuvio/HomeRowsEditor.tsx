"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
    ArrowLeftIcon,
    Bars3Icon,
    EyeIcon,
    EyeSlashIcon,
    PencilIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import {
    Badge,
    Button,
    Card,
    CSS,
    closestCenter,
    DndContext,
    SortableContext,
    useSortable,
    useSortableSensors,
} from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type NuvioHomeRow } from "@/lib/api";

// Editor for a Nuvio profile's home-screen row arrangement - the order rows
// appear in, what each is called, and which are hidden. That arrangement is
// a synced per-profile blob in Nuvio's own backend (see
// server/utils/nuvioHomeLayout.js); the client owns no UI for rearranging it
// beyond dragging on the device itself, and one bad write from any client
// wipes the lot, which is why the layout guard snapshots it.
//
// Two lists on purpose: rows the arrangement already knows about (draggable,
// in their real order) and catalogs the account installs that the
// arrangement has never mentioned - a fresh profile has plenty of the
// latter, because the client only records a preference once a row has been
// touched. Adding one moves it into the arranged list at the end.

interface Props {
    /** Returns to the collections view - this is a view on that page, not a dialog. */
    onDone: () => void;
    profileId: number;
    profileName: string;
    userId: string;
}

function SortableRow({
    row,
    index,
    onRename,
    onToggle,
    onRemove,
}: {
    row: NuvioHomeRow;
    index: number;
    onRename: (index: number, title: string) => void;
    onToggle: (index: number) => void;
    onRemove: (index: number) => void;
}) {
    const id = `${row.addon_id}:${row.type}:${row.catalog_id}`;
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id,
    });
    const [editing, setEditing] = useState(false);

    return (
        <div
            className="flex items-center gap-2 rounded-xl p-2.5"
            ref={setNodeRef}
            style={{
                background: "var(--color-surface-hover)",
                opacity: isDragging ? 0.5 : row.enabled ? 1 : 0.55,
                transform: CSS.Transform.toString(transform),
                transition,
            }}
        >
            <button
                className="shrink-0 cursor-grab touch-none text-muted"
                type="button"
                {...attributes}
                {...listeners}
                aria-label="Drag to reorder"
            >
                <Bars3Icon className="h-4 w-4" />
            </button>
            <span className="w-6 shrink-0 text-center text-subtle text-xs">{index + 1}</span>
            <div className="min-w-0 flex-1">
                {editing ? (
                    <input
                        autoFocus
                        className="w-full rounded px-2 py-1 text-sm"
                        defaultValue={row.custom_title}
                        onBlur={(e) => {
                            onRename(index, e.target.value);
                            setEditing(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                (e.target as HTMLInputElement).blur();
                            }
                            if (e.key === "Escape") {
                                setEditing(false);
                            }
                        }}
                        placeholder={row.catalogName}
                        style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                            color: "var(--color-text)",
                        }}
                    />
                ) : (
                    <p className="truncate text-default text-sm">
                        {row.custom_title || row.catalogName}
                        {row.custom_title && (
                            <span className="text-subtle text-xs"> (was {row.catalogName})</span>
                        )}
                    </p>
                )}
                <p className="truncate text-muted text-xs">
                    {row.addonName}
                    {row.orphaned && (
                        <Badge className="ml-1.5" size="sm" variant="error">
                            addon not installed
                        </Badge>
                    )}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <button
                    className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-default"
                    onClick={() => setEditing(true)}
                    title="Rename this row"
                    type="button"
                >
                    <PencilIcon className="h-4 w-4" />
                </button>
                <button
                    className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-default"
                    onClick={() => onToggle(index)}
                    title={row.enabled ? "Hide this row on the device" : "Show this row again"}
                    type="button"
                >
                    {row.enabled ? (
                        <EyeIcon className="h-4 w-4" />
                    ) : (
                        <EyeSlashIcon className="h-4 w-4" />
                    )}
                </button>
                {row.orphaned && (
                    <Button onClick={() => onRemove(index)} size="sm" variant="ghost">
                        Remove
                    </Button>
                )}
            </div>
        </div>
    );
}

export function HomeRowsEditor({ userId, profileId, profileName, onDone }: Props) {
    const [rows, setRows] = useState<NuvioHomeRow[]>([]);
    const [unarranged, setUnarranged] = useState<NuvioHomeRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const sensors = useSortableSensors();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.getNuvioHomeLayout(userId, profileId);
            setRows(r.items || []);
            setUnarranged(r.unarranged || []);
            setDirty(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not read the home layout");
        } finally {
            setLoading(false);
        }
    }, [userId, profileId]);

    useEffect(() => {
        load();
    }, [load]);

    const onDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }
        const idOf = (r: NuvioHomeRow) => `${r.addon_id}:${r.type}:${r.catalog_id}`;
        const from = rows.findIndex((r) => idOf(r) === active.id);
        const to = rows.findIndex((r) => idOf(r) === over.id);
        if (from < 0 || to < 0) {
            return;
        }
        setRows((prev) => arrayMove(prev, from, to));
        setDirty(true);
    };

    const rename = (index: number, title: string) => {
        setRows((prev) =>
            prev.map((r, i) => (i === index ? { ...r, custom_title: title.trim() } : r))
        );
        setDirty(true);
    };
    const toggle = (index: number) => {
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r)));
        setDirty(true);
    };
    const remove = (index: number) => {
        setRows((prev) => prev.filter((_, i) => i !== index));
        setDirty(true);
    };
    const add = (row: NuvioHomeRow) => {
        setRows((prev) => [...prev, { ...row, arranged: true }]);
        setUnarranged((prev) =>
            prev.filter(
                (r) =>
                    !(
                        r.addon_id === row.addon_id &&
                        r.type === row.type &&
                        r.catalog_id === row.catalog_id
                    )
            )
        );
        setDirty(true);
    };

    const save = async () => {
        setSaving(true);
        try {
            const r = await api.saveNuvioHomeLayout(userId, profileId, rows);
            toast.success(
                `Home layout saved - ${r.rows} row${r.rows === 1 ? "" : "s"} pushed to ${profileName}`
            );
            setDirty(false);
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save the home layout");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card padding="lg">
            <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <Button
                                leftIcon={<ArrowLeftIcon className="h-4 w-4" />}
                                onClick={onDone}
                                size="sm"
                                variant="ghost"
                            >
                                Collections
                            </Button>
                            <h3 className="font-semibold text-base text-default">
                                Home rows · {profileName}
                            </h3>
                        </div>
                        <p className="mt-1 text-muted text-xs">
                            Drag to reorder the rows on this profile&apos;s Nuvio home screen,
                            rename any of them, or hide the ones you never use. Saving pushes the
                            whole arrangement to the account; the layout guard snapshots it first,
                            so a bad save is recoverable.
                        </p>
                    </div>
                    <Button
                        disabled={!dirty || rows.length === 0}
                        isLoading={saving}
                        onClick={save}
                        size="sm"
                        variant="primary"
                    >
                        Save arrangement
                    </Button>
                </div>

                {loading ? (
                    <p className="py-6 text-center text-muted text-sm">
                        Reading the current arrangement…
                    </p>
                ) : (
                    <>
                        <div className="max-h-[58vh] overflow-y-auto pr-1">
                            <DndContext
                                collisionDetection={closestCenter}
                                modifiers={[restrictToParentElement]}
                                onDragEnd={onDragEnd}
                                sensors={sensors}
                            >
                                <SortableContext
                                    items={rows.map(
                                        (r) => `${r.addon_id}:${r.type}:${r.catalog_id}`
                                    )}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="space-y-1.5">
                                        {rows.map((row, i) => (
                                            <SortableRow
                                                index={i}
                                                key={`${row.addon_id}:${row.type}:${row.catalog_id}`}
                                                onRemove={remove}
                                                onRename={rename}
                                                onToggle={toggle}
                                                row={row}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                            {rows.length === 0 && (
                                <p className="py-6 text-center text-muted text-sm">
                                    This profile has no synced arrangement yet - add rows below to
                                    create one.
                                </p>
                            )}
                        </div>

                        {unarranged.length > 0 && (
                            <div>
                                <p
                                    className="mb-1.5 font-semibold text-[10px] uppercase tracking-wider"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    Not yet arranged ({unarranged.length})
                                </p>
                                <p className="mb-2 text-muted text-xs">
                                    Catalogs this account installs that the saved arrangement has
                                    never mentioned. They still show on the device in its own
                                    default order - add one here to place it deliberately.
                                </p>
                                <div className="max-h-[20vh] space-y-1 overflow-y-auto pr-1">
                                    {unarranged.map((row) => (
                                        <div
                                            className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
                                            key={`${row.addon_id}:${row.type}:${row.catalog_id}`}
                                            style={{ background: "var(--color-surface-hover)" }}
                                        >
                                            <span className="min-w-0 truncate text-default text-xs">
                                                {row.catalogName}{" "}
                                                <span className="text-muted">
                                                    · {row.addonName}
                                                </span>
                                            </span>
                                            <Button
                                                onClick={() => add(row)}
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Add
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between gap-2 pt-1">
                            <p className="text-[11px] text-subtle">
                                {dirty
                                    ? "Unsaved changes - nothing reaches the device until you save."
                                    : "No changes yet."}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button onClick={onDone} size="sm" variant="ghost">
                                    {dirty ? "Discard" : "Back"}
                                </Button>
                                <Button
                                    disabled={!dirty || rows.length === 0}
                                    isLoading={saving}
                                    onClick={save}
                                    size="sm"
                                    variant="primary"
                                >
                                    Save arrangement
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Card>
    );
}
