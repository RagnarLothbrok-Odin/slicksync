"use client";

import clsx from "clsx";
// Only MD5 is needed (Gravatar addresses); importing the whole library put
// every cipher it ships in the shared bundle.
import md5 from "crypto-js/md5";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { diceBearUrl } from "@/lib/dicebear";
import { avatarThumbUrl } from "@/lib/posterUrl";
import { UserAvatar } from "./UserAvatar";

interface AvatarProps {
    avatarClassName?: string;
    className?: string;
    colorIndex?: number;
    email?: string;
    fallbackIcon?: React.ReactNode;
    imgClassName?: string;
    name: string;
    showRing?: boolean;
    size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
    src?: string;
    status?: "online" | "offline" | "away";
    /** Look the email up on Gravatar. Only for a person who switched that on - the lookup sends a hash of their email to Gravatar. */
    useGravatar?: boolean;
}

const sizes = {
    "2xl": "w-24 h-24 text-4xl",
    lg: "w-12 h-12 text-lg",
    md: "w-10 h-10 text-base",
    sm: "w-8 h-8 text-sm",
    xl: "w-16 h-16 text-xl",
    xs: "w-6 h-6 text-xs",
};

// Just the text-size portion of each size, for the initials fallback on the
// inner element — dimensions themselves live only on the outer wrapper now
// (see Avatar component) so there's a single source of truth for box size.
const textSizes = {
    "2xl": "text-4xl",
    lg: "text-lg",
    md: "text-base",
    sm: "text-sm",
    xl: "text-xl",
    xs: "text-xs",
};

// Theme-based avatar styles using variations of primary and secondary colors
const avatarStyles = [
    // Primary variations
    {
        background: "color-mix(in srgb, var(--color-primary) 100%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 80%, white) 0%, var(--color-primary) 100%)",
    },
    {
        background: "color-mix(in srgb, var(--color-primary) 75%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 55%, white) 0%, color-mix(in srgb, var(--color-primary) 85%, white) 100%)",
    },
    {
        background: "color-mix(in srgb, var(--color-primary) 50%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 30%, white) 0%, color-mix(in srgb, var(--color-primary) 70%, white) 100%)",
    },
    {
        background: "color-mix(in srgb, var(--color-primary) 25%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 10%, white) 0%, color-mix(in srgb, var(--color-primary) 40%, white) 100%)",
    },
    // Secondary variations
    {
        background: "color-mix(in srgb, var(--color-secondary) 100%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-secondary) 80%, white) 0%, var(--color-secondary) 100%)",
    },
    {
        background: "color-mix(in srgb, var(--color-secondary) 75%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-secondary) 55%, white) 0%, color-mix(in srgb, var(--color-secondary) 85%, white) 100%)",
    },
    {
        background: "color-mix(in srgb, var(--color-secondary) 50%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-secondary) 30%, white) 0%, color-mix(in srgb, var(--color-secondary) 70%, white) 100%)",
    },
    {
        background: "color-mix(in srgb, var(--color-secondary) 25%, white)",
        gradient:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-secondary) 10%, white) 0%, color-mix(in srgb, var(--color-secondary) 40%, white) 100%)",
    },
];

// Fixed colours on top of the theme shades - the same whatever the theme.
// Their own numbers (from FIXED_COLOR_BASE), so every colorIndex saved before
// they existed keeps meaning the theme shade it always did.
export const FIXED_COLOR_BASE = 100;
const fixedColors: { name: string; hex: string }[] = [
    { hex: "#dc2626", name: "Red" },
    { hex: "#ea580c", name: "Orange" },
    { hex: "#d97706", name: "Amber" },
    { hex: "#16a34a", name: "Green" },
    { hex: "#059669", name: "Emerald" },
    { hex: "#0d9488", name: "Teal" },
    { hex: "#0891b2", name: "Cyan" },
    { hex: "#2563eb", name: "Blue" },
    { hex: "#4f46e5", name: "Indigo" },
    { hex: "#7c3aed", name: "Violet" },
    { hex: "#c026d3", name: "Magenta" },
    { hex: "#db2777", name: "Pink" },
];
const fixedStyles = fixedColors.map(({ hex }) => ({
    background: hex,
    gradient: `linear-gradient(135deg, color-mix(in srgb, ${hex} 75%, white) 0%, ${hex} 100%)`,
}));
const THEME_NAMES = [
    "Your theme",
    "Your theme, lighter",
    "Your theme, light",
    "Your theme, palest",
    "Your accent",
    "Your accent, lighter",
    "Your accent, light",
    "Your accent, palest",
];

