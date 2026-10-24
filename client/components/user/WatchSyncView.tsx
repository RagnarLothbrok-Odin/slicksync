"use client";

// AIOSync (server/utils/watchCopy): watched titles and resume
// points from any sign-in or profile - this person's or anyone else's - to
// another. COPY FROM and COPY TO are two big boxes in their own colours with
// the direction arrow between them; tapping a box opens a picker anchored to
// it. The preview is every title as poster cards with what each side has;
// the four numbers are filters. Nothing is removed, nothing goes backwards,
// and a copy can be undone from here for 7 days.

import {
    ArrowDownIcon,
    ArrowLeftIcon,
    ArrowRightIcon,
    ArrowsRightLeftIcon,
    ArrowsUpDownIcon,
    ArrowUturnLeftIcon,
    CheckIcon,
    ChevronDownIcon,
    MagnifyingGlassIcon,
    ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui";
import { SelectionCheckbox } from "@/components/ui/SelectionCheckbox";
import { toast } from "@/components/ui/Toast";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { KeepInStepCard } from "@/components/user/KeepInStepCard";
import {
    api,
    type WatchCopyHas,
    type WatchCopyItem,
    type WatchCopyOutcome,
    type WatchCopyPerson,
    type WatchCopyPreview,
    type WatchCopyRun,
    type WatchCopySide,
} from "@/lib/api";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { useLayoutMode } from "@/lib/layout-mode";
import { cachedImageUrl } from "@/lib/posterUrl";

const FROM_C = "#2dd4bf";
const TO_C = "var(--color-primary)";
const AMBER = "#f5a524";
const PAGE = 120;
// The Will copy group opens on a peek of its first titles; the rest are one tap away.
const COPY_PEEK = 18;

// The poster grid, grouped by what will happen, in this order. The two that
// need nothing from you start folded.
const GROUPS: {
    key: WatchCopyOutcome;
    title: string;
    color: string;
    sub: string;
    folded?: boolean;
}[] = [
    { color: "var(--color-success)", key: "copy", sub: "", title: "Will copy" },
    {
        color: "var(--color-primary)",
        key: "match",
        sub: "We couldn’t tell which title these are. Pick one to include it.",
        title: "Pick the match",
    },
    {
        color: AMBER,
        key: "further",
        sub: "Further along there already, so these are left alone",
        title: "Kept as it is",
    },
    {
        color: "var(--color-text-muted)",
        folded: true,
        key: "there",
        sub: "Nothing to do for these",
        title: "Already there",
    },
    {
        color: "var(--color-text-muted)",
        folded: true,
        key: "missing",
        sub: "",
        title: "Not on that server",
    },
];

const PROVIDER_LOOK: Record<string, { letter: string; bg: string }> = {
    aiometadata: { bg: "linear-gradient(135deg,#14b8a6,#0e7490)", letter: "A" },
    aiostreams: { bg: "linear-gradient(135deg,#9f92ff,#5b4fd6)", letter: "A" },
    jellyfin: { bg: "linear-gradient(135deg,#aa5cc3,#00a4dc)", letter: "J" },
    nuvio: { bg: "linear-gradient(135deg,#38599e,#ff9800)", letter: "N" },
    stremio: { bg: "linear-gradient(135deg,#8a5cf6,#5b3fd6)", letter: "S" },
};

const PROVIDER_PILL: Record<string, { bg: string; fg: string }> = {
    aiometadata: { bg: "rgba(45,212,191,0.14)", fg: "rgb(153,246,228)" },
    aiostreams: { bg: "rgba(159,146,255,0.16)", fg: "rgb(212,208,255)" },
    jellyfin: { bg: "rgba(0,164,220,.18)", fg: "rgb(160,215,240)" },
    nuvio: { bg: "rgba(56,89,158,.3)", fg: "rgb(186,208,240)" },
    stremio: { bg: "rgba(123,91,245,0.18)", fg: "rgb(196,181,253)" },
};

const SINCE = [
    { days: 0, label: "all time" },
    { days: 7, label: "the last week" },
    { days: 30, label: "the last month" },
    { days: 90, label: "the last 3 months" },
    { days: 365, label: "the last year" },
];

function Logo({ kind, size = 40 }: { kind: string; size?: number }) {
    const look = PROVIDER_LOOK[kind] || PROVIDER_LOOK.jellyfin;
    return (
        <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center font-bold text-white"
            style={{
                background: look.bg,
                borderRadius: size * 0.3,
                fontSize: size * 0.42,
                height: size,
                width: size,
            }}
        >
            {look.letter}
        </span>
    );
}

type Profile = WatchCopySide["profiles"][number];
interface Choice {
    side: string;
    sideInfo: WatchCopySide;
    profileName: string | null;
    profile: Profile | null;
}

function choiceFor(sides: WatchCopySide[], side: string): Choice | null {
    for (const s of sides) {
        if (s.side === side && !s.profiles.length) {
            return { profile: null, profileName: null, side, sideInfo: s };
        }
        const p = s.profiles.find((x) => x.side === side);
        if (p) {
            return { profile: p, profileName: p.name, side, sideInfo: s };
        }
    }
    return null;
}

const choiceLabel = (c: Choice | null) =>
    c
        ? `${c.sideInfo.person ? `${c.sideInfo.person.username}’s ` : ""}${c.sideInfo.name}${c.profileName ? ` · ${c.profileName}` : ""}`
        : "";

// A profile's picture: Nuvio's avatar or the household member's own on the
// server; the sign-in's own user is the person (their picture as everywhere
// else); otherwise the profile's colour with its initial.
function ProfilePic({
    profile,
    person,
    kind,
    size,
}: {
    profile: Profile | null;
    person: WatchCopyPerson | null;
    kind: string;
    size: number;
}) {
    if (profile?.avatar) {
        // eslint-disable-next-line @next/next/no-img-element
        return (
            <img
                alt=""
                className="shrink-0 rounded-full object-cover"
                src={profile.avatar}
                style={{ background: profile.color || undefined, height: size, width: size }}
            />
        );
    }
    if ((!profile || profile.isPerson) && person) {
        return (
            <span
                className="inline-flex shrink-0 overflow-hidden rounded-full"
                style={{ height: size, width: size }}
            >
                <UserAvatar
                    className="!w-full !h-full"
                    colorIndex={person.colorIndex}
                    email={person.email || undefined}
                    name={person.username}
                    size="xs"
                    src={person.avatarUrl || undefined}
                    useGravatar={person.useGravatar}
                    userId={person.id}
                />
            </span>
        );
    }
    const name = profile?.name || "?";
    return (
        <span
            className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
            style={{
                background: profile?.color || PROVIDER_LOOK[kind]?.bg,
                fontSize: size * 0.45,
                height: size,
                width: size,
            }}
        >
            {name.slice(0, 1).toUpperCase()}
        </span>
    );
}

// Closes a popover on a tap outside it or Escape.
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                close();
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                close();
            }
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, ref, close]);
}

