"use client";

import {
    CheckIcon,
    ClipboardDocumentIcon,
    DevicePhoneMobileIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";
import { Card } from "@/components/ui";
import { toast } from "@/components/ui/Toast";

// iOS Shortcuts recipes with this instance's own address and key filled in.
//
// Apple does not let a web app register as a share target, so on an iPhone
// the way to hand SlickSync a link, or to ask it what you were watching,
// is a Shortcut. Every one of these is three or four actions; what people
// get wrong is the URL and the header, so those are the copyable parts.
// Nothing here is iOS-specific - the same calls work from Tasker, Home
// Assistant or a shell script - Shortcuts is just what everyone has.

interface Recipe {
    copy: Array<{ label: string; value: string; secret?: boolean }>;
    does: string;
    steps: string[];
    title: string;
}

function buildRecipes(base: string, authHeader: string): Recipe[] {
    return [
        {
            copy: [{ label: "Address", value: `${base}/discover?st_text=` }],
            does: "From any app’s share sheet, a link or a title opens Discover already searched – an IMDb link resolves straight to the title.",
            steps: [
                'New Shortcut → Details → turn on "Show in Share Sheet", accept URLs and Text.',
                'Add "URL Encode" with Shortcut Input.',
                'Add "Open URLs" with the address below, then paste the encoded text right after the "=".',
            ],
            title: "Send to SlickSync",
        },
        {
            copy: [
                { label: "Address", value: `${base}/api/ext/continue-watching?limit=5` },
                { label: "Authorization header", secret: true, value: authHeader },
            ],
            does: "Reads the next episode of everything in progress and opens the one you pick straight in Stremio or Nuvio. Works as a Siri phrase or a Home Screen button.",
            steps: [
                'Add "Get Contents of URL" with the address below, Method GET, and a header named Authorization set to the value below.',
                'Add "Get Dictionary Value" for the key "items", then "Choose from List".',
                'Add "Get Dictionary Value" for the key "appUrl", then "Open URLs".',
            ],
            title: "What was I watching",
        },
        {
            copy: [
                { label: "Address", value: `${base}/api/ext/groups/sync` },
                { label: "Authorization header", secret: true, value: authHeader },
            ],
            does: "Syncs the whole household in one tap, or on a schedule as a Personal Automation – when you get home, at bedtime, whenever.",
            steps: [
                'Add "Get Contents of URL" with the address below, Method POST, and the Authorization header.',
                "Put the Shortcut on the Home Screen, or attach it to an Automation.",
            ],
            title: "Sync everything",
        },
    ];
}

export function ShortcutRecipes({
    baseUrl,
    apiKey,
}: {
    baseUrl?: string | null;
    apiKey: string | null;
}) {
    const [copied, setCopied] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const base = (baseUrl?.trim() ? baseUrl.trim() : origin).replace(/\/$/, "");
    const authHeader = apiKey ? `Bearer ${apiKey}` : "Bearer <your API key>";
    const recipes = buildRecipes(base, authHeader);

    const copy = async (key: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(key);
            toast.success("Copied");
            setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
        } catch {
            toast.error("Could not copy – select it and copy by hand");
        }
    };

    return (
        <Card padding="lg">
            <div className="mb-4 flex items-start gap-3">
                <div className="shrink-0 rounded-lg bg-primary-muted p-2">
                    <DevicePhoneMobileIcon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                    <h3 className="font-display font-semibold text-base text-default">
                        iOS Shortcuts
                    </h3>
                    <p className="text-muted text-xs">
                        Apple doesn’t let a web app appear in the share sheet, so on an iPhone these
                        three Shortcuts are how you hand SlickSync a link or ask it what you were
                        watching. Your own address and key are already filled in – copy, paste,
                        done.
                    </p>
                </div>
            </div>

            <div className="space-y-2">
                {recipes.map((r) => {
                    const isOpen = open === r.title;
                    return (
                        <div
                            className="rounded-xl border border-default bg-surface-hover"
                            key={r.title}
                        >
                            <button
                                aria-expanded={isOpen}
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                                onClick={() => setOpen(isOpen ? null : r.title)}
                                type="button"
                            >
                                <div className="min-w-0">
                                    <p className="font-medium text-default text-sm">{r.title}</p>
                                    <p className="text-muted text-xs">{r.does}</p>
                                </div>
                                <span className="shrink-0 text-subtle text-xs">
                                    {isOpen ? "Hide" : "Show steps"}
                                </span>
                            </button>
                            {isOpen && (
                                <div className="space-y-3 px-4 pb-4">
                                    <ol className="list-decimal space-y-1 pl-5 text-default text-xs">
                                        {r.steps.map((s, i) => (
                                            <li key={i}>{s}</li>
                                        ))}
                                    </ol>
                                    <div className="space-y-2">
                                        {r.copy.map((c) => {
                                            const key = `${r.title}:${c.label}`;
                                            const shown =
                                                c.secret && apiKey
                                                    ? `Bearer ${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`
                                                    : c.value;
                                            return (
                                                <div className="flex items-center gap-2" key={key}>
                                                    <span className="w-40 shrink-0 text-[11px] text-muted uppercase tracking-wider">
                                                        {c.label}
                                                    </span>
                                                    <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-2 py-1.5 text-default text-xs">
                                                        {shown}
                                                    </code>
                                                    <button
                                                        aria-label={`Copy ${c.label.toLowerCase()}`}
                                                        className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-default"
                                                        onClick={() => copy(key, c.value)}
                                                        title={`Copy ${c.label.toLowerCase()}`}
                                                        type="button"
                                                    >
                                                        {copied === key ? (
                                                            <CheckIcon className="h-4 w-4 text-success" />
                                                        ) : (
                                                            <ClipboardDocumentIcon className="h-4 w-4" />
                                                        )}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {r.copy.some((c) => c.secret) && !apiKey && (
                                        <p className="text-warning text-xs">
                                            Generate an API key above first – the header needs it.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <p className="mt-3 text-subtle text-xs">
                The sync one changes real state – anyone holding that key can sync your household,
                so treat it like a password. Full walkthrough in{" "}
                <a className="text-primary hover:underline" href="/guides/ios-shortcuts">
                    Guides → iOS Shortcuts
                </a>
                .
            </p>
        </Card>
    );
}
