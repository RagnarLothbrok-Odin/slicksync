"use client";

import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import type { SmartCatalogRule, SmartCatalogSort } from "@/lib/api";

type Draft = Partial<SmartCatalogRule>;

const splitList = (text: string) =>
    text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
const numOrNull = (text: string) => (text.trim() ? Number(text) : null);

const SORTS: Array<{ value: SmartCatalogSort | ""; label: string }> = [
    { label: "Best rated", value: "" },
    { label: "Most popular", value: "popular" },
    { label: "Trending", value: "trending" },
    { label: "Most voted", value: "votes" },
    { label: "Newest", value: "newest" },
    { label: "Oldest", value: "oldest" },
];

const VOTE_FLOORS = [
    { label: "Any", value: "" },
    { label: "1,000+ votes", value: "1000" },
    { label: "10,000+ votes", value: "10000" },
    { label: "100,000+ votes", value: "100000" },
];

const field = "input-base w-full px-3 py-2 text-sm";
const Label = ({ children }: { children: React.ReactNode }) => (
    <label className="mb-1 block font-medium text-muted text-xs">{children}</label>
);

/**
 * The Smart rule editor's fields. People and the basics show straight away;
 * the rest sit under "More rules", opened by itself when a saved rule
 * already uses one of them.
 */