/** The style a colorIndex draws: a fixed colour from FIXED_COLOR_BASE up, otherwise a theme shade. */
function styleFor(colorIndex: number) {
    if (colorIndex >= FIXED_COLOR_BASE) {
        return fixedStyles[(colorIndex - FIXED_COLOR_BASE) % fixedStyles.length];
    }
    return avatarStyles[Math.abs(colorIndex) % avatarStyles.length];
}

/** The solid colour a colorIndex stands for - for things drawn flat in it (a catalog's cover). */
export function avatarColorFill(colorIndex: number): string {
    return styleFor(colorIndex).background;
}

/** Every colour a person or group can be, as the colorIndex to save. */
export const AVATAR_COLORS: {
    index: number;
    name: string;
    gradient: string;
    group: "theme" | "fixed";
}[] = [
    ...avatarStyles.map((st, i) => ({
        gradient: st.gradient,
        group: "theme" as const,
        index: i,
        name: THEME_NAMES[i],
    })),
    ...fixedStyles.map((st, i) => ({
        gradient: st.gradient,
        group: "fixed" as const,
        index: FIXED_COLOR_BASE + i,
        name: fixedColors[i].name,
    })),
];

/** Whether a saved colorIndex is this swatch (old theme numbers past 7 wrap, as they always drew). */
export function isSameAvatarColor(saved: number, index: number): boolean {
    if (saved >= FIXED_COLOR_BASE || index >= FIXED_COLOR_BASE) {
        return saved === index;
    }
    return Math.abs(saved) % avatarStyles.length === index;
}

/**
 * The colours a colorIndex can be, as one row of round swatches - for every
 * picker that sets one. Drawn from the same list as the avatar itself, so
 * what is picked is what shows. (Group dialogs once had a separate list of
 * fixed colours whose positions meant different shades here: red came out
 * teal.) Your theme's colour and accent first, then the fixed colours. The
 * paler theme shades aren't offered any more, but one already in use shows
 * first, so the current colour is always there and picked.
 */
const OFFERED_THEME = [0, 4];
export function AvatarColorSwatches({
    value,
    onChange,
}: {
    value: number;
    onChange: (colorIndex: number) => void;
}) {
    const offered = AVATAR_COLORS.filter(
        (c) => c.group === "fixed" || OFFERED_THEME.includes(c.index)
    );
    const current = AVATAR_COLORS.find(
        (c) =>
            c.group === "theme" &&
            !OFFERED_THEME.includes(c.index) &&
            isSameAvatarColor(value, c.index)
    );
    const swatches = current ? [current, ...offered] : offered;
    return (
        <div className="flex flex-wrap gap-2">
            {swatches.map((c) => {
                const picked = isSameAvatarColor(value, c.index);
                return (
                    <button
                        aria-label={c.name}
                        aria-pressed={picked}
                        className={`h-8 w-8 rounded-full transition-transform ${picked ? "swatch-picked" : ""}`}
                        key={c.index}
                        onClick={() => onChange(c.index)}
                        style={{
                            background: c.gradient,
                            transform: picked ? "scale(1.15)" : "scale(1)",
                        }}
                        title={c.name}
                        type="button"
                    />
                );
            })}
        </div>
    );
}

function getStyleIndex(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Theme shades only: an avatar nobody chose a colour for follows the theme.
    return Math.abs(hash) % avatarStyles.length;
}

