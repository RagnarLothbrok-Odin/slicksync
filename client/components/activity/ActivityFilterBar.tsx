"use client";

import {
    CalendarDaysIcon,
    ChevronDownIcon,
    FilmIcon,
    LinkIcon,
    ServerStackIcon,
    UserCircleIcon,
    UserIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { type ComponentType, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { copyToClipboard } from "@/lib/clipboard";

/** Everything the Activity feed can be narrowed by. '' means "any". */
export interface ActivityFilters {
    from: string;
    kind: string;
    person: string;
    profile: string;
    source: string;
    status: string;
    to: string;
    when: string;
}

export const EMPTY_FILTERS: ActivityFilters = {
    from: "",
    kind: "",
    person: "",
    profile: "",
    source: "",
    status: "",
    to: "",
    when: "",
};

const KEYS = Object.keys(EMPTY_FILTERS) as (keyof ActivityFilters)[];

/** Labels a viewing can carry that say where it came from rather than which Nuvio profile. */
export const SOURCE_LABELS: Record<string, string> = {
    AIOStreams: "aiostreams",
    Imported: "imported",
    Scrobbled: "scrobbled",
};

export const SOURCE_NAMES: Record<string, string> = {
    aiometadata: "AIOMetadata",
    aiostreams: "AIOStreams",
    imported: "Imported",
    jellyfin: "Jellyfin",
    nuvio: "Nuvio",
    scrobbled: "Scrobbled",
    stremio: "Stremio",
};

/** The order the "Watched on" filter lists apps in. */
export const SOURCE_ORDER = [
    "stremio",
    "nuvio",
    "jellyfin",
    "aiostreams",
    "aiometadata",
    "imported",
    "scrobbled",
];

/**
 * Where one viewing came from: a special label first, otherwise the person's
 * app. Someone on a Jellyfin-compatible server is placed by the kind of
 * server (the page passes 'aiostreams' or 'aiometadata' for those), so
 * AIOStreams' apps are one entry whichever way their viewing arrived.
 */
export function sourceOf(profileLabel: string | undefined, provider: string | undefined) {
    if (profileLabel && SOURCE_LABELS[profileLabel]) {
        return SOURCE_LABELS[profileLabel];
    }
    return provider && SOURCE_NAMES[provider] ? provider : "stremio";
}

/** A profile shown with the app it belongs to: "Kids · Nuvio". */
export function profileOptionLabel(profile: string, app?: string) {
    return app && SOURCE_NAMES[app] ? `${profile} · ${SOURCE_NAMES[app]}` : profile;
}

export function hasAnyFilter(f: ActivityFilters) {
    return KEYS.some((k) => !!f[k]);
}

/** Filters named in the address, so a filtered feed can be shared as a link. */
export function filtersFromParams(params: URLSearchParams): ActivityFilters | null {
    const out = { ...EMPTY_FILTERS };
    let any = false;
    for (const k of KEYS) {
        const v = params.get(k);
        if (v) {
            out[k] = v;
            any = true;
        }
    }
    // The dashboard's stat cards link here with ?period=today|week.
    const period = params.get("period");
    if (!out.when && (period === "today" || period === "week")) {
        out.when = period;
        any = true;
    }
    return any ? out : null;
}

export function filtersToParams(f: ActivityFilters, current: URLSearchParams) {
    const next = new URLSearchParams(current.toString());
    next.delete("period");
    for (const k of KEYS) {
        if (f[k] && ((k !== "from" && k !== "to") || f.when === "custom")) {
            next.set(k, f[k]);
        } else {
            next.delete(k);
        }
    }
    return next;
}

interface Option {
    label: string;
    value: string;
}

function Pill({
    icon: Icon,
    label,
    value,
    options,
    onChange,
}: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
}) {
    const active = !!value;
    const shown = options.find((o) => o.value === value)?.label || options[0]?.label || label;
    // The real dropdown is stretched invisibly over the whole pill, so a tap
    // anywhere on it - icon, text or arrow - opens the list.
    return (
        <div
            className={`relative inline-flex items-center gap-1.5 rounded-full border py-1.5 pr-8 pl-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary/60 ${
                active
                    ? "border-primary/60 bg-primary/15 text-default"
                    : "border-default bg-surface text-muted hover:bg-surface-hover hover:text-default"
            }`}
        >
            <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`} />
            <span className="max-w-[11rem] truncate">{shown}</span>
            <ChevronDownIcon className="pointer-events-none absolute right-3 h-3.5 w-3.5" />
            <select
                aria-label={label}
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
                onChange={(e) => onChange(e.target.value)}
                value={value}
            >
                {options.map((o) => (
                    <option
                        key={o.value}
                        style={{
                            backgroundColor: "var(--color-surface)",
                            color: "var(--color-text)",
                        }}
                        value={o.value}
                    >
                        {o.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

/**
 * The Activity feed's filters: who, where it came from, which profile, what
 * kind, finished or not, and when. Each only offers what the feed actually
 * holds, and the page keeps them in the address so a view can be shared.
 */
export function ActivityFilterBar({
    value,
    onChange,
    people,
    sources,
    profiles,
    profileApps = {},
}: {
    value: ActivityFilters;
    onChange: (next: ActivityFilters) => void;
    people: Option[];
    sources: string[];
    profiles: string[];
    /** Which app each profile belongs to, so the list can say so. */
    profileApps?: Record<string, string>;
}) {
    const [copying, setCopying] = useState(false);
    const set = (patch: Partial<ActivityFilters>) => onChange({ ...value, ...patch });
    const today = new Date().toISOString().slice(0, 10);

    const copyLink = async () => {
        setCopying(true);
        const ok = await copyToClipboard(window.location.href);
        setCopying(false);
        if (ok) {
            toast.success("Link to this view copied");
        } else {
            toast.error("Copy failed - copy the address from the browser instead");
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                {people.length > 1 && (
                    <Pill
                        icon={UserIcon}
                        label="Person"
                        onChange={(person) => set({ person })}
                        options={[{ label: "Everyone", value: "" }, ...people]}
                        value={value.person}
                    />
                )}
                {sources.length > 1 && (
                    <Pill
                        icon={ServerStackIcon}
                        label="Watched on"
                        onChange={(source) => set({ source })}
                        options={[
                            { label: "Any app", value: "" },
                            ...sources.map((s) => ({ label: SOURCE_NAMES[s] || s, value: s })),
                        ]}
                        value={value.source}
                    />
                )}
                {profiles.length > 0 && (
                    <Pill
                        icon={UserCircleIcon}
                        label="Profile"
                        onChange={(profile) => set({ profile })}
                        options={[
                            { label: "Any profile", value: "" },
                            ...profiles.map((p) => ({
                                label: profileOptionLabel(p, profileApps[p]),
                                value: p,
                            })),
                        ]}
                        value={value.profile}
                    />
                )}
                <Pill
                    icon={FilmIcon}
                    label="Kind"
                    onChange={(kind) => set({ kind })}
                    options={[
                        { label: "Movies & shows", value: "" },
                        { label: "Movies", value: "movie" },
                        { label: "Shows", value: "series" },
                    ]}
                    value={value.kind}
                />
                <Pill
                    icon={CalendarDaysIcon}
                    label="When"
                    onChange={(when) =>
                        set(
                            when === "custom"
                                ? { from: value.from || today, to: value.to || today, when }
                                : { from: "", to: "", when }
                        )
                    }
                    options={[
                        { label: "Any time", value: "" },
                        { label: "Today", value: "today" },
                        { label: "Last 7 days", value: "week" },
                        { label: "Last 30 days", value: "month" },
                        { label: "This year", value: "year" },
                        { label: "Pick dates…", value: "custom" },
                    ]}
                    value={value.when}
                />

                {value.when === "custom" && (
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/60 bg-primary/15 px-3 py-1 text-sm">
                        <input
                            aria-label="From"
                            className="bg-transparent text-default focus:outline-none"
                            max={value.to || undefined}
                            onChange={(e) => set({ from: e.target.value })}
                            type="date"
                            value={value.from}
                        />
                        <span className="text-muted">to</span>
                        <input
                            aria-label="To"
                            className="bg-transparent text-default focus:outline-none"
                            min={value.from || undefined}
                            onChange={(e) => set({ to: e.target.value })}
                            type="date"
                            value={value.to}
                        />
                    </div>
                )}

                {hasAnyFilter(value) && (
                    <div className="flex items-center gap-1">
                        <button
                            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-muted text-sm transition-colors hover:bg-surface-hover hover:text-default"
                            onClick={() => onChange(EMPTY_FILTERS)}
                            type="button"
                        >
                            <XMarkIcon className="h-4 w-4" /> Clear
                        </button>
                        <button
                            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-muted text-sm transition-colors hover:bg-surface-hover hover:text-default"
                            disabled={copying}
                            onClick={copyLink}
                            title="Copy a link to this view"
                            type="button"
                        >
                            <LinkIcon className="h-4 w-4" /> Copy link
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