export function SmartRuleForm({
    draft,
    setDraft,
    lumiereReady,
}: {
    draft: Draft;
    setDraft: (update: (d: Draft) => Draft) => void;
    lumiereReady: boolean;
}) {
    const usesMore = !!(
        draft.excludeGenres?.length ||
        draft.sort ||
        draft.minVotes ||
        draft.minRuntimeMinutes ||
        draft.maxRuntimeMinutes ||
        draft.seriesStatus ||
        draft.lastAiredFrom
    );
    const [more, setMore] = useState(usesMore);
    const series = draft.type === "series";

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <Label>Type</Label>
                    <select
                        className={field}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                type: (e.target.value || null) as "movie" | "series" | null,
                            }))
                        }
                        value={draft.type || ""}
                    >
                        <option value="">Movies and series</option>
                        <option value="movie">Movies only</option>
                        <option value="series">Series only</option>
                    </select>
                </div>
                <div>
                    <Label>
                        Genres <span className="text-subtle">(comma separated)</span>
                    </Label>
                    <input
                        className={field}
                        defaultValue={(draft.genres || []).join(", ")}
                        onBlur={(e) =>
                            setDraft((d) => ({ ...d, genres: splitList(e.target.value) }))
                        }
                        placeholder="Horror, Thriller"
                        type="text"
                    />
                </div>
                <div>
                    <Label>From year</Label>
                    <input
                        className={field}
                        defaultValue={draft.yearFrom ?? ""}
                        onBlur={(e) =>
                            setDraft((d) => ({ ...d, yearFrom: numOrNull(e.target.value) }))
                        }
                        type="number"
                    />
                </div>
                <div>
                    <Label>To year</Label>
                    <input
                        className={field}
                        defaultValue={draft.yearTo ?? ""}
                        onBlur={(e) =>
                            setDraft((d) => ({ ...d, yearTo: numOrNull(e.target.value) }))
                        }
                        type="number"
                    />
                </div>
                <div>
                    <Label>
                        Minimum rating
                        {lumiereReady ? <span className="text-subtle"> (IMDb)</span> : null}
                    </Label>
                    <input
                        className={field}
                        defaultValue={draft.minRating ?? ""}
                        max="10"
                        min="0"
                        onBlur={(e) =>
                            setDraft((d) => ({ ...d, minRating: numOrNull(e.target.value) }))
                        }
                        step="0.5"
                        type="number"
                    />
                </div>
                <div>
                    <Label>How many titles</Label>
                    <input
                        className={field}
                        defaultValue={draft.limit ?? 40}
                        max="100"
                        min="5"
                        onBlur={(e) =>
                            setDraft((d) => ({ ...d, limit: Number(e.target.value) || 40 }))
                        }
                        type="number"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                    <Label>
                        Actors <span className="text-subtle">(full names)</span>
                    </Label>
                    <input
                        className={field}
                        defaultValue={(draft.cast || []).join(", ")}
                        onBlur={(e) => setDraft((d) => ({ ...d, cast: splitList(e.target.value) }))}
                        placeholder="Al Pacino, Robert De Niro"
                        type="text"
                    />
                    {(draft.cast?.length || 0) > 1 && (
                        <div
                            aria-label="Which actors must be in it"
                            className="mt-1.5 flex gap-1.5"
                            role="group"
                        >
                            {(["all", "any"] as const).map((m) => (
                                <button
                                    className={`rounded-lg px-2.5 py-1 font-medium text-xs transition-colors ${
                                        (draft.castMatch || "all") === m
                                            ? "bg-primary text-white"
                                            : "nav-item-hover-pill bg-surface-hover text-muted"
                                    }`}
                                    key={m}
                                    onClick={() => setDraft((d) => ({ ...d, castMatch: m }))}
                                    type="button"
                                >
                                    {m === "all" ? "All of them in it" : "Any of them"}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="col-span-2 sm:col-span-1">
                    <Label>
                        Directors <span className="text-subtle">(full names)</span>
                    </Label>
                    <input
                        className={field}
                        defaultValue={(draft.directors || []).join(", ")}
                        onBlur={(e) =>
                            setDraft((d) => ({ ...d, directors: splitList(e.target.value) }))
                        }
                        placeholder="Christopher Nolan"
                        type="text"
                    />
                </div>
            </div>

            <div>
                <button
                    aria-expanded={more}
                    className="inline-flex items-center gap-1 font-medium text-muted text-xs transition-colors hover:text-default"
                    onClick={() => setMore((v) => !v)}
                    type="button"
                >
                    <ChevronDownIcon
                        className={`h-3.5 w-3.5 transition-transform ${more ? "rotate-180" : ""}`}
                    />
                    More rules
                </button>
                {more && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                            <Label>Not these genres</Label>
                            <input
                                className={field}
                                defaultValue={(draft.excludeGenres || []).join(", ")}
                                onBlur={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        excludeGenres: splitList(e.target.value),
                                    }))
                                }
                                placeholder="Romance"
                                type="text"
                            />
                        </div>
                        <div>
                            <Label>Order</Label>
                            <select
                                className={field}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        sort: (e.target.value || null) as SmartCatalogSort | null,
                                    }))
                                }
                                value={draft.sort || ""}
                            >
                                {SORTS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                        {o.value === "trending" && !lumiereReady
                                            ? " (needs LumiereDB)"
                                            : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <Label>Leave out little-known titles</Label>
                            <select
                                className={field}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        minVotes: e.target.value ? Number(e.target.value) : null,
                                    }))
                                }
                                value={draft.minVotes ? String(draft.minVotes) : ""}
                            >
                                {VOTE_FLOORS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <Label>
                                Runtime <span className="text-subtle">(minutes)</span>
                            </Label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    aria-label="Shortest runtime"
                                    className={field}
                                    defaultValue={draft.minRuntimeMinutes ?? ""}
                                    min="1"
                                    onBlur={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            minRuntimeMinutes: numOrNull(e.target.value),
                                        }))
                                    }
                                    placeholder="from"
                                    type="number"
                                />
                                <input
                                    aria-label="Longest runtime"
                                    className={field}
                                    defaultValue={draft.maxRuntimeMinutes ?? ""}
                                    min="1"
                                    onBlur={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            maxRuntimeMinutes: numOrNull(e.target.value),
                                        }))
                                    }
                                    placeholder="to"
                                    type="number"
                                />
                            </div>
                        </div>
                        {series && (
                            <>
                                <div>
                                    <Label>Series that are</Label>
                                    <select
                                        className={field}
                                        onChange={(e) =>
                                            setDraft((d) => ({
                                                ...d,
                                                seriesStatus: (e.target.value || null) as
                                                    | "airing"
                                                    | "ended"
                                                    | null,
                                            }))
                                        }
                                        value={draft.seriesStatus || ""}
                                    >
                                        <option value="">Airing or ended</option>
                                        <option value="airing">Still airing</option>
                                        <option value="ended">Ended</option>
                                    </select>
                                </div>
                                <div>
                                    <Label>Last aired in or after</Label>
                                    <input
                                        className={field}
                                        defaultValue={draft.lastAiredFrom ?? ""}
                                        onBlur={(e) =>
                                            setDraft((d) => ({
                                                ...d,
                                                lastAiredFrom: numOrNull(e.target.value),
                                            }))
                                        }
                                        placeholder="2020"
                                        type="number"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