function getInitials(name: string): string {
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function getGravatarUrl(email: string | null | undefined, size = 128): string | null {
    if (!email) {
        return null;
    }

    // Normalize email: trim and convert to lowercase
    const normalizedEmail = email.trim().toLowerCase();

    // Generate MD5 hash using crypto-js
    const hash = md5(normalizedEmail).toString();

    // Construct Gravatar URL
    // Using d=404 means Gravatar will return 404 error if no image exists, triggering fallback
    return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}

export function Avatar({
    name,
    src,
    email,
    useGravatar = false,
    size = "md",
    showRing = false,
    status,
    colorIndex,
    fallbackIcon,
    className,
    imgClassName,
    avatarClassName,
}: AvatarProps) {
    const initials = getInitials(name);
    const style = styleFor(
        colorIndex !== undefined && colorIndex !== null ? colorIndex : getStyleIndex(name)
    );

    const [gravatarSrc, setGravatarSrc] = useState<string | undefined>(undefined);
    const [imageError, setImageError] = useState(false);
    const [generatedError, setGeneratedError] = useState(false);

    useEffect(() => {
        // Without the person's say-so nothing is sent to Gravatar at all.
        if (!(email && useGravatar)) {
            setGravatarSrc(undefined);
            return;
        }

        // Generate gravatar URL
        const url = getGravatarUrl(email, 128);
        setGravatarSrc(url || undefined);
    }, [email, useGravatar]);

    // Small sizes render a static, resized copy - see avatarThumbUrl.
    const primarySrc = src ? avatarThumbUrl(src, size) : gravatarSrc;
    // Hash the identity locally so the public avatar service never receives
    // names or email addresses. A fixed style version keeps defaults stable.
    const seed = md5(
        `slicksync-avatar:${email?.trim().toLowerCase() || ""}:${name.trim().toLowerCase()}`
    ).toString();
    const backgrounds = [
        "e8ecff",
        "d5f2e8",
        "fce7d5",
        "f6dfe9",
        "dceafa",
        "fff0ba",
        "c7c9d1",
        "bde7f0",
    ];
    const background = backgrounds[Number.parseInt(seed.slice(0, 2), 16) % backgrounds.length];
    const generatedSrc = fallbackIcon ? undefined : diceBearUrl("voxel-bot", seed, background);
    const finalSrc = imageError ? generatedSrc : primarySrc || generatedSrc;
    const showImage = !!finalSrc && !(finalSrc === generatedSrc && generatedError);
    const isGenerated = finalSrc === generatedSrc;

    useEffect(() => {
        setImageError(false);
        setGeneratedError(false);
    }, [primarySrc, generatedSrc]);

    return (
        <div className={clsx("relative inline-flex rounded-full", sizes[size], className)}>
            {/* Keyed on what it draws, so a new colour is a new element. A page
          first shows the copy of a group or person it saw last, then the
          fresh one; page-recolouring browser extensions keep the inline
          background they already rewrote on an element, so a group set to
          red stayed purple on its own page while the list showed red. */}
            <motion.div
                className={clsx(
                    "relative flex h-full w-full items-center justify-center overflow-hidden rounded-full font-semibold",
                    textSizes[size],
                    avatarClassName
                )}
                key={showImage ? "picture" : style.gradient}
                style={{
                    background: showImage && !isGenerated ? undefined : style.gradient,
                    boxShadow: showRing
                        ? "0 0 0 2px var(--color-primary-muted), 0 0 0 4px var(--color-bg)"
                        : "0 0 0 2px var(--color-surface-border)",
                    color: "white",
                    textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                }}
                whileHover={{ scale: 1.05 }}
            >
                {showImage ? (
                    <img
                        alt={name}
                        className={clsx("h-full w-full object-cover", imgClassName)}
                        decoding="async"
                        loading="lazy"
                        onError={() => {
                            console.warn("[Avatar] Failed to load image, using the next fallback");
                            if (isGenerated) {
                                setGeneratedError(true);
                            } else {
                                setImageError(true);
                            }
                        }}
                        referrerPolicy="no-referrer"
                        role="img"
                        src={finalSrc}
                    />
                ) : fallbackIcon ? (
                    <div className="flex h-full w-full items-center justify-center">
                        {fallbackIcon}
                    </div>
                ) : (
                    <span aria-label={`Avatar for ${name}`} role="img">
                        {initials}
                    </span>
                )}
            </motion.div>

            {status && (
                <span
                    className={clsx(
                        "absolute right-0 bottom-0 block rounded-full",
                        size === "xs" || size === "sm" ? "h-2 w-2" : "h-3 w-3"
                    )}
                    key={status}
                    style={{
                        background:
                            status === "online"
                                ? "var(--color-success)"
                                : status === "away"
                                  ? "var(--color-warning)"
                                  : "var(--color-text-subtle)",
                        boxShadow: "0 0 0 2px var(--color-bg)",
                    }}
                />
            )}
        </div>
    );
}

// Avatar group for stacking
interface AvatarGroupProps {
    max?: number;
    size?: "xs" | "sm" | "md";
    users: { name: string; id: string; src?: string; email?: string; useGravatar?: boolean }[];
}

export function AvatarGroup({ users, max = 4, size = "sm" }: AvatarGroupProps) {
    const displayed = users.slice(0, max);
    const remaining = users.length - max;

    return (
        <div className="flex -space-x-2">
            {displayed.map((user, i) => (
                <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    className="relative"
                    initial={{ opacity: 0, x: -10 }}
                    key={user.id || i}
                    style={{ zIndex: displayed.length - i }}
                    transition={{ delay: i * 0.05 }}
                >
                    <UserAvatar
                        email={user.email}
                        name={user.name}
                        showRing
                        size={size}
                        src={user.src}
                        useGravatar={user.useGravatar}
                        userId={user.id}
                    />
                </motion.div>
            ))}
            {remaining > 0 && (
                <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    className={clsx(
                        "relative flex items-center justify-center rounded-full font-medium",
                        sizes[size]
                    )}
                    initial={{ opacity: 0, x: -10 }}
                    style={{
                        background: "var(--color-surface)",
                        border: "2px solid var(--color-bg)",
                        color: "var(--color-text-muted)",
                    }}
                    transition={{ delay: displayed.length * 0.05 }}
                >
                    +{remaining}
                </motion.div>
            )}
        </div>
    );
}
