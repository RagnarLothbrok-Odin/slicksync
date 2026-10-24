"use client";

import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { type AddonConfigField, decodeAddonConfig } from "@/lib/addonConfig";

// In-place addon configuration editor. Decodes the settings most addons
// carry inside their manifest URL (see lib/addonConfig.ts for the wire
// shapes) into editable fields; Save rebuilds the URL and hands it to the
// SAME save path the manual URL input already uses - which re-fetches the
// manifest server-side and updates every user/group carrying the addon.
// Nothing new happens on save that pasting the rebuilt URL wouldn't do;
// this just removes the "reconfigure on the addon's website, copy, paste"
// loop for formats we can read.
//
// Addons whose config is encrypted/opaque (AIOStreams-style) get the
// fallback: a link to the addon's own hosted /configure page - by
// convention prefilled from the URL's config segment - plus the existing
// URL input to paste the result back into.
interface AddonConfigModalProps {
    addonName: string;
    isOpen: boolean;
    manifestUrl: string;
    onClose: () => void;
    /** The detail page's existing save handler (ManifestUrlInput's onSave). */
    onSave: (data: { manifestUrl: string }) => Promise<void>;
}

export function AddonConfigModal({
    isOpen,
    onClose,
    addonName,
    manifestUrl,
    onSave,
}: AddonConfigModalProps) {
    const configFieldId = useId();
    const decoded = useMemo(() => decodeAddonConfig(manifestUrl), [manifestUrl]);
    const [fields, setFields] = useState<AddonConfigField[] | null>(null);
    const [revealed, setRevealed] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);

    // Fields state initializes lazily from the decoded config each time the
    // modal opens fresh (keyed remount handles reset - see call site).
    const current = fields ?? decoded?.fields ?? [];

    const setField = (key: string, value: string) => {
        setFields(current.map((f) => (f.key === key ? { ...f, value } : f)));
    };

    const handleSave = async () => {
        if (!decoded) {
            return;
        }
        let rebuilt: string;
        try {
            rebuilt = decoded.rebuild(current);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Invalid value");
            return;
        }
        if (rebuilt === manifestUrl) {
            onClose();
            return;
        }
        setSaving(true);
        try {
            await onSave({ manifestUrl: rebuilt });
            toast.success("Configuration saved and redeployed");
            onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save configuration");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" title={`Configure ${addonName}`}>
            {decoded ? (
                <div className="space-y-4">
                    <p className="text-muted text-sm">
                        These settings live inside the addon&apos;s install URL. Saving rebuilds the
                        URL, re-fetches the manifest, and updates every user and group that has this
                        addon — no remove/re-import needed.
                    </p>
                    <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                        {current.map((f) => (
                            <div key={f.key}>
                                <label
                                    className="mb-1 flex items-center justify-between font-medium text-muted text-xs"
                                    htmlFor={`${configFieldId}-${f.key}`}
                                >
                                    <span className="font-mono">{f.key}</span>
                                    <span className="flex items-center gap-2">
                                        {f.kind !== "string" && (
                                            <span className="text-subtle normal-case">
                                                {f.kind === "string-list"
                                                    ? "comma-separated"
                                                    : f.kind}
                                            </span>
                                        )}
                                        {f.sensitive && (
                                            <button
                                                aria-label={
                                                    revealed.has(f.key)
                                                        ? "Hide value"
                                                        : "Show value"
                                                }
                                                className="text-subtle transition-colors hover:text-default"
                                                onClick={() =>
                                                    setRevealed((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(f.key)) {
                                                            next.delete(f.key);
                                                        } else {
                                                            next.add(f.key);
                                                        }
                                                        return next;
                                                    })
                                                }
                                                type="button"
                                            >
                                                {revealed.has(f.key) ? (
                                                    <EyeSlashIcon className="h-3.5 w-3.5" />
                                                ) : (
                                                    <EyeIcon className="h-3.5 w-3.5" />
                                                )}
                                            </button>
                                        )}
                                    </span>
                                </label>
                                {f.kind === "boolean" ? (
                                    <select
                                        className="w-full rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                                        id={`${configFieldId}-${f.key}`}
                                        onChange={(e) => setField(f.key, e.target.value)}
                                        value={f.value}
                                    >
                                        <option value="true">true</option>
                                        <option value="false">false</option>
                                    </select>
                                ) : (
                                    <input
                                        className="w-full rounded-lg border border-transparent bg-surface-hover px-3 py-2 font-mono text-default text-sm focus:border-primary focus:outline-none"
                                        id={`${configFieldId}-${f.key}`}
                                        onChange={(e) => setField(f.key, e.target.value)}
                                        spellCheck={false}
                                        type={
                                            f.sensitive && !revealed.has(f.key)
                                                ? "password"
                                                : "text"
                                        }
                                        value={f.value}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button disabled={saving} onClick={onClose} size="sm" variant="ghost">
                            Cancel
                        </Button>
                        <Button disabled={saving} onClick={handleSave} size="sm" variant="primary">
                            {saving ? "Saving…" : "Save & redeploy"}
                        </Button>
                    </div>
                </div>
            ) : (
                // Unreachable in practice - the detail page only renders its "Edit
                // config" button when decodeAddonConfig succeeds (opaque configs are
                // served by the page's existing external Configure action instead).
                // Kept as a plain close-out rather than dead fallback UI.
                <div className="flex justify-end">
                    <Button onClick={onClose} size="sm" variant="ghost">
                        Close
                    </Button>
                </div>
            )}
        </Modal>
    );
}