function SidePicker({
    sides,
    others,
    person,
    current,
    other,
    title,
    onPick,
}: {
    sides: WatchCopySide[];
    others: WatchCopySide[];
    person: WatchCopyPerson | null;
    current: string;
    other: string;
    title: string;
    onPick: (side: string) => void;
}) {
    const [search, setSearch] = useState("");
    const q = search.trim().toLowerCase();
    const shownOthers = others.filter(
        (o) =>
            !q ||
            (o.person?.username || "").toLowerCase().includes(q) ||
            o.name.toLowerCase().includes(q)
    );
    const row = (side: string, label: string, kind: string, profile?: Profile) => {
        const disabled = side === other;
        const active = side === current;
        return (
            <button
                className="flex w-full items-center gap-2.5 rounded-xl border px-2 py-1.5 text-left transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                disabled={disabled}
                key={side}
                onClick={() => onPick(side)}
                style={{
                    background: active
                        ? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
                        : undefined,
                    borderColor: active ? "var(--color-primary)" : "transparent",
                }}
                type="button"
            >
                {profile ? (
                    <ProfilePic kind={kind} person={person} profile={profile} size={26} />
                ) : (
                    <Logo kind={kind} size={26} />
                )}
                <span className="flex-1 truncate text-default text-sm">{label}</span>
                {disabled && (
                    <span className="text-subtle text-xs">
                        {title === "Copy to…" ? "copying from" : "copying to"}
                    </span>
                )}
                {active && <CheckIcon className="h-4 w-4 text-primary" />}
            </button>
        );
    };
    return (
        <div
            className="absolute right-0 left-0 z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-default p-3 shadow-2xl sm:right-auto sm:w-[22rem]"
            style={{ background: "var(--color-surface)" }}
        >
            <div className="mb-1 font-semibold text-sm">{title}</div>
            {person && <div className="mt-2 mb-1 text-subtle text-xs">{person.username}</div>}
            {sides.map((s) => (
                <div key={s.provider}>
                    {s.profiles.length > 0 && (
                        <div className="mt-2.5 mb-1 text-subtle text-xs">
                            {s.name}
                            {s.provider === "nuvio"
                                ? " — each profile has its own history"
                                : s.kind === "jellyfin"
                                  ? ""
                                  : " — household"}
                        </div>
                    )}
                    {s.profiles.length
                        ? s.profiles.map((p) => row(p.side, p.name, s.kind, p))
                        : row(s.side, `${s.name}${s.detail ? ` · ${s.detail}` : ""}`, s.kind)}
                </div>
            ))}
            {others.length > 0 && (
                <>
                    <div className="mt-3 mb-1 text-subtle text-xs">Other people</div>
                    {others.length > 5 && (
                        <input
                            className="mb-1.5 w-full rounded-lg border border-default bg-transparent px-2.5 py-1.5 text-default text-sm outline-none placeholder:text-muted"
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search people"
                            value={search}
                        />
                    )}
                    {shownOthers.map((o) => {
                        const disabled = o.side === other;
                        const active = o.side === current;
                        const pill = PROVIDER_PILL[o.kind] || PROVIDER_PILL.jellyfin;
                        return (
                            <button
                                className="flex w-full items-center gap-2.5 rounded-xl border px-2 py-1.5 text-left transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={disabled}
                                key={o.side}
                                onClick={() => onPick(o.side)}
                                style={{
                                    background: active
                                        ? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
                                        : undefined,
                                    borderColor: active ? "var(--color-primary)" : "transparent",
                                }}
                                type="button"
                            >
                                <ProfilePic
                                    kind={o.kind}
                                    person={o.person || null}
                                    profile={null}
                                    size={26}
                                />
                                <span className="min-w-0 flex-1 truncate text-default text-sm">
                                    {o.person?.username}
                                </span>
                                {o.detail && (
                                    <span className="whitespace-nowrap text-subtle text-xs">
                                        {o.detail}
                                    </span>
                                )}
                                <span
                                    className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px]"
                                    style={{ background: pill.bg, color: pill.fg }}
                                >
                                    {o.name}
                                </span>
                                {active && <CheckIcon className="h-4 w-4 text-primary" />}
                            </button>
                        );
                    })}
                    {shownOthers.length === 0 && (
                        <div className="px-2 py-1.5 text-muted text-xs">Nobody by that name.</div>
                    )}
                    <div className="mt-2 text-subtle text-xs">
                        Copying between people only adds - the source&apos;s own history is never
                        changed.
                    </div>
                </>
            )}
        </div>
    );
}

