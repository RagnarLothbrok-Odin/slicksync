"use client";

// The household on one AIOStreams or AIOMetadata sign-in, as profiles - the
// Jellyfin counterpart of the Nuvio profiles card (components/user/
// ProfilesCard), and it looks and works the same way: collapsed until opened,
// one tile per profile, and picking one opens what can be done with it right
// underneath. The rules live in server/utils/jellyfinProfiles.js.

import {
    ArrowsPointingInIcon,
    ArrowTopRightOnSquareIcon,
    ChevronDownIcon,
    EyeIcon,
    EyeSlashIcon,
    KeyIcon,
    LinkIcon,
    LockClosedIcon,
    PlusIcon,
    QuestionMarkCircleIcon,
    UserPlusIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge, Button, Card, ConfirmModal, Modal, ToggleSwitch } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { LimitsButton } from "@/components/user/LimitsButton";
import {
    MENU_ITEM,
    type Placement,
    POPOVER_WIDTH,
    placeUnder,
} from "@/components/user/ProfilesCard";
import { api, type HouseholdPersonal, type HouseholdProfile, type LimitsSummary } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { avatarThumbUrl } from "@/lib/posterUrl";

interface PendingAction {
    /** Where to go back to when it is cancelled. */
    back?: () => void;
    confirmText: string;
    description: string;
    run: () => Promise<void>;
    title: string;
    variant?: "default" | "warning" | "danger";
}

const STATUS_TEXT: Record<HouseholdProfile["status"], string> = {
    "needs-pin": "Needs its PIN to be tracked",
    "needs-sign-in": "Needs the password to be tracked",
    own: "Separated - its own person",
    tracked: "Tracked with this person",
    untracked: "Not tracked",
};

