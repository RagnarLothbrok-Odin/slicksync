"use client";

import { ClipboardDocumentIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { copyToClipboard } from "@/lib/clipboard";

// Two-phase share flow, used by every share-code producer (catalogs, Nuvio
// collections, addon templates). Phase one states exactly WHAT the code
// will contain and requires an explicit "Generate code" click - a share is
// never one accidental tap, and never a bare toggle whose effect you have
// to guess (that ambiguity was called out on the older catalog share
// toggle specifically). Phase two shows the code with a copy button.
//
// `warning` renders as a loud callout - addon templates MUST pass one,
// since manifest URLs can embed debrid/API keys and sharing the code
// shares those keys.
interface ShareCodeDialogProps {
    /** Extra controls rendered between the summary and the warning - e.g. the
     * addon template dialog's "Strip API keys" checkbox. Optional; most share
     * kinds (catalogs, Nuvio collections) have nothing to put here. */
    extraContent?: React.ReactNode;
    /** Called on the explicit confirm; returns the code (may fetch). */
    generate: () => Promise<string> | string;
    isOpen: boolean;
    onClose: () => void;
    /** Plain statement of what the code will contain, e.g. "the catalog
     * \"Halloween\" and its 42 titles". */
    summary: string;
    title: string;
    warning?: string;
}

// Above this, a QR encoding the whole code stops being reliably scannable
// off a screen - the format's own hard ceiling is ~2900 bytes, but density
// makes it unreadable by a phone camera well before that. Measured against
// real payloads: an addon template runs ~750 chars (fine), a 5-title catalog
// ~1600, and a 42-title catalog ~12600 (nowhere close). So the QR is offered
// only when it will actually work, rather than rendering a dense square that
// silently fails to scan.
const QR_MAX_CODE_LENGTH = 1200;

export function ShareCodeDialog({
    isOpen,
    onClose,
    title,
    summary,
    warning,
    extraContent,
    generate,
}: ShareCodeDialogProps) {
    const [showQr, setShowQr] = useState(false);
    const [code, setCode] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            setCode(await generate());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to generate the code");
        } finally {
            setGenerating(false);
        }
    };

    const handleCopy = async () => {
        if (!code) {
            return;
        }
        try {
            await copyToClipboard(code);
            toast.success("Code copied");
        } catch {
            toast.error("Could not copy - select the text and copy manually");
        }
    };

    const handleClose = () => {
        setCode(null);
        setShowQr(false);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} size="md" title={title}>
            <div className="space-y-4">
                {code ? (
                    <>
                        <textarea
                            className="w-full resize-none rounded-lg border border-transparent px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
                            onFocus={(e) => e.currentTarget.select()}
                            readOnly
                            rows={5}
                            style={{
                                background: "var(--color-surface-hover)",
                                color: "var(--color-text)",
                            }}
                            value={code}
                        />
                        {showQr && (
                            <div className="flex flex-col items-center gap-2 py-1">
                                {/* Same /api/qr endpoint TV mode's OAuth linking already
                    uses. Point a phone camera at it to carry the code to
                    another device without typing or a clipboard hop. */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    alt="QR code containing this share code"
                                    className="rounded-lg bg-white p-2"
                                    height={200}
                                    src={`/api/qr?data=${encodeURIComponent(code)}`}
                                    width={200}
                                />
                                <p className="text-muted text-xs">
                                    Scan to carry this code to another device
                                </p>
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <Button onClick={handleClose} size="sm" variant="ghost">
                                Done
                            </Button>
                            {code.length <= QR_MAX_CODE_LENGTH && (
                                <Button
                                    onClick={() => setShowQr((v) => !v)}
                                    size="sm"
                                    variant="ghost"
                                >
                                    {showQr ? "Hide QR" : "Show QR"}
                                </Button>
                            )}
                            <Button
                                leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                                onClick={handleCopy}
                                size="sm"
                                variant="primary"
                            >
                                Copy code
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-muted text-sm">
                            This will produce a copy-paste code containing{" "}
                            <span className="font-medium text-default">{summary}</span>. Anyone you
                            give the code to can import it into their own SlickSync.
                        </p>
                        {extraContent}
                        {warning && (
                            <div
                                className="flex items-start gap-2.5 rounded-xl p-3"
                                style={{
                                    background:
                                        "color-mix(in srgb, var(--color-warning) 12%, transparent)",
                                    border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
                                }}
                            >
                                <ExclamationTriangleIcon
                                    className="mt-0.5 h-5 w-5 shrink-0"
                                    style={{ color: "var(--color-warning)" }}
                                />
                                <p
                                    className="text-xs leading-relaxed"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    {warning}
                                </p>
                            </div>
                        )}
                        <div className="flex justify-end gap-2 pt-1">
                            <Button onClick={handleClose} size="sm" variant="ghost">
                                Cancel
                            </Button>
                            <Button
                                disabled={generating}
                                onClick={handleGenerate}
                                size="sm"
                                variant="primary"
                            >
                                {generating ? "Generating…" : "Generate code"}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

// Companion paste box for the import side - one textarea, one validate-on-
// submit callback. The caller owns what "import" means (stage vs create).
interface PasteCodeDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Throws (or returns a rejected promise) with a user-showable message
     * when the pasted text isn't acceptable. Closing happens on success. */
    onImport: (text: string) => Promise<void> | void;
    placeholder?: string;
    title: string;
}

export function PasteCodeDialog({
    isOpen,
    onClose,
    title,
    placeholder,
    onImport,
}: PasteCodeDialogProps) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);

    const handleClose = () => {
        setText("");
        onClose();
    };

    const handleImport = async () => {
        if (!text.trim()) {
            return;
        }
        setBusy(true);
        try {
            await onImport(text.trim());
            handleClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "That code isn't valid");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} size="md" title={title}>
            <div className="space-y-4">
                <textarea
                    className="w-full resize-none rounded-lg border border-transparent px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
                    onChange={(e) => setText(e.target.value)}
                    placeholder={placeholder || "Paste a share code…"}
                    rows={5}
                    spellCheck={false}
                    style={{ background: "var(--color-surface-hover)", color: "var(--color-text)" }}
                    value={text}
                />
                <div className="flex justify-end gap-2">
                    <Button disabled={busy} onClick={handleClose} size="sm" variant="ghost">
                        Cancel
                    </Button>
                    <Button
                        disabled={busy || !text.trim()}
                        onClick={handleImport}
                        size="sm"
                        variant="primary"
                    >
                        {busy ? "Importing…" : "Import"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
