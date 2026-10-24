"use client";

// Daily limit and bedtime for one person (or a merged profile): a screen-time
// budget - so many minutes a day, on the days chosen - with a bell and push
// alert when they reach it (server/utils/screenTime.js), and/or a bedtime: no
// streaming between two times on chosen nights. Counted across every app,
// like Watch Time. At the limit it either just alerts, or - chosen per person -
// also pauses their streaming until midnight or a chosen time; bedtime always
// pauses. The inside of the Limits popup (LimitsButton), with the age limit
// card under Bedtime.
//
// The daily limit and the bedtime each have their own switch, and either
// works without the other; with both off, nothing is saved. Every change
// saves as it is made, so there is no separate "Set" step to forget.

import {
    BellAlertIcon,
    ClockIcon,
    LockClosedIcon,
    MinusIcon,
    MoonIcon,
    PauseCircleIcon,
    PlusIcon,
    StopCircleIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { api, type ScreenTimeBedtime, type ScreenTimeLimit, type ScreenTimeView } from "@/lib/api";

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MINUTE_PRESETS = [30, 60, 90, 120, 180];
const STEP = 15;
const MAX_MINUTES = 24 * 60;
const DEFAULT_MINUTES = 90;
const DEFAULT_BEDTIME: ScreenTimeBedtime = { days: [], from: "21:00", to: "07:00" };
const DAY_PRESETS: { label: string; days: number[] }[] = [
    { days: [], label: "Every day" },
    { days: [1, 2, 3, 4, 5], label: "School days" },
    { days: [0, 6], label: "Weekends" },
];
// A bedtime's days are the nights it starts on: Sunday night is a school night.
const NIGHT_PRESETS: { label: string; days: number[] }[] = [
    { days: [], label: "Every night" },
    { days: [0, 1, 2, 3, 4], label: "School nights" },
    { days: [5, 6], label: "Weekends" },
];
const BEDTIME_FROM = ["20:00", "21:00", "22:00"];
const BEDTIME_TO = ["06:00", "07:00", "08:00"];
// Long enough that tapping + four times saves once, not four times.
const SAVE_DELAY_MS = 500;

type Limit = ScreenTimeLimit;

function formatMinutes(m: number): string {
    if (m < 60) {
        return `${m}m`;
    }
    return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function describeDays(days: number[], presets = DAY_PRESETS): string {
    const preset = presets.find((p) => p.days.join() === days.join());
    if (preset) {
        return preset.label.toLowerCase();
    }
    return days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(", ");
}

// When a pause ends: quick picks, plus any time.
const BACK_ON_PRESETS = ["00:00", "06:00", "07:00", "08:00"];

/** "midnight" or "7:00 AM" for an "HH:MM". */
function backOnLabel(resumeAt?: string): string {
    if (!resumeAt || resumeAt === "00:00") {
        return "midnight";
    }
    const [h, m] = resumeAt.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "9 PM" or "9:30 PM" - a bedtime's ends, short. */
function clock(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

// All seven picked is stored as "every day" - one meaning, one shape.
const normaliseDays = (days: number[]) => (days.length === 7 ? [] : [...days].sort());

/** A small on/off switch, the same in every card of the Limits popup. */
export function MiniSwitch({
    checked,
    onChange,
    label,
    disabled = false,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    disabled?: boolean;
}) {
    return (
        <button
            aria-checked={checked}
            aria-label={label}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-primary" : "border border-default bg-surface-hover"}`}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            role="switch"
            type="button"
        >
            <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
            />
        </button>
    );
}

/** A choice chip, the same in every card of the Limits popup. */
export const chipClass = (active: boolean) =>
    `max-w-full truncate px-2.5 py-1 rounded-full border text-xs transition-colors ${active ? "border-primary bg-primary/15 text-default" : "border-default text-subtle hover:text-default hover:bg-surface-hover"}`;

/**
 * The Daily limit and bedtime controls, with `after` (the age limit card)
 * under Bedtime. Reads its own state when it opens; onChange hears every
 * change, for the pill that opened it. `alsoOn` adds to the "On - ..." line
 * for what `after` has switched on.
 */
export function ScreenTimePanel({
    userId,
    name,
    onPickGroup,
    onReconnect,
    onClose,
    onChange,
    title = "Limits",
    after,
    alsoOn,
}: {
    userId: string;
    name: string;
    onPickGroup?: () => void;
    onReconnect?: () => void;
    onClose?: () => void;
    onChange?: (state: ScreenTimeView) => void;
    title?: string;
    after?: ReactNode;
    alsoOn?: string | null;
}) {
    const router = useRouter();
    const [state, setState] = useState<ScreenTimeView | null>(null);
    // What the controls show: minutes while the daily limit is on, a bedtime
    // while that is on. The rest (days, what happens at the limit) is kept
    // while they're off, so switching back on restores the last settings.
    const [draft, setDraft] = useState<Limit>({ days: [] });
    // The last bedtime and minutes, so switching either back on restores them.
    const lastBedtime = useRef<ScreenTimeBedtime>(DEFAULT_BEDTIME);
    const lastMinutes = useRef<number>(DEFAULT_MINUTES);
    const [saving, setSaving] = useState(false);
    const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

    const adopt = (limit: Limit | null) => {
        if (!limit) {
            return;
        }
        setDraft(limit);
        if (limit.bedtime) {
            lastBedtime.current = limit.bedtime;
        }
        if (limit.minutes) {
            lastMinutes.current = limit.minutes;
        }
    };

    // Read when it opens: today's minutes move while it's closed.
    useEffect(() => {
        api.getScreenTime(userId)
            .then((s) => {
                setState(s);
                adopt(s.limit);
            })
            .catch(() => undefined);
    }, [userId]);
    useEffect(
        () => () => {
            if (pending.current) {
                clearTimeout(pending.current);
            }
        },
        []
    );
    useEffect(() => {
        if (state) {
            onChange?.(state);
        }
    }, [state]);

    const save = async (limit: Limit | null) => {
        setSaving(true);
        try {
            setState(await api.setScreenTime(userId, limit));
        } catch (e) {
            toast.error((e as Error)?.message || "Could not save the daily limit");
            api.getScreenTime(userId)
                .then(setState)
                .catch(() => undefined);
        } finally {
            setSaving(false);
        }
    };

    // Neither a limit nor a bedtime is no limit at all.
    const saved = (next: Limit): Limit | null => (next.minutes || next.bedtime ? next : null);

    // Shown straight away; the save confirms it. Switches save at once,
    // everything else after a short pause.
    const change = (next: Limit, now = false) => {
        setDraft(next);
        if (next.bedtime) {
            lastBedtime.current = next.bedtime;
        }
        if (next.minutes) {
            lastMinutes.current = next.minutes;
        }
        const limit = saved(next);
        setState((s) =>
            s ? { ...s, appliesToday: next.minutes ? s.appliesToday : false, limit } : s
        );
        if (pending.current) {
            clearTimeout(pending.current);
            pending.current = null;
        }
        if (now) {
            save(limit);
            return;
        }
        pending.current = setTimeout(() => {
            pending.current = null;
            save(limit);
        }, SAVE_DELAY_MS);
    };

    const setMinutes = (m: number) =>
        change({ ...draft, minutes: Math.max(STEP, Math.min(MAX_MINUTES, m)) });
    const pickedDays = draft.days.length ? draft.days : ALL_DAYS;
    const toggleDay = (d: number) => {
        const next = pickedDays.includes(d)
            ? pickedDays.filter((x) => x !== d)
            : [...pickedDays, d];
        if (!next.length) {
            return; // at least one day; "none" is the switch's job
        }
        change({ ...draft, days: normaliseDays(next) });
    };

    // A minutes limit, a bedtime, both, or neither.
    const hasMinutes = !!draft.minutes;
    const bedtime = draft.bedtime;
    const turnMinutes = (next: boolean) =>
        change({ ...draft, minutes: next ? lastMinutes.current : undefined }, true);
    const turnBedtime = (next: boolean) =>
        change({ ...draft, bedtime: next ? lastBedtime.current : undefined }, true);
    const setBedtime = (patch: Partial<ScreenTimeBedtime>) => {
        const next = { ...(bedtime || DEFAULT_BEDTIME), ...patch };
        if (next.from === next.to) {
            return;
        }
        change({ ...draft, bedtime: next });
    };
    const pickedNights = bedtime?.days.length ? bedtime.days : ALL_DAYS;
    const toggleNight = (d: number) => {
        const next = pickedNights.includes(d)
            ? pickedNights.filter((x) => x !== d)
            : [...pickedNights, d];
        if (!next.length) {
            return;
        }
        setBedtime({ days: normaliseDays(next) });
    };

    const today = state?.todayMinutes ?? 0;
    const limit = state?.limit;
    const limitMinutes = limit?.minutes || 0;
    const reached = !!limitMinutes && !!state?.appliesToday && today >= limitMinutes;
    const share = limitMinutes ? Math.min(1, today / limitMinutes) : 0;

    const paused = state?.paused || null;
    const pausing = !!limitMinutes && limit?.onReach === "pause";

    // Why a pause can't work for them, as the tile shows it.
    const locked =
        state?.canPause && !state.canPause.ok
            ? state.canPause.code === "no-group"
                ? {
                      action: onPickGroup ? ("group" as const) : null,
                      badge: "Needs a group",
                      hint: "Put them in a group first",
                  }
                : state.canPause.code === "needs-admin"
                  ? {
                        action: "guide" as const,
                        badge: "Needs admin sign-in",
                        hint: "Add their server’s admin here",
                    }
                  : state.canPause.code === "needs-config-password"
                    ? {
                          action: onReconnect ? ("reconnect" as const) : null,
                          badge: "Needs config password",
                          hint: "Reconnect them with it",
                      }
                    : state.canPause.code === "shares-addons"
                      ? {
                            action: null,
                            badge: "Alert only",
                            hint: "It uses the main profile’s addons",
                        }
                      : state.canPause.code === "needs-address"
                        ? {
                              action: null,
                              badge: "Can’t reach it",
                              detail: state.canPause.reason,
                              hint: "Phones can’t reach SlickSync yet",
                          }
                        : {
                              action: null,
                              badge: "Alert only",
                              hint: "This server can’t pause one person",
                          }
            : null;
    const unlock = () => {
        if (locked?.action === "group" && onPickGroup) {
            onClose?.();
            onPickGroup();
        }
        if (locked?.action === "guide") {
            onClose?.();
            router.push("/guides/add-jellyfin-account");
        }
        if (locked?.action === "reconnect" && onReconnect) {
            onClose?.();
            onReconnect();
        }
    };

    const resumeNow = async () => {
        setSaving(true);
        try {
            setState(await api.resumeScreenTime(userId));
            toast.success(
                paused?.reason === "bedtime"
                    ? `${name} can stream again tonight`
                    : `${name} can stream again today`
            );
        } catch (e) {
            toast.error((e as Error)?.message || "Could not resume them");
        } finally {
            setSaving(false);
        }
    };

    const chip = chipClass;
    const miniSwitch = (
        checked: boolean,
        onChange: (v: boolean) => void,
        label: string,
        disabled = false
    ) => <MiniSwitch checked={checked} disabled={disabled} label={label} onChange={onChange} />;
    const timeChips = (
        presets: string[],
        value: string,
        set: (v: string) => void,
        label: string
    ) => (
        <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((t) => (
                <button
                    aria-pressed={value === t}
                    className={chip(value === t)}
                    key={t}
                    onClick={() => set(t)}
                    type="button"
                >
                    {clock(t)}
                </button>
            ))}
            <label
                className={`inline-flex cursor-pointer items-center rounded-full border px-2.5 py-0.5 text-xs ${presets.includes(value) ? "border-default text-subtle" : "border-primary bg-primary/15 text-default"}`}
            >
                <span className="sr-only">{label}</span>
                <input
                    aria-label={label}
                    className="cursor-pointer bg-transparent text-inherit text-xs outline-none"
                    onChange={(e) => {
                        if (e.target.value) {
                            set(e.target.value);
                        }
                    }}
                    type="time"
                    value={value}
                />
            </label>
        </div>
    );

    const summary = [
        limitMinutes
            ? `${pausing ? "pauses streaming" : "alerts you"} when ${name} passes ${formatMinutes(limitMinutes)} ${limit?.days.length ? `on ${describeDays(limit.days)}` : "on any day"}`
            : null,
        limit?.bedtime
            ? `no streaming ${clock(limit.bedtime.from)}–${clock(limit.bedtime.to)} ${limit.bedtime.days.length ? `on ${describeDays(limit.bedtime.days, NIGHT_PRESETS)}` : "every night"}`
            : null,
        alsoOn || null,
    ]
        .filter(Boolean)
        .join(", and ");
    const pausesSomething = pausing || !!bedtime;
    return (
        <div className="space-y-4">
            <div className="min-w-0">
                <p className="font-semibold text-default text-sm">{title}</p>
                <p className="mt-0.5 text-muted text-xs">
                    {summary ? <>On - {summary}.</> : <>Off - {name} has no limits.</>}
                </p>
                {state?.profileOf && (
                    <p className="mt-1 text-muted text-xs">
                        {name} is{" "}
                        {state.profileOf.kind === "household"
                            ? "in the household of"
                            : "a profile of"}{" "}
                        {state.profileOf.name || "someone"}. Only {name}’s own watching counts, and
                        only {name} is paused.
                    </p>
                )}
            </div>

            {/* Paused right now - with the way back. */}
            {paused && (
                <div
                    className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 px-3 py-2.5"
                    style={{ background: "var(--color-warning-muted)" }}
                >
                    <div className="min-w-0">
                        <p className="font-medium text-warning text-xs">
                            {paused.reason === "bedtime" ? "Bedtime" : "Paused"} until{" "}
                            {paused.untilLabel}
                        </p>
                        <p className="mt-0.5 text-muted text-xs">
                            Nothing new will play for {name} until then.
                        </p>
                    </div>
                    <button
                        className="shrink-0 rounded-full border border-default bg-surface px-2.5 py-1 font-medium text-default text-xs hover:bg-surface-hover disabled:opacity-50"
                        disabled={saving}
                        onClick={resumeNow}
                        type="button"
                    >
                        Resume now
                    </button>
                </div>
            )}

            {/* Today, as a bar against the limit when one applies today. */}
            <div
                className="rounded-xl px-3 py-2.5"
                style={{ background: "var(--color-surface-hover)" }}
            >
                <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted">Watched today</span>
                    <span
                        className={
                            reached ? "font-medium text-warning" : "font-medium text-default"
                        }
                    >
                        {formatMinutes(today)}
                        {limitMinutes && state?.appliesToday ? (
                            <span className="font-normal text-subtle">
                                {" "}
                                of {formatMinutes(limitMinutes)}
                            </span>
                        ) : null}
                    </span>
                </div>
                {limitMinutes > 0 && state?.appliesToday && (
                    <div
                        className="mt-2 h-1.5 overflow-hidden rounded-full"
                        style={{ background: "var(--color-bg-subtle)" }}
                    >
                        <div
                            className={`h-full rounded-full transition-all ${reached ? "bg-warning" : "bg-primary"}`}
                            style={{ width: `${Math.max(share * 100, 2)}%` }}
                        />
                    </div>
                )}
                {limitMinutes > 0 && state && !state.appliesToday && (
                    <p className="mt-1 text-muted text-xs">No limit today.</p>
                )}
            </div>

            <div className="space-y-3">
                {/* Daily limit: so many minutes a day, on chosen days. */}
                <div className="space-y-3 rounded-xl border border-default p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                            <ClockIcon
                                className={`mt-0.5 h-4 w-4 shrink-0 ${hasMinutes ? "text-primary" : "text-subtle"}`}
                            />
                            <div className="min-w-0">
                                <p className="font-medium text-default text-xs">Daily limit</p>
                                <p className="text-muted text-xs leading-snug">
                                    {hasMinutes
                                        ? `${formatMinutes(draft.minutes || 0)} a day`
                                        : "So much watching a day"}
                                </p>
                            </div>
                        </div>
                        {miniSwitch(
                            hasMinutes,
                            turnMinutes,
                            hasMinutes ? "Turn the daily limit off" : "Turn the daily limit on",
                            !state
                        )}
                    </div>
                    {hasMinutes && (
                        <div>
                            <p className="mb-1.5 font-medium text-muted text-xs">
                                When they reach it
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    aria-pressed={!pausing}
                                    className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition-colors ${pausing ? "border-default hover:bg-surface-hover" : "border-primary bg-primary/15"}`}
                                    onClick={() => change({ ...draft, onReach: undefined })}
                                    type="button"
                                >
                                    <BellAlertIcon
                                        className={`h-4 w-4 ${pausing ? "text-subtle" : "text-primary"}`}
                                    />
                                    <span className="font-medium text-default text-xs">
                                        Tell me
                                    </span>
                                    <span className="text-muted text-xs leading-snug">
                                        Bell and push alert
                                    </span>
                                </button>
                                {locked ? (
                                    // Can't be chosen for them yet: says why on the tile itself,
                                    // and tapping it goes to the fix where there is one.
                                    <button
                                        aria-label={`Pause streaming - ${locked.badge}. ${state?.canPause.reason || ""}`}
                                        className={`flex flex-col items-start gap-1 rounded-xl border border-warning/60 border-dashed p-2.5 text-left transition-colors ${locked.action ? "hover:bg-warning/10" : "cursor-default"}`}
                                        onClick={unlock}
                                        type="button"
                                    >
                                        <span className="flex w-full items-center justify-between gap-1">
                                            <PauseCircleIcon className="h-4 w-4 shrink-0 text-subtle" />
                                            <span className="inline-flex max-w-full items-center gap-0.5 truncate whitespace-nowrap rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning leading-none">
                                                <LockClosedIcon className="h-2.5 w-2.5" />
                                                {locked.badge}
                                            </span>
                                        </span>
                                        <span className="font-medium text-muted text-xs">
                                            Pause streaming
                                        </span>
                                        <span className="text-warning text-xs leading-snug">
                                            {locked.hint}
                                            {locked.action ? " →" : ""}
                                        </span>
                                    </button>
                                ) : (
                                    <button
                                        aria-pressed={pausing}
                                        className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition-colors ${pausing ? "border-primary bg-primary/15" : "border-default hover:bg-surface-hover"}`}
                                        onClick={() => change({ ...draft, onReach: "pause" })}
                                        type="button"
                                    >
                                        <PauseCircleIcon
                                            className={`h-4 w-4 ${pausing ? "text-primary" : "text-subtle"}`}
                                        />
                                        <span className="font-medium text-default text-xs">
                                            Pause streaming
                                        </span>
                                        <span className="text-muted text-xs leading-snug">
                                            Until {backOnLabel(draft.resumeAt)}, and tell me
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* When a pause ends - midnight unless they'd rather it stayed off
            until the morning (or came back sooner). */}
                    {hasMinutes && pausing && (
                        <div>
                            <p className="mb-1.5 font-medium text-muted text-xs">Back on at</p>
                            <div className="flex flex-wrap items-center gap-1.5">
                                {BACK_ON_PRESETS.map((t) => (
                                    <button
                                        aria-pressed={(draft.resumeAt || "00:00") === t}
                                        className={chip((draft.resumeAt || "00:00") === t)}
                                        key={t}
                                        onClick={() => change({ ...draft, resumeAt: t })}
                                        type="button"
                                    >
                                        {t === "00:00"
                                            ? "Midnight"
                                            : backOnLabel(t).replace(":00", "")}
                                    </button>
                                ))}
                                <label
                                    className={`inline-flex cursor-pointer items-center rounded-full border px-2.5 py-0.5 text-xs ${BACK_ON_PRESETS.includes(draft.resumeAt || "00:00") ? "border-default text-subtle" : "border-primary bg-primary/15 text-default"}`}
                                >
                                    <span className="sr-only">Another time</span>
                                    <input
                                        aria-label="Back on at another time"
                                        className="cursor-pointer bg-transparent text-inherit text-xs outline-none"
                                        onChange={(e) => {
                                            if (e.target.value) {
                                                change({ ...draft, resumeAt: e.target.value });
                                            }
                                        }}
                                        type="time"
                                        value={draft.resumeAt || "00:00"}
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {hasMinutes && (
                        <div>
                            <p className="mb-1.5 font-medium text-muted text-xs">How long</p>
                            <div className="flex flex-wrap gap-1.5">
                                {MINUTE_PRESETS.map((m) => (
                                    <button
                                        aria-pressed={draft.minutes === m}
                                        className={chip(draft.minutes === m)}
                                        key={m}
                                        onClick={() => setMinutes(m)}
                                        type="button"
                                    >
                                        {formatMinutes(m)}
                                    </button>
                                ))}
                            </div>
                            <div className="mt-2 inline-flex items-center rounded-full border border-default">
                                <button
                                    aria-label={`${STEP} minutes less`}
                                    className="rounded-l-full p-1.5 text-subtle hover:bg-surface-hover hover:text-default"
                                    onClick={() => setMinutes((draft.minutes || 0) - STEP)}
                                    type="button"
                                >
                                    <MinusIcon className="h-3.5 w-3.5" />
                                </button>
                                <span className="min-w-[64px] px-3 text-center font-medium text-default text-xs tabular-nums">
                                    {formatMinutes(draft.minutes || 0)}
                                </span>
                                <button
                                    aria-label={`${STEP} minutes more`}
                                    className="rounded-r-full p-1.5 text-subtle hover:bg-surface-hover hover:text-default"
                                    onClick={() => setMinutes((draft.minutes || 0) + STEP)}
                                    type="button"
                                >
                                    <PlusIcon className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    )}

                    {hasMinutes && (
                        <div>
                            <p className="mb-1.5 font-medium text-muted text-xs">Which days</p>
                            <div className="flex justify-between gap-1">
                                {WEEKDAY_LETTERS.map((letter, d) => {
                                    const picked = pickedDays.includes(d);
                                    return (
                                        <button
                                            aria-label={WEEKDAY_NAMES[d]}
                                            aria-pressed={picked}
                                            className={`h-9 w-9 rounded-full border font-medium text-xs transition-colors ${picked ? "border-primary bg-primary/15 text-default" : "border-default text-subtle hover:bg-surface-hover"}`}
                                            key={d}
                                            onClick={() => toggleDay(d)}
                                            title={WEEKDAY_NAMES[d]}
                                            type="button"
                                        >
                                            {letter}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {DAY_PRESETS.map((p) => (
                                    <button
                                        aria-pressed={draft.days.join() === p.days.join()}
                                        className={chip(draft.days.join() === p.days.join())}
                                        key={p.label}
                                        onClick={() => change({ ...draft, days: p.days })}
                                        type="button"
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Bedtime: no streaming between two times, on chosen nights. Always a pause. */}
                <div className="space-y-3 rounded-xl border border-default p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                            <MoonIcon
                                className={`mt-0.5 h-4 w-4 shrink-0 ${bedtime ? "text-primary" : "text-subtle"}`}
                            />
                            <div className="min-w-0">
                                <p className="font-medium text-default text-xs">Bedtime</p>
                                <p className="text-muted text-xs leading-snug">
                                    {bedtime
                                        ? `No streaming ${clock(bedtime.from)}–${clock(bedtime.to)}`
                                        : "Streaming off overnight"}
                                </p>
                            </div>
                        </div>
                        {miniSwitch(
                            !!bedtime,
                            turnBedtime,
                            bedtime ? "Turn bedtime off" : "Turn bedtime on",
                            !state
                        )}
                    </div>
                    {bedtime && locked && (
                        <button
                            className={`w-full text-left text-warning text-xs leading-snug ${locked.action ? "hover:underline" : "cursor-default"}`}
                            onClick={unlock}
                            type="button"
                        >
                            <LockClosedIcon className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />
                            {"detail" in locked && locked.detail ? (
                                <>
                                    Bedtime can’t pause yet. {locked.detail}
                                    {locked.action ? " →" : ""}
                                </>
                            ) : (
                                <>
                                    Bedtime needs a pause - {locked.hint.toLowerCase()}
                                    {locked.action ? " →" : ""}
                                </>
                            )}
                        </button>
                    )}
                    {bedtime && (
                        <>
                            <div>
                                <p className="mb-1 text-muted text-xs">From</p>
                                {timeChips(
                                    BEDTIME_FROM,
                                    bedtime.from,
                                    (v) => setBedtime({ from: v }),
                                    "Bedtime starts at another time"
                                )}
                            </div>
                            <div>
                                <p className="mb-1 text-muted text-xs">Until</p>
                                {timeChips(
                                    BEDTIME_TO,
                                    bedtime.to,
                                    (v) => setBedtime({ to: v }),
                                    "Bedtime ends at another time"
                                )}
                            </div>
                            <div>
                                <p className="mb-1 text-muted text-xs">Which nights</p>
                                <div className="flex justify-between gap-1">
                                    {WEEKDAY_LETTERS.map((letter, d) => {
                                        const picked = pickedNights.includes(d);
                                        return (
                                            <button
                                                aria-label={`${WEEKDAY_NAMES[d]} night`}
                                                aria-pressed={picked}
                                                className={`h-8 w-8 rounded-full border font-medium text-xs transition-colors ${picked ? "border-primary bg-primary/15 text-default" : "border-default text-subtle hover:bg-surface-hover"}`}
                                                key={d}
                                                onClick={() => toggleNight(d)}
                                                title={`${WEEKDAY_NAMES[d]} night`}
                                                type="button"
                                            >
                                                {letter}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {NIGHT_PRESETS.map((p) => (
                                        <button
                                            aria-pressed={bedtime.days.join() === p.days.join()}
                                            className={chip(bedtime.days.join() === p.days.join())}
                                            key={p.label}
                                            onClick={() => setBedtime({ days: p.days })}
                                            type="button"
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {after}

                {/* A real Jellyfin server can stop what's on, not just what's next. */}
                {state?.canStopPlaying && pausesSomething && !locked && (
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                            <StopCircleIcon
                                className={`mt-0.5 h-4 w-4 shrink-0 ${draft.stopPlaying ? "text-primary" : "text-subtle"}`}
                            />
                            <div className="min-w-0">
                                <p className="font-medium text-default text-xs">
                                    Stop what’s playing
                                </p>
                                <p className="text-muted text-xs leading-snug">
                                    A message on their screen 10 minutes before, then it stops
                                </p>
                            </div>
                        </div>
                        {miniSwitch(
                            !!draft.stopPlaying,
                            (v) => change({ ...draft, stopPlaying: v || undefined }),
                            draft.stopPlaying ? "Let what’s playing finish" : "Stop what’s playing"
                        )}
                    </div>
                )}
            </div>

            {/* Stremio and Nuvio pause through SlickSync's gate, which their
          devices must be able to reach - otherwise the old way, which needs
          their app reopened. */}
            {state?.instant === false && pausesSomething && !locked && (
                <p className="text-warning text-xs">
                    A pause takes hold when their app is next reopened, not at once.{" "}
                    {state.gateProblem || "Phones and TVs can’t reach this instance yet."}
                </p>
            )}
            <p className="text-muted text-xs leading-relaxed">
                {saving
                    ? "Saving…"
                    : limit
                      ? pausesSomething
                          ? `Counted in every app. When it pauses, what plays streams is switched off${draft.stopPlaying && state?.canStopPlaying ? " and what’s playing stops" : "; what’s already playing carries on"}. Changes save as you make them.`
                          : "Bell and push alert when they reach it, in any app. Nothing is stopped. Changes save as you make them."
                      : "A daily limit tells you when they pass a set time each day, or pauses their streaming then. A bedtime switches streaming off overnight. An age limit keeps out anything rated too high. Use any of them, or all three."}
            </p>
        </div>
    );
}