function Mark({ profile, size }: { profile: HouseholdProfile; size: number }) {
    const dim =
        profile.status === "untracked" ||
        profile.status === "needs-pin" ||
        profile.status === "needs-sign-in";
    // Their picture on the server, where it has one (server/utils/serverAvatars.js).
    if (profile.avatarUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                alt=""
                aria-hidden
                className={`shrink-0 rounded-full object-cover ${dim ? "opacity-40 grayscale" : ""}`}
                height={size}
                src={avatarThumbUrl(profile.avatarUrl, size > 48 ? "lg" : "sm")}
                style={{ height: size, width: size }}
                width={size}
            />
        );
    }
    return (
        <span
            aria-hidden
            className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${dim ? "opacity-40 grayscale" : ""}`}
            style={{
                background:
                    "linear-gradient(135deg, rgba(170, 92, 195, 0.25) 0%, rgba(0, 164, 220, 0.22) 100%)",
                boxShadow: "inset 0 0 0 1.5px rgba(0, 164, 220, 0.35)",
                color: "rgb(167, 214, 240)",
                fontSize: Math.round(size * 0.4),
                height: size,
                width: size,
            }}
        >
            {profile.name.trim().charAt(0).toUpperCase()}
        </span>
    );
}

export function HouseholdCard({
    userId,
    personName,
    kindLabel,
    onPeopleChanged,
    embedded = false,
    onProfilesChanged,
    limits,
}: {
    /** The person whose sign-in the household was found on. */
    userId: string;
    personName: string;
    /** AIOStreams or AIOMetadata. */
    kindLabel: string;
    onPeopleChanged?: () => void;
    /** Inside HouseholdsCard: no card or collapse of its own, just this person's section. */
    embedded?: boolean;
    /** The Users page's overview of who has limits, for each tile's Limits pill. */
    limits?: Record<string, LimitsSummary>;
    /** Told whenever this household's profiles change, so HouseholdsCard's summary keeps up. */
    onProfilesChanged?: (profiles: HouseholdProfile[]) => void;
}) {
    // What this browser last saw, so the card is there with the page instead of
    // popping in after it; the load below refreshes it in place.
    const [profiles, setProfiles] = useState<HouseholdProfile[] | null>(
        () =>
            api.peekGet<{ profiles: HouseholdProfile[] }>(
                `/jellyfin/users/${encodeURIComponent(userId)}/household`
            )?.profiles ?? null
    );
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<PendingAction | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [placement, setPlacement] = useState<Placement | null>(null);
    const [signingIn, setSigningIn] = useState<HouseholdProfile | null>(null);
    const [password, setPassword] = useState("");
    const [pin, setPin] = useState("");
    // Adding household users and changing PINs (server/utils/aioHousehold.js,
    // aiometadataHousehold.js): only for someone added with their configuration
    // password - and PINs on AIOMetadata only once it has them.
    const [canManage, setCanManage] = useState(false);
    const [canPin, setCanPin] = useState(false);
    const [serverKind, setServerKind] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState("");
    const [newPin, setNewPin] = useState("");
    const [newHistory, setNewHistory] = useState<"own" | "shared">("own");
    const [pinFor, setPinFor] = useState<HouseholdProfile | null>(null);
    const [changedPin, setChangedPin] = useState("");
    // Household users kept separate, each with a sign-in address of their own
    // (AIOStreams only), by profile id.
    const [personal, setPersonal] = useState<Record<string, HouseholdPersonal>>({});
    const [newSeparate, setNewSeparate] = useState(false);
    const [addressFor, setAddressFor] = useState<HouseholdProfile | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const closeMenu = useCallback(() => {
        setSelected(null);
        setPlacement(null);
    }, []);

    const load = useCallback(async () => {
        try {
            const h = await api.getHousehold(userId);
            setProfiles(h.profiles);
            setCanManage(!!h.canManage);
            setCanPin(!!h.canPin);
            setServerKind(h.kind);
            setPersonal(h.personal || {});
            return h;
        } catch {
            setProfiles(null);
            return null;
        }
    }, [userId]);
    useEffect(() => {
        if (profiles) {
            onProfilesChanged?.(profiles);
        }
    }, [profiles, onProfilesChanged]);
    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (selected === null) {
            return;
        }
        const onDown = (e: MouseEvent) => {
            if (popoverRef.current?.contains(e.target as Node)) {
                return;
            }
            if ((e.target as HTMLElement)?.closest?.("[data-household-tile]")) {
                return;
            }
            closeMenu();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                closeMenu();
            }
        };
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        window.addEventListener("scroll", closeMenu, true);
        window.addEventListener("resize", closeMenu);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", closeMenu, true);
            window.removeEventListener("resize", closeMenu);
        };
    }, [selected, closeMenu]);

    const openMenu = (id: string, tile: HTMLElement) => {
        if (selected === id) {
            closeMenu();
            return;
        }
        const circle =
            (
                tile.querySelector("[data-household-circle]") as HTMLElement | null
            )?.getBoundingClientRect() || tile.getBoundingClientRect();
        setSelected(id);
        setPlacement(placeUnder(circle, 200));
    };

    const perform = async (
        action: () => Promise<{ profiles: HouseholdProfile[] }>,
        message: string,
        peopleChange = false
    ) => {
        closeMenu();
        setBusy(true);
        try {
            const next = await action();
            setProfiles(next.profiles);
            toast.success(message);
            if (peopleChange) {
                onPeopleChanged?.();
            }
        } catch (e: any) {
            toast.error(e?.message || "Could not change that");
        } finally {
            setBusy(false);
            setPending(null);
        }
    };

    const separate = (p: HouseholdProfile) =>
        setPending({
            confirmText: "Separate",
            description: `${p.name} becomes its own person on the Users list, with everything watched on the ${p.name} profile so far, and is read with its own sign-in from now on. You can merge it back any time.`,
            run: () =>
                perform(() => api.separateHouseholdProfile(p.id), `${p.name} is separated`, true),
            title: `Separate ${p.name}?`,
        });

    const mergeBack = (p: HouseholdProfile) =>
        setPending({
            confirmText: "Merge back",
            description: `Everything ${p.person?.username || p.name} recorded becomes part of ${personName}'s history again, labelled as the ${p.name} profile, and they leave the Users list. You can separate it again at any time.`,
            run: () =>
                perform(
                    () => api.mergeHouseholdProfileBack(p.id),
                    `${p.name} merged back into ${personName}`,
                    true
                ),
            title: `Merge ${p.person?.username || p.name} back into ${personName}?`,
            variant: "warning",
        });

    const stopTracking = (p: HouseholdProfile) =>
        setPending({
            confirmText: "Stop tracking",
            description: `Nothing watched on ${p.name} is recorded from now on - no history, watch time or stats. What it has already recorded stays where it is.`,
            run: () =>
                perform(
                    () => api.trackHouseholdProfile(p.id, false),
                    `${p.name} is no longer tracked`
                ),
            title: `Stop tracking ${p.name}?`,
        });

    const submitSignIn = async () => {
        if (!signingIn) {
            return;
        }
        setBusy(true);
        try {
            const next = await api.signInHouseholdProfile(signingIn.id, {
                password,
                pin: pin.trim() || undefined,
            });
            setProfiles(next.profiles);
            toast.success(`${signingIn.name} is tracked`);
            setSigningIn(null);
            setPassword("");
            setPin("");
        } catch (e: any) {
            toast.error(e?.message || "Could not sign that profile in");
        } finally {
            setBusy(false);
        }
    };

    const submitAdd = async () => {
        setBusy(true);
        try {
            const name = newName.trim();
            const separateNow = newSeparate && serverKind !== "aiometadata";
            const next = await api.addHouseholdUser(userId, {
                history: newHistory,
                name,
                pin: newPin.trim() || null,
                ...(separateNow ? { separate: true } : {}),
            });
            setProfiles(next.profiles);
            toast.success(
                next.tracked
                    ? `${name} added and tracked`
                    : `${name} added - sign them in to track them`
            );
            setAdding(false);
            setNewName("");
            setNewPin("");
            setNewHistory("own");
            setNewSeparate(false);
            // Their address is what they need next: show it.
            if (separateNow) {
                const h = await load();
                const added = h?.profiles.find((p) => p.name === name);
                if (added) {
                    setAddressFor(added);
                }
            }
        } catch (e: any) {
            toast.error(e?.message || "Could not add them");
        } finally {
            setBusy(false);
        }
    };

    const submitPin = async (value: string | null) => {
        if (!pinFor) {
            return;
        }
        setBusy(true);
        try {
            const next = await api.setHouseholdPin(pinFor.id, value);
            setProfiles(next.profiles);
            toast.success(value ? `${pinFor.name}'s PIN changed` : `${pinFor.name} has no PIN now`);
            if (!next.tracked) {
                toast.error(`Sign ${pinFor.name} in again to keep tracking them`);
            }
            setPinFor(null);
            setChangedPin("");
        } catch (e: any) {
            toast.error(e?.message || "Could not change the PIN");
        } finally {
            setBusy(false);
        }
    };

    // Keep someone separate, stop, or renew their address. The address window
    // comes back afterwards, showing what it is now.
    const changeAddress = async (p: HouseholdProfile, mode: "on" | "off" | "renew") => {
        setBusy(true);
        try {
            const next = await api.setHouseholdPersonalAddress(p.id, mode);
            setProfiles(next.profiles);
            setPersonal((prev) => ({ ...prev, [p.id]: next.personal }));
            toast.success(
                mode === "off"
                    ? `${p.name} is no longer kept separate`
                    : mode === "renew"
                      ? `${p.name} has a new address`
                      : `${p.name} is kept separate`
            );
        } catch (e: any) {
            toast.error(e?.message || "Could not change that");
        } finally {
            setBusy(false);
            setPending(null);
            setAddressFor(p);
        }
    };

    const askAddress = (p: HouseholdProfile, mode: "off" | "renew") => {
        setAddressFor(null);
        setPending(
            mode === "off"
                ? {
                      back: () => setAddressFor(p),
                      confirmText: "Stop keeping separate",
                      description: `${p.name} shows up with everyone else again, and their own sign-in address stops working. Anyone using it has to sign in at the usual address instead.`,
                      run: () => changeAddress(p, "off"),
                      title: `Stop keeping ${p.name} separate?`,
                      variant: "warning",
                  }
                : {
                      back: () => setAddressFor(p),
                      confirmText: "New address",
                      description: `${p.name} gets a new sign-in address. The old one stops working, so give them the new one and they have to sign in again with it.`,
                      run: () => changeAddress(p, "renew"),
                      title: `Give ${p.name} a new address?`,
                      variant: "warning",
                  }
        );
    };

    const copyAddress = async (url: string) => {
        if (await copyToClipboard(url)) {
            toast.success("Address copied");
        } else {
            toast.error("Could not copy - select the address and copy it by hand");
        }
    };

    if (!profiles || (profiles.length === 0 && !canManage)) {
        return null;
    }
    // Only AIOStreams has personal addresses; the sign-in must give SlickSync the configuration.
    const canSeparate = canManage && serverKind !== "aiometadata";
    const addressInfo = addressFor ? personal[addressFor.id] : undefined;

    const sel = profiles.find((p) => p.id === selected) || null;
    const tracked = profiles.filter((p) => p.status === "tracked").length;
    const isOpen = embedded || open;

    const body = (
        <>
            {embedded ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h4 className="truncate font-semibold text-default text-sm">{personName}</h4>
                    <Badge
                        size="sm"
                        variant={kindLabel === "AIOMetadata" ? "aiometadata" : "aiostreams"}
                    >
                        {kindLabel}
                    </Badge>
                    <span className="text-muted text-xs">
                        {profiles.length} {profiles.length === 1 ? "profile" : "profiles"} ·{" "}
                        {tracked} tracked with {personName}
                    </span>
                </div>
            ) : (
                <div className="flex items-center gap-3">
                    <button
                        aria-expanded={open}
                        className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
                        onClick={() => {
                            setOpen((o) => !o);
                            closeMenu();
                        }}
                        type="button"
                    >
                        <div className="min-w-0">
                            <h3 className="font-semibold text-base text-default">
                                {kindLabel} household{" "}
                                <span className="font-normal text-muted">· {personName}</span>
                            </h3>
                            <p className="mt-0.5 text-muted text-xs">
                                {open
                                    ? `Everyone else on ${personName}'s ${kindLabel} sign-in counts as ${personName} until you separate them`
                                    : `${profiles.length} ${profiles.length === 1 ? "profile" : "profiles"} · ${tracked} tracked with ${personName}`}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            {!open && (
                                <span className="flex items-center gap-1.5">
                                    {profiles.slice(0, 6).map((p) => (
                                        <Mark key={p.id} profile={p} size={26} />
                                    ))}
                                </span>
                            )}
                            <ChevronDownIcon
                                className="h-5 w-5 text-muted transition-transform"
                                style={{ transform: open ? "rotate(180deg)" : "none" }}
                            />
                        </div>
                    </button>
                    {open && (
                        <Link
                            aria-label="How households work"
                            className="shrink-0 text-muted transition-colors hover:text-default"
                            href="/guides/add-jellyfin-account"
                            title="How households work"
                        >
                            <QuestionMarkCircleIcon className="h-5 w-5" />
                        </Link>
                    )}
                </div>
            )}

            {isOpen && (
                <div
                    className={`${embedded ? "mt-3" : "mt-5"} grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6`}
                >
                    {profiles.map((p) => {
                        const isSelected = p.id === selected;
                        const caption =
                            p.status === "own"
                                ? p.person?.username || "Its own person"
                                : p.status === "tracked"
                                  ? `With ${personName}`
                                  : p.status === "untracked"
                                    ? "Not tracked"
                                    : p.status === "needs-pin"
                                      ? "Needs its PIN"
                                      : "Needs the password";
                        return (
                            // The tile, and its Limits pill under it - beside it rather than
                            // inside, since the tile is a button itself.
                            <div
                                className="flex min-w-0 flex-col items-center gap-1.5 pb-2"
                                key={p.id}
                            >
                                <button
                                    aria-expanded={isSelected}
                                    aria-haspopup="menu"
                                    className={`group flex w-full min-w-0 flex-col items-center gap-2 rounded-2xl px-2 pt-4 pb-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                        isSelected
                                            ? "bg-surface-hover ring-1 ring-primary/50"
                                            : "hover:bg-surface-hover"
                                    }`}
                                    data-household-tile
                                    onClick={(e) => openMenu(p.id, e.currentTarget)}
                                    type="button"
                                >
                                    <span
                                        className="relative transition-transform group-hover:scale-105"
                                        data-household-circle
                                    >
                                        <Mark profile={p} size={64} />
                                        {p.status === "untracked" && (
                                            <span className="absolute inset-0 flex items-center justify-center">
                                                <EyeSlashIcon className="h-6 w-6 text-muted" />
                                            </span>
                                        )}
                                        {(p.status === "needs-pin" ||
                                            p.status === "needs-sign-in") && (
                                            <span className="absolute inset-0 flex items-center justify-center">
                                                <KeyIcon className="h-6 w-6 text-muted" />
                                            </span>
                                        )}
                                    </span>
                                    <span className="max-w-full truncate font-medium text-default text-sm">
                                        {p.name}
                                    </span>
                                    <span className="inline-flex max-w-full items-center truncate rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-muted">
                                        {caption}
                                    </span>
                                </button>
                                {p.limitId && (
                                    <LimitsButton
                                        id={p.limitId}
                                        name={p.name}
                                        summary={limits?.[p.limitId] || null}
                                    />
                                )}
                            </div>
                        );
                    })}
                    {canManage && (
                        <button
                            className="group flex flex-col items-center gap-2 rounded-2xl px-2 py-4 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => {
                                closeMenu();
                                setAdding(true);
                            }}
                            type="button"
                        >
                            <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-default border-dashed text-muted transition-colors group-hover:text-default">
                                <PlusIcon className="h-6 w-6" />
                            </span>
                            <span className="font-medium text-default text-sm">Add</span>
                            <span className="inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-muted">
                                Household user
                            </span>
                        </button>
                    )}
                </div>
            )}

            {sel &&
                placement &&
                typeof document !== "undefined" &&
                createPortal(
                    <motion.div
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        className="fixed z-[9999] rounded-2xl border border-default bg-surface p-1.5 shadow-2xl backdrop-blur-xl"
                        initial={{ opacity: 0, scale: 0.97, y: placement.above ? 4 : -4 }}
                        ref={popoverRef}
                        role="menu"
                        style={{
                            bottom: placement.bottom,
                            left: placement.left,
                            top: placement.top,
                            transformOrigin: `${placement.arrowX}px ${placement.above ? "100%" : "0%"}`,
                            width: POPOVER_WIDTH,
                        }}
                        transition={{ duration: 0.12 }}
                    >
                        <span
                            aria-hidden
                            className="absolute h-3 w-3 rotate-45 border-default bg-surface"
                            style={{
                                left: placement.arrowX - 6,
                                ...(placement.above
                                    ? { borderBottomWidth: 1, borderRightWidth: 1, bottom: -6 }
                                    : { borderLeftWidth: 1, borderTopWidth: 1, top: -6 }),
                            }}
                        />
                        <div className="mb-1 border-default border-b px-3 pt-2 pb-2">
                            <p className="truncate font-semibold text-default text-sm">
                                {sel.name}
                            </p>
                            <p className="mt-0.5 text-muted text-xs">
                                {STATUS_TEXT[sel.status]}
                                {personal[sel.id]?.separate ? " · Kept separate" : ""}
                            </p>
                        </div>
                        {sel.status === "tracked" && (
                            <button
                                autoFocus
                                className={MENU_ITEM}
                                onClick={() => {
                                    closeMenu();
                                    separate(sel);
                                }}
                            >
                                <UserPlusIcon className="h-4 w-4 text-muted" /> Separate
                            </button>
                        )}
                        {sel.status === "own" && (
                            <button
                                autoFocus
                                className={MENU_ITEM}
                                onClick={() => {
                                    closeMenu();
                                    mergeBack(sel);
                                }}
                            >
                                <ArrowsPointingInIcon className="h-4 w-4 text-muted" />{" "}
                                <span className="truncate">Merge back into {personName}</span>
                            </button>
                        )}
                        {sel.status === "tracked" && (
                            <button
                                className={MENU_ITEM}
                                onClick={() => {
                                    closeMenu();
                                    stopTracking(sel);
                                }}
                            >
                                <EyeSlashIcon className="h-4 w-4 text-muted" /> Stop tracking
                            </button>
                        )}
                        {sel.status === "untracked" && (
                            <button
                                autoFocus
                                className={MENU_ITEM}
                                onClick={() =>
                                    perform(
                                        () => api.trackHouseholdProfile(sel.id, true),
                                        `${sel.name} is tracked again`
                                    )
                                }
                            >
                                <EyeIcon className="h-4 w-4 text-muted" /> Track it again
                            </button>
                        )}
                        {(sel.status === "needs-pin" || sel.status === "needs-sign-in") && (
                            <button
                                autoFocus
                                className={MENU_ITEM}
                                onClick={() => {
                                    closeMenu();
                                    setSigningIn(sel);
                                }}
                            >
                                <KeyIcon className="h-4 w-4 text-muted" /> Sign in
                            </button>
                        )}
                        {canPin && (
                            <button
                                className={MENU_ITEM}
                                onClick={() => {
                                    closeMenu();
                                    setPinFor(sel);
                                }}
                            >
                                <LockClosedIcon className="h-4 w-4 text-muted" /> Change PIN
                            </button>
                        )}
                        {canSeparate && (
                            <button
                                className={MENU_ITEM}
                                onClick={() => {
                                    closeMenu();
                                    setAddressFor(sel);
                                }}
                            >
                                <LinkIcon className="h-4 w-4 text-muted" /> Own sign-in address
                            </button>
                        )}
                        {sel.status === "own" && sel.person && (
                            <Link
                                className={MENU_ITEM}
                                href={`/users/${sel.person.id}`}
                                onClick={closeMenu}
                            >
                                <ArrowTopRightOnSquareIcon className="h-4 w-4 text-muted" /> Open{" "}
                                {sel.person.username}
                            </Link>
                        )}
                    </motion.div>,
                    document.body
                )}

            <ConfirmModal
                confirmText={pending?.confirmText}
                description={pending?.description || ""}
                isLoading={busy}
                isOpen={!!pending}
                onClose={() => {
                    if (!busy) {
                        pending?.back?.();
                        setPending(null);
                    }
                }}
                onConfirm={() => {
                    pending?.run();
                }}
                title={pending?.title || ""}
                variant={pending?.variant || "default"}
            />

            <Modal
                isOpen={adding}
                onClose={() => {
                    if (!busy) {
                        setAdding(false);
                    }
                }}
                title={`Add someone to ${personName}'s ${kindLabel}`}
            >
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        submitAdd();
                    }}
                >
                    <p className="text-muted text-sm">
                        They show up in every {kindLabel} and Jellyfin app signed in to this
                        configuration, and are tracked here with {personName} straight away.
                    </p>
                    <div>
                        <label
                            className="mb-2 block font-medium text-default text-sm"
                            htmlFor="household-new-name"
                        >
                            Name
                        </label>
                        <input
                            className="w-full rounded-xl px-4 py-3 text-sm"
                            id="household-new-name"
                            maxLength={32}
                            onChange={(e) => setNewName(e.target.value)}
                            style={{
                                background: "var(--color-bg)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            value={newName}
                        />
                    </div>
                    {canPin && (
                        <div>
                            <label
                                className="mb-2 block font-medium text-default text-sm"
                                htmlFor="household-new-pin"
                            >
                                PIN{" "}
                                <span className="font-normal text-muted">
                                    (optional, 4 to 12 digits)
                                </span>
                            </label>
                            <input
                                autoComplete="new-password"
                                className="w-full rounded-xl px-4 py-3 text-sm"
                                id="household-new-pin"
                                inputMode="numeric"
                                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                                style={{
                                    background: "var(--color-bg)",
                                    border: "1px solid var(--color-surface-border)",
                                    color: "var(--color-text)",
                                }}
                                type="password"
                                value={newPin}
                            />
                        </div>
                    )}
                    {serverKind !== "aiometadata" && (
                        <div className="space-y-2">
                            <p className="font-medium text-default text-sm">History</p>
                            {(
                                [
                                    [
                                        "own",
                                        "Their own",
                                        "Their own Continue Watching and watched marks, and their own trackers.",
                                    ],
                                    [
                                        "shared",
                                        `Shared with ${personName}`,
                                        `One history with ${personName}, using ${personName}'s trackers.`,
                                    ],
                                ] as const
                            ).map(([value, label, hint]) => (
                                <label
                                    className="flex cursor-pointer items-start gap-2 text-sm"
                                    key={value}
                                >
                                    <input
                                        aria-label={label}
                                        checked={newHistory === value}
                                        className="mt-1"
                                        name="household-history"
                                        onChange={() => setNewHistory(value)}
                                        type="radio"
                                    />
                                    <span>
                                        <span className="text-default">{label}</span>
                                        <span className="block text-muted text-xs">{hint}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}
                    {serverKind !== "aiometadata" && (
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="font-medium text-default text-sm">
                                    Keep this person separate
                                </p>
                                <p className="mt-0.5 text-muted text-xs">
                                    They get a sign-in address of their own and see nobody else.
                                    Others don&apos;t see them either.
                                </p>
                            </div>
                            <ToggleSwitch
                                checked={newSeparate}
                                className="mt-0.5 shrink-0"
                                disabled={busy}
                                onChange={() => setNewSeparate((v) => !v)}
                                title="Keep this person separate"
                            />
                        </div>
                    )}
                    <div className="flex justify-end gap-3">
                        <Button
                            disabled={busy}
                            onClick={() => setAdding(false)}
                            type="button"
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={!newName.trim()}
                            isLoading={busy}
                            type="submit"
                            variant="primary"
                        >
                            Add
                        </Button>
                    </div>
                </form>
            </Modal>

            <Modal
                isOpen={!!pinFor}
                onClose={() => {
                    if (!busy) {
                        setPinFor(null);
                    }
                }}
                title={pinFor ? `${pinFor.name}'s PIN` : ""}
            >
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        submitPin(changedPin.trim());
                    }}
                >
                    <p className="text-muted text-sm">
                        The new PIN works in every app straight away. SlickSync signs {pinFor?.name}{" "}
                        in once with it to keep tracking them.
                    </p>
                    <div>
                        <label
                            className="mb-2 block font-medium text-default text-sm"
                            htmlFor="household-change-pin"
                        >
                            New PIN <span className="font-normal text-muted">(4 to 12 digits)</span>
                        </label>
                        <input
                            autoComplete="new-password"
                            className="w-full rounded-xl px-4 py-3 text-sm"
                            id="household-change-pin"
                            inputMode="numeric"
                            onChange={(e) => setChangedPin(e.target.value.replace(/\D/g, ""))}
                            style={{
                                background: "var(--color-bg)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            type="password"
                            value={changedPin}
                        />
                    </div>
                    <div className="flex flex-wrap justify-between gap-3">
                        <Button
                            disabled={busy}
                            onClick={() => submitPin(null)}
                            type="button"
                            variant="ghost"
                        >
                            Remove the PIN
                        </Button>
                        <div className="flex gap-3">
                            <Button
                                disabled={busy}
                                onClick={() => setPinFor(null)}
                                type="button"
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                            <Button
                                disabled={changedPin.trim().length < 4}
                                isLoading={busy}
                                type="submit"
                                variant="primary"
                            >
                                Change PIN
                            </Button>
                        </div>
                    </div>
                </form>
            </Modal>

            <Modal
                isOpen={!!addressFor}
                onClose={() => {
                    if (!busy) {
                        setAddressFor(null);
                    }
                }}
                title={addressFor ? `${addressFor.name}'s own sign-in address` : ""}
            >
                <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <p className="font-medium text-default text-sm">
                                Keep this person separate
                            </p>
                            <p className="mt-0.5 text-muted text-xs">
                                {addressFor?.name} gets a sign-in address of their own and sees
                                nobody else in their apps. Nobody else sees them either.
                            </p>
                        </div>
                        <ToggleSwitch
                            checked={!!addressInfo?.separate}
                            className="mt-0.5 shrink-0"
                            disabled={busy}
                            onChange={() => {
                                if (addressFor) {
                                    if (addressInfo?.separate) {
                                        askAddress(addressFor, "off");
                                    } else {
                                        changeAddress(addressFor, "on");
                                    }
                                }
                            }}
                            title="Keep this person separate"
                        />
                    </div>
                    {addressInfo?.separate && addressInfo.url && (
                        <div className="space-y-2">
                            <label
                                className="block font-medium text-default text-sm"
                                htmlFor="household-own-address"
                            >
                                Their address
                            </label>
                            <input
                                className="w-full rounded-xl px-4 py-3 text-sm"
                                id="household-own-address"
                                onFocus={(e) => e.currentTarget.select()}
                                readOnly
                                style={{
                                    background: "var(--color-bg)",
                                    border: "1px solid var(--color-surface-border)",
                                    color: "var(--color-text)",
                                }}
                                value={addressInfo.url}
                            />
                            <div className="flex flex-wrap gap-3">
                                <Button
                                    disabled={busy}
                                    onClick={() => copyAddress(addressInfo.url!)}
                                    type="button"
                                    variant="secondary"
                                >
                                    Copy
                                </Button>
                                <Button
                                    disabled={busy}
                                    onClick={() => addressFor && askAddress(addressFor, "renew")}
                                    type="button"
                                    variant="ghost"
                                >
                                    New address
                                </Button>
                            </div>
                        </div>
                    )}
                    {addressInfo?.separate && !addressInfo.url && (
                        <div className="space-y-2">
                            <p className="text-muted text-xs">
                                They are kept separate in AIOStreams but have no address of their
                                own yet.
                            </p>
                            <Button
                                isLoading={busy}
                                onClick={() => addressFor && changeAddress(addressFor, "renew")}
                                type="button"
                                variant="secondary"
                            >
                                Give them an address
                            </Button>
                        </div>
                    )}
                    <p className="text-muted text-xs">
                        At their address they still sign in with the setup&apos;s password. If this
                        AIOStreams allows PIN sign-in and their PIN has 6 or more digits, the PIN
                        alone is enough. A new address, or switching this off, stops the old address
                        working.
                    </p>
                    <div className="flex justify-end gap-3">
                        <Button
                            disabled={busy}
                            onClick={() => setAddressFor(null)}
                            type="button"
                            variant="secondary"
                        >
                            Done
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={!!signingIn}
                onClose={() => {
                    if (!busy) {
                        setSigningIn(null);
                    }
                }}
                title={signingIn ? `Sign in ${signingIn.name}` : ""}
            >
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        submitSignIn();
                    }}
                >
                    <p className="text-muted text-sm">
                        {signingIn?.status === "needs-pin"
                            ? `${signingIn?.name} has a PIN. Enter the configuration password and their PIN once, and SlickSync keeps a sign-in for them - neither is stored.`
                            : `Enter the configuration password once, and SlickSync keeps a sign-in for ${signingIn?.name} - the password is not stored.`}
                    </p>
                    <div>
                        <label
                            className="mb-2 block font-medium text-default text-sm"
                            htmlFor="household-password"
                        >
                            Configuration password
                        </label>
                        <input
                            autoComplete="current-password"
                            className="w-full rounded-xl px-4 py-3 text-sm"
                            id="household-password"
                            onChange={(e) => setPassword(e.target.value)}
                            style={{
                                background: "var(--color-bg)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            type="password"
                            value={password}
                        />
                    </div>
                    {signingIn?.status === "needs-pin" && (
                        <div>
                            <label
                                className="mb-2 block font-medium text-default text-sm"
                                htmlFor="household-pin"
                            >
                                {signingIn.name}&apos;s PIN
                            </label>
                            <input
                                autoComplete="off"
                                className="w-full rounded-xl px-4 py-3 text-sm"
                                id="household-pin"
                                inputMode="numeric"
                                onChange={(e) => setPin(e.target.value)}
                                style={{
                                    background: "var(--color-bg)",
                                    border: "1px solid var(--color-surface-border)",
                                    color: "var(--color-text)",
                                }}
                                type="password"
                                value={pin}
                            />
                        </div>
                    )}
                    <div className="flex justify-end gap-3">
                        <Button
                            disabled={busy}
                            onClick={() => setSigningIn(null)}
                            type="button"
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                        <Button isLoading={busy} type="submit" variant="primary">
                            Sign in
                        </Button>
                    </div>
                </form>
            </Modal>
        </>
    );

    return embedded ? <div>{body}</div> : <Card padding="lg">{body}</Card>;
}

/**
 * Everyone's AIOStreams and AIOMetadata household profiles in one card, the
 * way "Nuvio profiles" is one card: collapsed by default, each person's
 * household its own section inside. Shows only when someone has a household.
 */
export function HouseholdsCard({
    owners,
    onPeopleChanged,
    limits,
}: {
    owners: { id: string; name: string; kindLabel: string }[];
    onPeopleChanged?: () => void;
    limits?: Record<string, LimitsSummary>;
}) {
    const [open, setOpen] = useState(false);
    const [manageable, setManageable] = useState<Record<string, boolean>>({});
    const [byOwner, setByOwner] = useState<Record<string, HouseholdProfile[]>>(() =>
        Object.fromEntries(
            owners.map((o) => [
                o.id,
                api.peekGet<{ profiles: HouseholdProfile[] }>(
                    `/jellyfin/users/${encodeURIComponent(o.id)}/household`
                )?.profiles ?? [],
            ])
        )
    );
    const ownerKey = owners.map((o) => o.id).join(",");
    useEffect(() => {
        let live = true;
        Promise.all(
            owners.map((o) =>
                api
                    .getHousehold(o.id)
                    .then((h) => [o.id, h.profiles || [], !!h.canManage] as const)
                    .catch(() => [o.id, [] as HouseholdProfile[], false] as const)
            )
        ).then((rows) => {
            if (!live) {
                return;
            }
            setByOwner(Object.fromEntries(rows.map(([id, profiles]) => [id, profiles])));
            setManageable(Object.fromEntries(rows.map(([id, , can]) => [id, can])));
        });
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ownerKey]);
    const update = useCallback((id: string, profiles: HouseholdProfile[]) => {
        setByOwner((prev) => (prev[id] === profiles ? prev : { ...prev, [id]: profiles }));
    }, []);

    const withHousehold = owners.filter(
        (o) => (byOwner[o.id] || []).length > 0 || manageable[o.id]
    );
    if (withHousehold.length === 0) {
        return null;
    }
    const all = withHousehold.flatMap((o) => byOwner[o.id]);

    return (
        <Card padding="lg">
            <div className="flex items-center gap-3">
                <button
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
                    onClick={() => setOpen((o) => !o)}
                    type="button"
                >
                    <div className="min-w-0">
                        <h3 className="font-semibold text-base text-default">
                            AIOStreams &amp; AIOMetadata profiles
                        </h3>
                        <p className="mt-0.5 truncate text-muted text-xs">
                            {open
                                ? "Everyone else on an AIOStreams or AIOMetadata sign-in counts as that person until you separate them"
                                : `${all.length} ${all.length === 1 ? "profile" : "profiles"} · ${withHousehold.length === 1 ? withHousehold[0].name : `${withHousehold.length} people`}`}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        {!open && (
                            <span className="flex items-center gap-1.5">
                                {all.slice(0, 6).map((p) => (
                                    <Mark key={p.id} profile={p} size={26} />
                                ))}
                            </span>
                        )}
                        <ChevronDownIcon
                            className="h-5 w-5 text-muted transition-transform"
                            style={{ transform: open ? "rotate(180deg)" : "none" }}
                        />
                    </div>
                </button>
                {open && (
                    <Link
                        aria-label="How households work"
                        className="shrink-0 text-muted transition-colors hover:text-default"
                        href="/guides/add-jellyfin-account"
                        title="How households work"
                    >
                        <QuestionMarkCircleIcon className="h-5 w-5" />
                    </Link>
                )}
            </div>
            {open && (
                <div className="mt-5 space-y-6">
                    {withHousehold.map((o) => (
                        <HouseholdCard
                            embedded
                            key={o.id}
                            kindLabel={o.kindLabel}
                            limits={limits}
                            onPeopleChanged={onPeopleChanged}
                            onProfilesChanged={(p) => update(o.id, p)}
                            personName={o.name}
                            userId={o.id}
                        />
                    ))}
                </div>
            )}
        </Card>
    );
}