function Slot({
    role,
    choice,
    count,
    sides,
    others,
    person,
    other,
    onPick,
    compact,
}: {
    role: "from" | "to";
    choice: Choice | null;
    count: number | null;
    sides: WatchCopySide[];
    others: WatchCopySide[];
    person: WatchCopyPerson | null;
    other: string;
    onPick: (side: string) => void;
    compact: boolean;
}) {
    const owner = choice?.sideInfo.person || person;
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const close = useCallback(() => setOpen(false), []);
    useDismiss(open, ref, close);
    const color = role === "from" ? FROM_C : TO_C;
    return (
        <div className="relative min-w-0" ref={ref}>
            <div
                className="mb-1.5 flex items-center gap-1.5 font-bold text-[11px] tracking-[0.08em]"
                style={{ color }}
            >
                {role === "from" ? "COPY FROM" : "COPY TO"}
            </div>
            <button
                aria-expanded={open}
                className={`flex w-full items-center gap-3 rounded-[18px] text-left ${choice ? "slot-on" : "slot-off"}`}
                onClick={() => setOpen((o) => !o)}
                style={
                    choice
                        ? ({ "--slot": color, padding: compact ? 12 : 16 } as React.CSSProperties)
                        : ({
                              "--slot": color,
                              justifyContent: "center",
                              minHeight: compact ? 72 : 88,
                              padding: compact ? 12 : 16,
                          } as React.CSSProperties)
                }
                type="button"
            >
                {choice ? <Logo kind={choice.sideInfo.kind} size={compact ? 40 : 48} /> : null}
                {!choice && (
                    <span
                        className="flex items-center gap-1.5 font-semibold text-default"
                        style={{ fontSize: compact ? 15 : 16 }}
                    >
                        Pick a sign-in
                        <ChevronDownIcon className="h-4 w-4 opacity-70" />
                    </span>
                )}
                {choice && (
                    <span className="min-w-0 flex-1">
                        <span
                            className="block font-semibold text-default"
                            style={{ fontSize: compact ? 15 : 16 }}
                        >
                            {choice?.sideInfo.name || "Pick a sign-in"}
                        </span>
                        <span className="block truncate text-muted text-xs">
                            {[
                                choice?.sideInfo.detail,
                                count === null ? null : `${count.toLocaleString()} titles`,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                        {choice && (choice.profileName || person) && (
                            <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-default bg-surface-hover py-0.5 pr-2 pl-0.5">
                                <ProfilePic
                                    kind={choice.sideInfo.kind}
                                    person={owner}
                                    profile={choice.profile}
                                    size={20}
                                />
                                <span className="truncate text-default text-xs">
                                    {choice.profileName
                                        ? `Profile: ${choice.profileName}`
                                        : owner?.username}
                                </span>
                                {choice.profileName && (
                                    <ChevronDownIcon className="h-3 w-3 opacity-60" />
                                )}
                            </span>
                        )}
                    </span>
                )}
                {choice && (
                    <span className="flex shrink-0 items-center gap-1 text-muted text-xs">
                        Change
                        <ChevronDownIcon className="h-3 w-3" />
                    </span>
                )}
            </button>
            {open && (
                <SidePicker
                    current={choice?.side || ""}
                    onPick={(s) => {
                        onPick(s);
                        setOpen(false);
                    }}
                    other={other}
                    others={others}
                    person={person}
                    sides={sides}
                    title={role === "from" ? "Copy from…" : "Copy to…"}
                />
            )}
        </div>
    );
}

function OtherChip({ side, onUse }: { side: WatchCopySide; onUse: (role: "from" | "to") => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const close = useCallback(() => setOpen(false), []);
    useDismiss(open, ref, close);
    return (
        <div className="relative" ref={ref}>
            <button
                className="inline-flex items-center gap-2 rounded-full border border-default border-dashed py-1.5 pr-3 pl-1.5"
                onClick={() => setOpen((o) => !o)}
                type="button"
            >
                <Logo kind={side.kind} size={24} />
                <span className="text-default text-xs">{side.name}</span>
            </button>
            {open && (
                <div
                    className="absolute left-0 z-30 mt-2 flex min-w-[9rem] flex-col rounded-xl border border-default p-1.5 shadow-2xl"
                    style={{ background: "var(--color-surface)" }}
                >
                    <button
                        className="rounded-lg px-3 py-1.5 text-left text-sm hover:bg-surface-hover"
                        onClick={() => {
                            onUse("from");
                            setOpen(false);
                        }}
                        style={{ color: FROM_C }}
                        type="button"
                    >
                        Use as From
                    </button>
                    <button
                        className="rounded-lg px-3 py-1.5 text-left text-primary text-sm hover:bg-surface-hover"
                        onClick={() => {
                            onUse("to");
                            setOpen(false);
                        }}
                        type="button"
                    >
                        Use as To
                    </button>
                </div>
            )}
        </div>
    );
}

function OptionChip({
    on,
    onClick,
    children,
    disabled,
}: {
    on: boolean;
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
}) {
    return (
        <button
            // The chosen look is a class, never inline - see .sync-chip-on in globals.css.
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-default text-xs disabled:opacity-40 ${on ? "sync-chip-on" : "sync-chip-off"}`}
            disabled={disabled}
            onClick={onClick}
            type="button"
        >
            {on && <CheckIcon className="h-3.5 w-3.5" />}
            {children}
        </button>
    );
}

function MatchPicker({
    userId,
    item,
    onPick,
    onClose,
}: {
    userId: string;
    item: WatchCopyItem;
    onPick: (id: string) => void;
    onClose: () => void;
}) {
    const [list, setList] = useState<
        { id: string; name: string; year: string | null; poster: string | null }[] | null
    >(null);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(true, ref, onClose);
    useEffect(() => {
        api.getWatchCopyCandidates(userId, item.name || "", item.type)
            .then((r) => setList(r.candidates))
            .catch(() => setList([]));
    }, [userId, item.name, item.type]);
    return (
        <div
            className="absolute top-[60%] left-0 z-30 w-72 rounded-2xl border border-default p-3 shadow-2xl"
            ref={ref}
            style={{ background: "var(--color-surface)" }}
        >
            <div className="mb-1 font-semibold text-sm">Which one did they watch?</div>
            {list === null && <div className="py-2 text-muted text-xs">Looking…</div>}
            {list?.length === 0 && (
                <div className="py-2 text-muted text-xs">
                    Nothing by that name — it stays out of the copy.
                </div>
            )}
            {list?.map((c) => (
                <button
                    className="mt-1.5 flex w-full items-center gap-2.5 rounded-xl border border-default bg-surface-hover p-2 text-left hover:border-primary"
                    key={c.id}
                    onClick={() => onPick(c.id)}
                    type="button"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.poster ? (
                        <img
                            alt=""
                            className="h-[45px] w-[30px] rounded-md object-cover"
                            src={c.poster}
                        />
                    ) : (
                        <span className="h-[45px] w-[30px] rounded-md bg-surface" />
                    )}
                    <span className="min-w-0">
                        <span className="block truncate font-semibold text-default text-sm">
                            {c.name}
                        </span>
                        <span className="block text-muted text-xs">{c.year || ""}</span>
                    </span>
                </button>
            ))}
            <div className="mt-2 text-subtle text-xs">The source only had a name for this one.</div>
        </div>
    );
}

// A side's picture showing what it has of one title: a tick when watched, a
// ring filled to the resume point when part-way, faded when not yet, dashed
// when there's no match to tell.
function StateAvatar({
    has,
    pic,
    size,
    unknown,
}: {
    has: WatchCopyHas;
    pic: (size: number) => React.ReactNode;
    size: number;
    unknown?: boolean;
}) {
    const state = unknown ? "unknown" : has.state || (has.none ? "none" : "watched");
    const badge = Math.max(12, Math.round(size * 0.55));
    if (state === "partial") {
        return (
            <span
                className="inline-flex shrink-0 items-center justify-center rounded-full"
                key={has.pct ?? 50}
                style={{
                    background: `conic-gradient(${FROM_C} ${has.pct ?? 50}%, rgba(255,255,255,.18) 0)`,
                    height: size + 6,
                    width: size + 6,
                }}
                title={has.text}
            >
                <span
                    className="inline-flex rounded-full"
                    style={{ boxShadow: "0 0 0 2px var(--color-background, #0b0d14)" }}
                >
                    {pic(size)}
                </span>
            </span>
        );
    }
    return (
        <span
            className={`relative inline-flex shrink-0 rounded-full ${state === "unknown" ? "state-unknown" : ""}`}
            style={
                state === "none"
                    ? { filter: "grayscale(1)", opacity: 0.38 }
                    : state === "unknown"
                      ? { opacity: 0.5 }
                      : undefined
            }
            title={unknown ? "No match yet" : has.text}
        >
            {pic(size)}
            {state === "watched" && (
                <span
                    className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full"
                    style={{
                        background: "#22c55e",
                        boxShadow: "0 0 0 2px var(--color-background, #0b0d14)",
                        color: "#04140a",
                        height: badge,
                        width: badge,
                    }}
                >
                    <CheckIcon
                        style={{ height: badge * 0.65, strokeWidth: 3.5, width: badge * 0.65 }}
                    />
                </span>
            )}
        </span>
    );
}

// Plain poster art, as on Discover - never the rating-printed RPDB kind.
function plainPoster(item: WatchCopyItem): string | undefined {
    if (item.poster) {
        return cachedImageUrl(item.poster, 342);
    }
    if (item.id && /^tt\d+$/.test(item.id)) {
        return cachedImageUrl(`https://images.metahub.space/poster/medium/${item.id}/img`, 342);
    }
    return undefined;
}

function Poster({
    item,
    selected,
    matched,
    onToggle,
    onMatch,
    fromPic,
    toPic,
}: {
    item: WatchCopyItem;
    selected: boolean;
    matched: boolean;
    onToggle: () => void;
    onMatch: () => void;
    fromPic: (size: number) => React.ReactNode;
    toPic: (size: number) => React.ReactNode;
}) {
    const [broken, setBroken] = useState(false);
    const src = broken ? undefined : plainPoster(item);
    const pickable = item.outcome === "copy" || matched;
    const faded = pickable ? !selected : true;
    const size = 20;
    const detail = matched
        ? "Matched"
        : item.outcome === "copy"
          ? item.detail
          : item.outcome === "further"
            ? `They’re at: ${item.to.text}`
            : null;
    return (
        <div className="min-w-0">
            <div
                className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-hover transition-opacity"
                style={{ opacity: faded ? 0.6 : 1 }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? (
                    <img
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                        onError={() => setBroken(true)}
                        src={src}
                    />
                ) : (
                    <span
                        className="absolute inset-0 flex items-end p-2 font-extrabold text-sm text-white uppercase leading-tight"
                        style={{ background: "linear-gradient(160deg,#2b2b2b,#555)" }}
                    >
                        {item.name}
                    </span>
                )}
                {pickable && (
                    <div className="absolute top-1.5 right-1.5">
                        <SelectionCheckbox checked={selected} onChange={onToggle} />
                    </div>
                )}
            </div>
            <div className="mt-1.5 truncate font-semibold text-[13px] text-default">
                {item.name || item.id}
            </div>
            {item.outcome === "match" && !matched ? (
                <button
                    className="mt-1.5 rounded-full px-2.5 py-1 font-semibold text-[11px]"
                    onClick={onMatch}
                    style={{
                        background: "color-mix(in srgb, var(--color-primary) 22%, transparent)",
                        color: "color-mix(in srgb, var(--color-primary) 45%, #ffffff)",
                    }}
                    type="button"
                >
                    Pick the match
                </button>
            ) : (
                <div className="mt-1.5 flex items-center gap-1.5">
                    <StateAvatar has={item.from} pic={fromPic} size={size} />
                    <span className="text-subtle text-xs">→</span>
                    <StateAvatar
                        has={matched ? { none: true, state: "none", text: "Not watched" } : item.to}
                        pic={toPic}
                        size={size}
                        unknown={item.outcome === "missing"}
                    />
                </div>
            )}
            {detail && (
                <div className="mt-1 truncate text-[11px] text-muted" title={detail}>
                    {detail}
                </div>
            )}
        </div>
    );
}

// One group of titles that share an outcome; the heading says it once.
function Group({
    color,
    title,
    count,
    sub,
    action,
    folded,
    onUnfold,
    children,
}: {
    color: string;
    title: string;
    count: number;
    sub: React.ReactNode;
    action?: React.ReactNode;
    folded?: boolean;
    onUnfold?: () => void;
    children?: React.ReactNode;
}) {
    const head = (
        <>
            <span className="w-1 shrink-0 self-stretch rounded" style={{ background: color }} />
            <span className="min-w-0 flex-1 text-left">
                <span className="block font-bold text-[17px] text-default">
                    {title}
                    <span className="ml-2 rounded-full bg-surface-hover px-2 py-px align-[2px] font-semibold text-[13px] text-muted">
                        {count.toLocaleString()}
                    </span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted text-xs sm:text-[13px]">
                    {sub}
                </span>
            </span>
        </>
    );
    if (folded) {
        return (
            <button
                className="mt-6 flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 hover:bg-surface-hover"
                onClick={onUnfold}
                type="button"
            >
                {head}
                <span
                    className="shrink-0 rounded-[10px] px-3 py-1.5 font-semibold text-[13px]"
                    style={{
                        background: "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                        color: "color-mix(in srgb, var(--color-primary) 45%, #ffffff)",
                    }}
                >
                    Show ›
                </span>
            </button>
        );
    }
    return (
        <div className="mt-6 first:mt-1">
            <div className="flex items-center gap-3">
                {head}
                {action}
            </div>
            {children}
        </div>
    );
}

// AIOSync for one person. Reached two ways: from their own page
// (home 'person', back goes to them) and from Tasks (home 'tasks', with the
// For switcher passed in as forSlot).
export function WatchSyncView({
    userId,
    home = "person",
    forSlot,
}: {
    userId: string;
    home?: "person" | "tasks";
    forSlot?: React.ReactNode;
}) {
    const router = useRouter();
    const search = useSearchParams();

    // Opens at the top. The app keeps its top bar between pages, so a link
    // followed from further down a page (Tasks, a person's page) otherwise
    // landed partway down this one.
    useEffect(() => {
        window.scrollTo({ behavior: "instant", top: 0 });
    }, [userId]);
    const { layoutMode } = useLayoutMode();
    const compact = useCoarsePointer();

    const [person, setPerson] = useState<string>("");
    const [sides, setSides] = useState<WatchCopySide[] | null>(null);
    const [personInfo, setPersonInfo] = useState<WatchCopyPerson | null>(null);
    const [others, setOthers] = useState<WatchCopySide[]>([]);
    const [confirmCopy, setConfirmCopy] = useState(false);
    const copyRef = useRef<HTMLDivElement>(null);
    const closeCopy = useCallback(() => setConfirmCopy(false), []);
    useDismiss(confirmCopy, copyRef, closeCopy);
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [watched, setWatched] = useState(true);
    const [resume, setResume] = useState(true);
    const [library, setLibrary] = useState(false);
    const [sinceDays, setSinceDays] = useState(0);
    const [preview, setPreview] = useState<WatchCopyPreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<"all" | WatchCopyOutcome>("all");
    const [typeFilter, setTypeFilter] = useState<"all" | "movie" | "series">("all");
    const [query, setQuery] = useState("");
    const [shown, setShown] = useState(PAGE);
    const [copyOpen, setCopyOpen] = useState(false);
    const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [matches, setMatches] = useState<Record<string, string>>({});
    const [matching, setMatching] = useState<string | null>(null);
    const [lastRun, setLastRun] = useState<WatchCopyRun | null>(null);
    const [copying, setCopying] = useState(false);
    const [confirmUndo, setConfirmUndo] = useState(false);
    const [undoing, setUndoing] = useState(false);
    const undoRef = useRef<HTMLDivElement>(null);
    const closeUndo = useCallback(() => setConfirmUndo(false), []);
    useDismiss(confirmUndo, undoRef, closeUndo);

    useEffect(() => {
        if (!userId) {
            return;
        }
        api.getUser(userId)
            .then((u: { username?: string }) => setPerson(u?.username || ""))
            .catch(() => undefined);
        api.getWatchCopySides(userId, true)
            .then((r) => {
                setSides(r.sides);
                setOthers(r.others || []);
                setPersonInfo(r.person || null);
                setLastRun(r.lastRun);
                const all = r.sides.flatMap((s) =>
                    s.profiles.length ? s.profiles.map((p) => p.side) : [s.side]
                );
                const wantFrom = search.get("from");
                const wantTo = search.get("to");
                const known = new Set([...all, ...(r.others || []).map((o) => o.side)]);
                // Nothing is picked for you: From and To start empty unless the
                // address names them (a link from Keep in step or a person's page).
                if (
                    wantFrom &&
                    wantTo &&
                    wantFrom !== wantTo &&
                    known.has(wantFrom) &&
                    known.has(wantTo)
                ) {
                    setFrom(wantFrom);
                    setTo(wantTo);
                }
            })
            .catch((e) => setError(e?.message || "Could not read their sign-ins"));
    }, [userId, search]);

    const fromChoice = sides ? choiceFor([...sides, ...others], from) : null;
    const toChoice = sides ? choiceFor([...sides, ...others], to) : null;
    const libraryAvailable =
        !!fromChoice &&
        !!toChoice &&
        fromChoice.sideInfo.provider !== "jellyfin" &&
        toChoice.sideInfo.provider !== "jellyfin";

    const load = useCallback(async () => {
        if (!(userId && from && to) || from === to) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const r = await api.previewWatchCopy(userId, {
                from,
                library: library && libraryAvailable,
                resume,
                sinceDays,
                to,
                watched,
            });
            setPreview(r);
            setSelected(new Set(r.items.filter((i) => i.outcome === "copy").map((i) => i.key)));
            setMatches({});
            setShown(PAGE);
            setCopyOpen(false);
            setUnfolded(new Set());
        } catch (e) {
            setPreview(null);
            setError((e as Error)?.message || "Could not read their watch history");
        } finally {
            setLoading(false);
        }
    }, [userId, from, to, watched, resume, library, libraryAvailable, sinceDays]);

    useEffect(() => {
        void load();
    }, [load]);

    const visible = useMemo(() => {
        if (!preview) {
            return [];
        }
        const q = query.trim().toLowerCase();
        return preview.items.filter(
            (i) =>
                (filter === "all" || i.outcome === filter) &&
                (typeFilter === "all" || i.type === typeFilter) &&
                (!q || (i.name || "").toLowerCase().includes(q))
        );
    }, [preview, filter, typeFilter, query]);

    const toCopy = [...selected].filter((k) =>
        preview?.items.some((i) => i.key === k && (i.outcome === "copy" || matches[k]))
    );

    const copyLabel = `Copy ${toCopy.length.toLocaleString()} title${toCopy.length === 1 ? "" : "s"}`;
    const swap = () => {
        setFrom(to);
        setTo(from);
    };
    const pickFrom = (s: string) => {
        if (s === to) {
            setTo(from);
        }
        setFrom(s);
    };
    const pickTo = (s: string) => {
        if (s === from) {
            setFrom(to);
        }
        setTo(s);
    };

    const runCopy = async () => {
        if (!(toCopy.length && preview)) {
            return;
        }
        setCopying(true);
        try {
            const keys = toCopy.filter((k) => !matches[k]);
            const picked = Object.fromEntries(
                Object.entries(matches).filter(([k]) => selected.has(k))
            );
            let job = await api.runWatchCopy(userId, {
                from,
                fromName: choiceLabel(fromChoice),
                keys,
                library: library && libraryAvailable,
                matches: picked,
                resume,
                sinceDays,
                to,
                toName: choiceLabel(toChoice),
                watched,
            });
            while (job.state === "running") {
                await new Promise((r) => setTimeout(r, 1500));
                job = (await api.getWatchCopyStatus(userId)).job || job;
            }
            if (job.state === "failed") {
                throw new Error(job.error || "The copy failed");
            }
            toast.success(
                `Copied ${job.done.toLocaleString()} title${job.done === 1 ? "" : "s"} to ${choiceLabel(toChoice)}${job.failed ? ` — ${job.failed} couldn’t be copied` : ""}`
            );
            setLastRun((await api.getWatchCopyStatus(userId)).lastRun);
            await load();
        } catch (e) {
            toast.error((e as Error)?.message || "Could not copy their watch history");
        } finally {
            setCopying(false);
        }
    };

    const runUndo = async () => {
        if (!lastRun) {
            return;
        }
        setUndoing(true);
        try {
            const r = await api.undoWatchCopy(userId, lastRun.id);
            toast.success(
                r.kept
                    ? `Undone — ${r.kept} title${r.kept === 1 ? "" : "s"} they watched since stayed as they are`
                    : "Undone"
            );
            setConfirmUndo(false);
            setLastRun((await api.getWatchCopyStatus(userId)).lastRun);
            await load();
        } catch (e) {
            toast.error((e as Error)?.message || "Could not undo that copy");
        } finally {
            setUndoing(false);
        }
    };

    const fromPic = (size: number) =>
        fromChoice ? (
            <ProfilePic
                kind={fromChoice.sideInfo.kind}
                person={fromChoice.sideInfo.person || personInfo}
                profile={fromChoice.profile}
                size={size}
            />
        ) : null;
    const toPic = (size: number) =>
        toChoice ? (
            <ProfilePic
                kind={toChoice.sideInfo.kind}
                person={toChoice.sideInfo.person || personInfo}
                profile={toChoice.profile}
                size={size}
            />
        ) : null;
    const enoughSides =
        !!sides &&
        sides.reduce((n, s) => n + Math.max(1, s.profiles.length), 0) + others.length >= 2;
    const otherSignIns = (sides || []).filter(
        (s) =>
            s.provider !== fromChoice?.sideInfo.provider &&
            s.provider !== toChoice?.sideInfo.provider
    );
    const backButton = (
        <Button
            leftIcon={<ArrowLeftIcon className="h-4 w-4" />}
            onClick={() =>
                router.push(home === "tasks" ? "/tasks" : `/users/${encodeURIComponent(userId)}`)
            }
            size="sm"
            variant="ghost"
        >
            {home === "tasks" ? "Tasks" : person || "Back"}
        </Button>
    );
    const subtitle =
        "Watched titles and resume points between any sign-ins and profiles - copy once, or keep them in step. Nothing is removed.";
    const daysLeft = lastRun
        ? Math.max(0, Math.ceil((new Date(lastRun.undoUntil).getTime() - Date.now()) / 86_400_000))
        : 0;
    const totals = preview?.totals;
    const tiles: { key: WatchCopyOutcome; n: number; label: string; color: string }[] = totals
        ? [
              { color: "var(--color-success)", key: "copy", label: "will copy", n: totals.copy },
              {
                  color: "var(--color-text-muted)",
                  key: "there",
                  label: "already there",
                  n: totals.there,
              },
              { color: AMBER, key: "further", label: "further along there", n: totals.further },
              {
                  color: "var(--color-primary)",
                  key: "match",
                  label: "need a match",
                  n: totals.match,
              },
          ]
        : [];

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    actions={backButton}
                    subtitle={subtitle}
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={
                                home === "tasks"
                                    ? [{ href: "/tasks", label: "Tasks" }, { label: "AIOSync" }]
                                    : [
                                          { href: "/users", label: "Users" },
                                          {
                                              href: `/users/${encodeURIComponent(userId)}`,
                                              label: person || "Person",
                                          },
                                          { label: "AIOSync" },
                                      ]
                            }
                        />
                    }
                />
            )}
            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-4 md:p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={
                        layoutMode === "nebula"
                            ? { maxWidth: "var(--interface-content-width)" }
                            : undefined
                    }
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            leading={backButton}
                            subtitle={subtitle}
                            title="AIOSync"
                        />
                    )}
                    {forSlot}
                    <PageSection>
                        {lastRun && (
                            <div
                                className="mb-5 flex flex-col gap-3 rounded-2xl border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                                style={{
                                    background: `color-mix(in srgb, ${AMBER} 11%, var(--color-surface))`,
                                    borderColor: `color-mix(in srgb, ${AMBER} 60%, transparent)`,
                                }}
                            >
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <ArrowUturnLeftIcon
                                        className="h-4 w-4 shrink-0"
                                        style={{ color: AMBER }}
                                    />
                                    <div className="min-w-0">
                                        <div className="font-semibold text-default text-sm">
                                            Copied {(lastRun.copied || 0).toLocaleString()} title
                                            {lastRun.copied === 1 ? "" : "s"}
                                            {lastRun.toName ? ` to ${lastRun.toName}` : ""}
                                        </div>
                                        <div className="text-muted text-xs">
                                            {lastRun.fromName ? `From ${lastRun.fromName}, ` : ""}
                                            {new Date(lastRun.createdAt).toLocaleString()} · undo
                                            available for {daysLeft} more day
                                            {daysLeft === 1 ? "" : "s"}
                                        </div>
                                    </div>
                                </div>
                                <div className="relative shrink-0" ref={undoRef}>
                                    <button
                                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 font-bold text-sm sm:w-auto"
                                        onClick={() => setConfirmUndo((o) => !o)}
                                        style={{
                                            background: AMBER,
                                            boxShadow: `0 8px 22px -10px ${AMBER}`,
                                            color: "#1a1200",
                                        }}
                                        type="button"
                                    >
                                        <ArrowUturnLeftIcon className="h-4 w-4" />
                                        Undo this copy
                                    </button>
                                    {confirmUndo && (
                                        <div
                                            className="absolute right-0 left-0 z-30 mt-2 rounded-2xl border border-default p-4 shadow-2xl sm:left-auto sm:w-80"
                                            style={{ background: "var(--color-surface)" }}
                                        >
                                            <div className="font-semibold text-sm">
                                                Undo this copy?
                                            </div>
                                            <p className="mt-1.5 text-muted text-sm">
                                                {lastRun.toName || "The destination"} goes back to
                                                how it was before: the watched marks and resume
                                                points this copy added come off. Anything they
                                                watched since stays.
                                            </p>
                                            <div className="mt-3 flex justify-end gap-2">
                                                <Button
                                                    onClick={() => setConfirmUndo(false)}
                                                    size="sm"
                                                    variant="secondary"
                                                >
                                                    Keep it
                                                </Button>
                                                <button
                                                    className="rounded-lg px-3 py-1.5 font-bold text-sm disabled:opacity-60"
                                                    disabled={undoing}
                                                    onClick={runUndo}
                                                    style={{ background: AMBER, color: "#1a1200" }}
                                                    type="button"
                                                >
                                                    {undoing ? "Undoing…" : "Undo copy"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {!userId && (
                            <>
                                <div className="grid max-w-[70rem] grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
                                    {(["from", "to"] as const).map((role) => (
                                        <div
                                            className={`min-w-0 ${role === "to" ? "md:order-3" : ""}`}
                                            key={role}
                                        >
                                            <div
                                                className="mb-1.5 font-bold text-[11px] tracking-[0.08em]"
                                                style={{ color: role === "from" ? FROM_C : TO_C }}
                                            >
                                                {role === "from" ? "COPY FROM" : "COPY TO"}
                                            </div>
                                            <div
                                                className="flex items-center justify-center rounded-[18px] text-muted text-sm opacity-60"
                                                style={{
                                                    border: `2px dashed ${role === "from" ? FROM_C : TO_C}`,
                                                    minHeight: compact ? 72 : 88,
                                                }}
                                            >
                                                Choose a person first
                                            </div>
                                        </div>
                                    ))}
                                    <div className="flex items-center justify-center md:order-2 md:flex-col md:pt-6">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover text-subtle md:h-12 md:w-12">
                                            <ArrowRightIcon className="hidden h-5 w-5 md:block" />
                                            <ArrowDownIcon className="h-5 w-5 md:hidden" />
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-6 rounded-2xl border border-default border-dashed px-5 py-9 text-center">
                                    <div className="font-semibold text-[17px] text-default">
                                        Choose who to sync
                                    </div>
                                    <div className="mt-1.5 text-muted text-sm">
                                        Pick a person above, then where to copy from and to. The
                                        titles that would copy show up here.
                                    </div>
                                </div>
                            </>
                        )}
                        {userId && sides === null && !error && (
                            <div className="text-muted text-sm">Reading their sign-ins…</div>
                        )}
                        {sides && !enoughSides && (
                            <div className="text-muted text-sm">
                                There’s nothing to copy between yet - add a second sign-in or
                                profile, or another person.
                            </div>
                        )}

                        {sides && enoughSides && (
                            <>
                                <div className="grid max-w-[70rem] grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
                                    <Slot
                                        choice={fromChoice}
                                        compact={compact}
                                        count={preview?.counts.from ?? null}
                                        onPick={pickFrom}
                                        other={to}
                                        others={others}
                                        person={personInfo}
                                        role="from"
                                        sides={sides}
                                    />
                                    <div className="flex items-center justify-center gap-3 md:flex-col md:gap-2 md:pt-6">
                                        <span
                                            className="flex h-10 w-10 items-center justify-center rounded-full text-white md:h-12 md:w-12"
                                            style={{
                                                background: `linear-gradient(135deg, ${FROM_C}, var(--color-primary))`,
                                                boxShadow: "0 8px 22px -10px var(--color-primary)",
                                            }}
                                        >
                                            <ArrowRightIcon className="hidden h-5 w-5 md:block" />
                                            <ArrowDownIcon className="h-5 w-5 md:hidden" />
                                        </span>
                                        <button
                                            className="flex items-center gap-1 text-muted text-xs hover:text-default"
                                            onClick={swap}
                                            type="button"
                                        >
                                            <ArrowsRightLeftIcon className="hidden h-3.5 w-3.5 md:block" />
                                            <ArrowsUpDownIcon className="h-3.5 w-3.5 md:hidden" />
                                            Swap
                                        </button>
                                    </div>
                                    <Slot
                                        choice={toChoice}
                                        compact={compact}
                                        count={preview?.counts.to ?? null}
                                        onPick={pickTo}
                                        other={from}
                                        others={others}
                                        person={personInfo}
                                        role="to"
                                        sides={sides}
                                    />
                                </div>
                                {otherSignIns.length > 0 && (fromChoice || toChoice) && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <span className="text-subtle text-xs">
                                            Their other sign-ins:
                                        </span>
                                        {otherSignIns.map((s) => (
                                            <OtherChip
                                                key={s.provider}
                                                onUse={(role) =>
                                                    (role === "from" ? pickFrom : pickTo)(
                                                        s.profiles[0]?.side || s.side
                                                    )
                                                }
                                                side={s}
                                            />
                                        ))}
                                    </div>
                                )}

                                {!(fromChoice && toChoice) && (
                                    <div className="mt-6 rounded-2xl border border-default border-dashed px-5 py-9 text-center">
                                        <div className="font-semibold text-[17px] text-default">
                                            Pick where to copy from and to
                                        </div>
                                        <div className="mt-1.5 text-muted text-sm">
                                            Choose two of their sign-ins or profiles, or someone
                                            else’s, and the titles that would copy show up here.
                                        </div>
                                    </div>
                                )}
                                {fromChoice && toChoice && (
                                    <>
                                        <div className="mt-4 flex flex-wrap items-center gap-1.5">
                                            <span className="mr-0.5 text-subtle text-xs">
                                                What to copy
                                            </span>
                                            <OptionChip
                                                on={watched}
                                                onClick={() => setWatched((v) => !v)}
                                            >
                                                Watched
                                            </OptionChip>
                                            <OptionChip
                                                on={resume}
                                                onClick={() => setResume((v) => !v)}
                                            >
                                                Resume points
                                            </OptionChip>
                                            {libraryAvailable && (
                                                <OptionChip
                                                    on={library}
                                                    onClick={() => setLibrary((v) => !v)}
                                                >
                                                    Library
                                                </OptionChip>
                                            )}
                                            <label className="relative inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-default px-3 py-1.5 text-default text-xs">
                                                Since:{" "}
                                                {SINCE.find((s) => s.days === sinceDays)?.label}
                                                <ChevronDownIcon className="h-3 w-3 opacity-60" />
                                                <select
                                                    aria-label="Since"
                                                    className="absolute inset-0 cursor-pointer opacity-0"
                                                    onChange={(e) =>
                                                        setSinceDays(Number(e.target.value))
                                                    }
                                                    value={sinceDays}
                                                >
                                                    {SINCE.map((s) => (
                                                        <option key={s.days} value={s.days}>
                                                            {s.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>

                                        {error && (
                                            <div
                                                className="mt-5 text-sm"
                                                style={{ color: "var(--color-error, #ef4444)" }}
                                            >
                                                {error}
                                            </div>
                                        )}
                                        {loading && (
                                            <div className="mt-5 text-muted text-sm">
                                                Reading both sides — a long history takes a little
                                                while…
                                            </div>
                                        )}

                                        {preview && !loading && (
                                            <>
                                                <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
                                                    {tiles.map((t) => {
                                                        const on = filter === t.key;
                                                        return (
                                                            <button
                                                                className={`sync-tile rounded-[14px] border px-3.5 py-3 text-left ${on ? "is-on" : ""}`}
                                                                key={t.key}
                                                                onClick={() =>
                                                                    setFilter(on ? "all" : t.key)
                                                                }
                                                                style={
                                                                    {
                                                                        "--tile": t.color,
                                                                    } as React.CSSProperties
                                                                }
                                                                type="button"
                                                            >
                                                                <div
                                                                    className="font-bold text-[22px]"
                                                                    style={{ color: t.color }}
                                                                >
                                                                    {t.n.toLocaleString()}
                                                                </div>
                                                                <div className="text-muted text-xs">
                                                                    {t.label}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                {preview.limits.length > 0 && (
                                                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-muted text-xs">
                                                        {preview.limits.map((l) => (
                                                            <span key={l}>{l}</span>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
                                                    <div
                                                        className="flex flex-1 items-center gap-2 rounded-xl border border-default px-3 py-2 md:min-w-[14rem]"
                                                        style={{
                                                            background:
                                                                "color-mix(in srgb, var(--color-surface) 70%, transparent)",
                                                        }}
                                                    >
                                                        <MagnifyingGlassIcon className="h-4 w-4 text-muted" />
                                                        <input
                                                            className="flex-1 bg-transparent text-default text-sm outline-none placeholder:text-muted"
                                                            onChange={(e) => {
                                                                setQuery(e.target.value);
                                                                setShown(PAGE);
                                                            }}
                                                            placeholder="Search titles"
                                                            value={query}
                                                        />
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {(
                                                            [
                                                                [
                                                                    "all",
                                                                    `All ${totals!.found.toLocaleString()}`,
                                                                ],
                                                                [
                                                                    "copy",
                                                                    `Will copy ${totals!.copy.toLocaleString()}`,
                                                                ],
                                                                [
                                                                    "further",
                                                                    `Kept ${totals!.further.toLocaleString()}`,
                                                                ],
                                                                [
                                                                    "match",
                                                                    `Need a match ${totals!.match.toLocaleString()}`,
                                                                ],
                                                            ] as const
                                                        ).map(([k, label]) => (
                                                            <OptionChip
                                                                key={k}
                                                                on={filter === k}
                                                                onClick={() => setFilter(k)}
                                                            >
                                                                {label}
                                                            </OptionChip>
                                                        ))}
                                                        <OptionChip
                                                            on={typeFilter === "movie"}
                                                            onClick={() =>
                                                                setTypeFilter(
                                                                    typeFilter === "movie"
                                                                        ? "all"
                                                                        : "movie"
                                                                )
                                                            }
                                                        >
                                                            Movies
                                                        </OptionChip>
                                                        <OptionChip
                                                            on={typeFilter === "series"}
                                                            onClick={() =>
                                                                setTypeFilter(
                                                                    typeFilter === "series"
                                                                        ? "all"
                                                                        : "series"
                                                                )
                                                            }
                                                        >
                                                            Shows
                                                        </OptionChip>
                                                    </div>
                                                </div>

                                                {GROUPS.map((g) => {
                                                    const list = visible.filter(
                                                        (v) => v.outcome === g.key
                                                    );
                                                    if (!list.length) {
                                                        return null;
                                                    }
                                                    const folded = g.folded && !unfolded.has(g.key);
                                                    const limit =
                                                        g.key === "copy" && !copyOpen
                                                            ? COPY_PEEK
                                                            : shown;
                                                    const keys = list.map((v) => v.key);
                                                    const allOn = keys.every((k) =>
                                                        selected.has(k)
                                                    );
                                                    return (
                                                        <Group
                                                            action={
                                                                g.key === "copy" ? (
                                                                    <button
                                                                        className="shrink-0 whitespace-nowrap rounded-[10px] px-3 py-1.5 font-semibold text-[13px]"
                                                                        onClick={() =>
                                                                            setSelected((sel) => {
                                                                                const n = new Set(
                                                                                    sel
                                                                                );
                                                                                keys.forEach((k) =>
                                                                                    allOn
                                                                                        ? n.delete(
                                                                                              k
                                                                                          )
                                                                                        : n.add(k)
                                                                                );
                                                                                return n;
                                                                            })
                                                                        }
                                                                        style={{
                                                                            background:
                                                                                "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                                                                            color: "color-mix(in srgb, var(--color-primary) 45%, #ffffff)",
                                                                        }}
                                                                        type="button"
                                                                    >
                                                                        {allOn
                                                                            ? "Untick all"
                                                                            : "Tick all"}
                                                                    </button>
                                                                ) : undefined
                                                            }
                                                            color={g.color}
                                                            count={list.length}
                                                            folded={folded}
                                                            key={g.key}
                                                            onUnfold={() =>
                                                                setUnfolded((u) =>
                                                                    new Set(u).add(g.key)
                                                                )
                                                            }
                                                            sub={
                                                                g.key === "copy" ? (
                                                                    <>
                                                                        Marked watched, or picked up
                                                                        where they left off, on{" "}
                                                                        {toPic(16)}{" "}
                                                                        {choiceLabel(toChoice)}
                                                                    </>
                                                                ) : g.key === "missing" ? (
                                                                    `${choiceLabel(toChoice)} doesn’t have these, so they’re left out`
                                                                ) : (
                                                                    g.sub
                                                                )
                                                            }
                                                            title={g.title}
                                                        >
                                                            <div className="mt-3 grid grid-cols-3 gap-x-3.5 gap-y-[18px] sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
                                                                {list
                                                                    .slice(0, limit)
                                                                    .map((item) => (
                                                                        <div
                                                                            className="relative"
                                                                            key={item.key}
                                                                        >
                                                                            <Poster
                                                                                fromPic={fromPic}
                                                                                item={item}
                                                                                matched={
                                                                                    !!matches[
                                                                                        item.key
                                                                                    ]
                                                                                }
                                                                                onMatch={() =>
                                                                                    setMatching(
                                                                                        item.key
                                                                                    )
                                                                                }
                                                                                onToggle={() =>
                                                                                    setSelected(
                                                                                        (sel) => {
                                                                                            const n =
                                                                                                new Set(
                                                                                                    sel
                                                                                                );
                                                                                            if (
                                                                                                n.has(
                                                                                                    item.key
                                                                                                )
                                                                                            ) {
                                                                                                n.delete(
                                                                                                    item.key
                                                                                                );
                                                                                            } else {
                                                                                                n.add(
                                                                                                    item.key
                                                                                                );
                                                                                            }
                                                                                            return n;
                                                                                        }
                                                                                    )
                                                                                }
                                                                                selected={selected.has(
                                                                                    item.key
                                                                                )}
                                                                                toPic={toPic}
                                                                            />
                                                                            {matching ===
                                                                                item.key && (
                                                                                <MatchPicker
                                                                                    item={item}
                                                                                    onClose={() =>
                                                                                        setMatching(
                                                                                            null
                                                                                        )
                                                                                    }
                                                                                    onPick={(
                                                                                        id
                                                                                    ) => {
                                                                                        setMatches(
                                                                                            (
                                                                                                m
                                                                                            ) => ({
                                                                                                ...m,
                                                                                                [item.key]:
                                                                                                    id,
                                                                                            })
                                                                                        );
                                                                                        setSelected(
                                                                                            (sel) =>
                                                                                                new Set(
                                                                                                    sel
                                                                                                ).add(
                                                                                                    item.key
                                                                                                )
                                                                                        );
                                                                                        setMatching(
                                                                                            null
                                                                                        );
                                                                                    }}
                                                                                    userId={userId}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                            </div>
                                                            {list.length > limit && (
                                                                <button
                                                                    className="mt-3.5 w-full rounded-[10px] bg-surface py-2.5 font-semibold text-[13px] text-muted hover:bg-surface-hover"
                                                                    onClick={() =>
                                                                        g.key === "copy" &&
                                                                        !copyOpen
                                                                            ? setCopyOpen(true)
                                                                            : setShown(
                                                                                  (n) => n + PAGE
                                                                              )
                                                                    }
                                                                    type="button"
                                                                >
                                                                    {g.key === "copy" && !copyOpen
                                                                        ? `Show all ${list.length.toLocaleString()}`
                                                                        : `Show more (${(list.length - limit).toLocaleString()} left)`}
                                                                </button>
                                                            )}
                                                        </Group>
                                                    );
                                                })}
                                                {visible.length === 0 && (
                                                    <div className="mt-4 text-muted text-sm">
                                                        Nothing here.
                                                    </div>
                                                )}

                                                {/* In the top-bar layout the account button floats in the bottom-left corner; the bar starts after it. */}
                                                <div
                                                    className={`sticky bottom-3 z-20 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-default py-3 pr-3.5 backdrop-blur-xl ${layoutMode === "nebula" ? "pl-[4.25rem] md:pl-20" : "pl-3.5"}`}
                                                    style={{
                                                        background:
                                                            "color-mix(in srgb, var(--color-surface) 88%, transparent)",
                                                        boxShadow:
                                                            "0 -8px 30px -16px rgba(0,0,0,.7)",
                                                    }}
                                                >
                                                    <div
                                                        className="flex min-w-0 items-center gap-2 text-xs"
                                                        style={{ color: AMBER }}
                                                    >
                                                        <ShieldCheckIcon className="hidden h-4 w-4 shrink-0 sm:block" />
                                                        <span className="hidden sm:inline">
                                                            SlickSync saves what{" "}
                                                            {choiceLabel(toChoice)} has first, so
                                                            you can <b>undo this copy for 7 days</b>
                                                        </span>
                                                        <span className="leading-tight sm:hidden">
                                                            Undo for 7 days
                                                        </span>
                                                    </div>
                                                    {/* Copy asks first, naming where it goes - one tap once wrote into
                          a real profile by accident. */}
                                                    <div
                                                        className="shrink-0 sm:relative"
                                                        ref={copyRef}
                                                    >
                                                        <button
                                                            aria-expanded={confirmCopy}
                                                            className={`rounded-xl px-4 py-2.5 font-semibold text-sm text-white disabled:opacity-50 sm:px-5 ${confirmCopy ? "copy-btn-open" : ""}`}
                                                            disabled={!toCopy.length || copying}
                                                            onClick={() =>
                                                                setConfirmCopy((o) => !o)
                                                            }
                                                            style={{
                                                                background:
                                                                    "linear-gradient(90deg, var(--color-primary), var(--color-secondary))",
                                                                boxShadow:
                                                                    "0 8px 22px -10px var(--color-primary)",
                                                            }}
                                                            type="button"
                                                        >
                                                            {copying ? "Copying…" : copyLabel}
                                                        </button>
                                                        {confirmCopy && (
                                                            <div
                                                                className="absolute right-0 bottom-full left-0 z-30 mb-3 rounded-2xl border border-default p-4 shadow-2xl sm:left-auto sm:w-[22rem]"
                                                                style={{
                                                                    background:
                                                                        "var(--color-surface)",
                                                                }}
                                                            >
                                                                <div className="font-semibold text-default text-sm">
                                                                    {copyLabel} into{" "}
                                                                    {choiceLabel(toChoice)}?
                                                                </div>
                                                                <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl bg-surface-hover p-2.5 font-semibold text-xs">
                                                                    <span
                                                                        className="inline-flex min-w-0 items-center gap-1.5"
                                                                        style={{ color: FROM_C }}
                                                                    >
                                                                        <ProfilePic
                                                                            kind={
                                                                                fromChoice.sideInfo
                                                                                    .kind
                                                                            }
                                                                            person={
                                                                                fromChoice.sideInfo
                                                                                    .person ||
                                                                                personInfo
                                                                            }
                                                                            profile={
                                                                                fromChoice.profile
                                                                            }
                                                                            size={22}
                                                                        />
                                                                        <span className="truncate">
                                                                            {fromChoice.profileName ||
                                                                                choiceLabel(
                                                                                    fromChoice
                                                                                )}
                                                                        </span>
                                                                    </span>
                                                                    <span className="text-muted">
                                                                        →
                                                                    </span>
                                                                    <span
                                                                        className="inline-flex min-w-0 items-center gap-1.5"
                                                                        style={{ color: TO_C }}
                                                                    >
                                                                        <ProfilePic
                                                                            kind={
                                                                                toChoice.sideInfo
                                                                                    .kind
                                                                            }
                                                                            person={
                                                                                toChoice.sideInfo
                                                                                    .person ||
                                                                                personInfo
                                                                            }
                                                                            profile={
                                                                                toChoice.profile
                                                                            }
                                                                            size={22}
                                                                        />
                                                                        <span className="truncate">
                                                                            {toChoice.profileName ||
                                                                                choiceLabel(
                                                                                    toChoice
                                                                                )}
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                                <p className="mt-2 text-muted text-sm">
                                                                    Watched marks and resume points
                                                                    are added there. Nothing is
                                                                    removed, and you can undo it
                                                                    from this page for 7 days.
                                                                </p>
                                                                <div className="mt-3 flex justify-end gap-2">
                                                                    <Button
                                                                        onClick={() =>
                                                                            setConfirmCopy(false)
                                                                        }
                                                                        size="sm"
                                                                        variant="secondary"
                                                                    >
                                                                        Cancel
                                                                    </Button>
                                                                    <button
                                                                        className="rounded-lg px-3 py-1.5 font-semibold text-sm text-white"
                                                                        onClick={() => {
                                                                            setConfirmCopy(false);
                                                                            void runCopy();
                                                                        }}
                                                                        style={{
                                                                            background:
                                                                                "linear-gradient(90deg, var(--color-primary), var(--color-secondary))",
                                                                        }}
                                                                        type="button"
                                                                    >
                                                                        {copyLabel}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                        {userId && sides && (
                            <div className="mt-6">
                                <KeepInStepCard userId={userId} />
                            </div>
                        )}
                    </PageSection>
                </div>
            </div>
        </>
    );
}
