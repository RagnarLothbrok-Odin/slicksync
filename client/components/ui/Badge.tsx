"use client";

import clsx from "clsx";
import { JellyfinLogo } from "@/components/jellyfin/JellyfinLogo";

export type BadgeVariant =
    | "default"
    | "primary"
    | "secondary"
    | "success"
    | "warning"
    | "error"
    | "aurora"
    | "cyan"
    | "neutral"
    | "outline"
    | "muted"
    | "stremio"
    | "nuvio"
    | "jellyfin"
    | "aiostreams"
    | "aiometadata";
type BadgeSize = "sm" | "md";

interface BadgeProps {
    children: React.ReactNode;
    className?: string;
    icon?: React.ReactNode;
    pulse?: boolean;
    size?: BadgeSize;
    title?: string;
    variant?: BadgeVariant;
}

const sizeStyles: Record<BadgeSize, string> = {
    md: "px-2.5 py-1 text-xs",
    sm: "px-2 py-0.5 text-[10px]",
};

// Get badge styles based on variant using CSS variables
function getBadgeStyles(variant: BadgeVariant) {
    switch (variant) {
        case "primary":
        case "aurora": // Legacy
            return {
                background: "var(--color-primaryMuted)",
                borderColor: "transparent",
                color: "var(--color-primary)",
            };
        case "secondary":
        case "cyan": // Legacy
            return {
                background: "var(--color-secondaryMuted)",
                borderColor: "transparent",
                color: "var(--color-secondary)",
            };
        case "success":
            return {
                background: "var(--color-successMuted)",
                borderColor: "transparent",
                color: "var(--color-success)",
            };
        case "warning":
            return {
                background: "var(--color-warningMuted)",
                borderColor: "transparent",
                color: "var(--color-warning)",
            };
        case "error":
            return {
                background: "var(--color-errorMuted)",
                borderColor: "transparent",
                color: "var(--color-error)",
            };
        case "outline":
            return {
                background: "transparent",
                borderColor: "var(--color-surface-border)",
                color: "var(--color-text-muted)",
            };
        case "muted":
            return {
                background: "var(--color-bg-muted)",
                borderColor: "transparent",
                color: "var(--color-text-subtle)",
            };
        // Fixed colors, independent of the active theme - these are provider
        // identity badges (purple = Stremio, blue = Nuvio everywhere else in
        // the Stremio/Nuvio ecosystem), so they should stay recognizable
        // rather than shifting with --color-primary/--color-secondary (which
        // can end up nearly identical on themes like Ember, making the two
        // provider badges indistinguishable from each other).
        case "stremio":
            return {
                background: "rgba(167, 139, 250, 0.15)",
                borderColor: "rgba(167, 139, 250, 0.25)",
                color: "rgb(196, 181, 253)",
            };
        case "nuvio":
            // Two-tone Nuvio identity: blue and orange, split by a diagonal `/`
            // instead of a straight vertical line. Angle steepened from 90deg to
            // 115deg so the boundary reads as a slash on the pill's wide-thin
            // aspect ratio (a mathematical 45deg gradient would look near-flat
            // horizontal on a pill this shape).
            return {
                background:
                    "linear-gradient(115deg, rgba(56, 89, 158, 0.22) 0%, rgba(56, 89, 158, 0.22) 50%, rgba(255, 152, 0, 0.10) 50%, rgba(255, 152, 0, 0.10) 100%)",
                borderColor: "rgba(255, 152, 0, 0.18)",
                color: "rgb(186, 208, 240)",
            };
        case "jellyfin":
            // A real Jellyfin server: teal.
            return {
                background:
                    "linear-gradient(115deg, rgba(20, 184, 166, 0.20) 0%, rgba(34, 211, 238, 0.14) 100%)",
                borderColor: "rgba(45, 212, 191, 0.28)",
                color: "rgb(153, 246, 228)",
            };
        case "aiostreams":
            // AIOStreams' media server, in the Catalogs tile's look: dark navy with
            // the Jellyfin purple-to-blue edge (the text is drawn two-tone below).
            return {
                background:
                    "linear-gradient(rgba(0, 11, 37, 0.94), rgba(6, 16, 46, 0.94)) padding-box, linear-gradient(115deg, rgba(170, 92, 195, 0.75), rgba(0, 164, 220, 0.75)) border-box",
                borderColor: "transparent",
                color: "rgb(212, 208, 255)",
            };
        case "aiometadata":
            // AIOMetadata's media server: rose.
            return {
                background:
                    "linear-gradient(115deg, rgba(244, 63, 94, 0.18) 0%, rgba(236, 72, 153, 0.14) 100%)",
                borderColor: "rgba(251, 113, 133, 0.28)",
                color: "rgb(254, 205, 211)",
            };
        default:
            return {
                background: "var(--color-bg-muted)",
                borderColor: "transparent",
                color: "var(--color-text-muted)",
            };
    }
}

function getPulseColor(variant: BadgeVariant) {
    switch (variant) {
        case "primary":
        case "aurora":
            return "var(--color-primary)";
        case "secondary":
        case "cyan":
            return "var(--color-secondary)";
        case "success":
            return "var(--color-success)";
        case "warning":
            return "var(--color-warning)";
        case "error":
            return "var(--color-error)";
        default:
            return "var(--color-text-muted)";
    }
}

export function Badge({
    children,
    variant = "default",
    size = "sm",
    pulse = false,
    icon,
    className,
    title,
}: BadgeProps) {
    const styles = getBadgeStyles(variant);
    const pulseColor = getPulseColor(variant);

    // Check if bg-surface-hover, bg-surface, bg-page, or bg-subtle is in className and override background
    const hasSurfaceHoverBg = className?.includes("bg-surface-hover");
    const hasSurfaceBg = className?.includes("bg-surface");
    const hasPageBg = className?.includes("bg-page");
    const hasSubtleBg = className?.includes("bg-subtle");

    let finalStyles = styles;
    if (hasSurfaceHoverBg) {
        finalStyles = { ...styles, background: "var(--color-surface-hover)" };
    } else if (hasSurfaceBg) {
        finalStyles = { ...styles, background: "var(--color-surface)" };
    } else if (hasPageBg) {
        finalStyles = { ...styles, background: "var(--color-bg)" };
    } else if (hasSubtleBg) {
        finalStyles = { ...styles, background: "var(--color-bg-subtle)" };
    }

    return (
        <span
            className={clsx(
                "inline-flex items-center gap-1 rounded-full border font-medium",
                sizeStyles[size],
                className
            )}
            style={finalStyles}
            title={title}
        >
            {pulse && (
                <span className="relative flex h-1.5 w-1.5">
                    <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                        style={{ background: pulseColor }}
                    />
                    <span
                        className="relative inline-flex h-1.5 w-1.5 rounded-full"
                        style={{ background: pulseColor }}
                    />
                </span>
            )}
            {icon}
            {variant === "aiostreams" && children === "AIOStreams" ? (
                // The Jellyfin mark, then "AIO" light and "Streams" indigo, as on Catalogs.
                <>
                    <JellyfinLogo size={size === "sm" ? 10 : 12} />
                    <span>
                        <span style={{ color: "rgb(212, 208, 255)" }}>AIO</span>
                        <span style={{ color: "rgb(159, 146, 255)" }}>Streams</span>
                    </span>
                </>
            ) : (
                children
            )}
        </span>
    );
}

// Resource badge for addon types
interface ResourceBadgeProps {
    resource: string;
    size?: "sm" | "md";
}

export function ResourceBadge({ resource, size = "sm" }: ResourceBadgeProps) {
    return (
        <Badge size={size} variant="secondary">
            {resource}
        </Badge>
    );
}

// Status badge
interface StatusBadgeProps {
    status: "active" | "inactive" | "expired" | "pending" | "syncing";
}

const statusConfig: Record<string, { variant: BadgeVariant; label: string; pulse?: boolean }> = {
    active: { label: "Active", variant: "success" },
    expired: { label: "Expired", variant: "error" },
    inactive: { label: "Inactive", variant: "default" },
    pending: { label: "Pending", pulse: true, variant: "warning" },
    syncing: { label: "Syncing", pulse: true, variant: "secondary" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
    const config = statusConfig[status];
    return (
        <Badge pulse={config.pulse} variant={config.variant}>
            {config.label}
        </Badge>
    );
}

// Version badge for addons
interface VersionBadgeProps {
    className?: string;
    size?: "sm" | "md";
    version: string;
}

export function VersionBadge({ version, size = "sm", className }: VersionBadgeProps) {
    return (
        <Badge className={`whitespace-nowrap ${className || ""}`} size={size} variant="primary">
            v{version}
        </Badge>
    );
}
