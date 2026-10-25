"use client";

import {
    BookOpenIcon,
    ChartBarIcon,
    ClockIcon,
    Cog6ToothIcon,
    EnvelopeIcon,
    HomeIcon,
    MagnifyingGlassIcon,
    PuzzlePieceIcon,
    QueueListIcon,
    RectangleStackIcon,
    ShieldCheckIcon,
    UserGroupIcon,
    UsersIcon,
} from "@heroicons/react/24/outline";
import { type ReactNode, useEffect, useState } from "react";
import { useMobileMenu } from "@/app/(admin)/AdminClientLayout";
import { TopbarActions } from "@/components/layout/TopbarActions";
import { api } from "@/lib/api";
import { NebulaBar, type NebulaNavSection } from "./NebulaBar";
import { PanelSwitcher } from "./PanelSwitcher";

// Navigation keeps the same destinations as the sidebar. Account and system
// actions remain available through PanelSwitcher in both layouts.
const NEBULA_NAV_SECTIONS: NebulaNavSection[] = [
    {
        id: "overview",
        items: [
            { href: "/", icon: HomeIcon, label: "Dashboard" },
            { href: "/activity", icon: ClockIcon, label: "Activity" },
            { href: "/metrics", icon: ChartBarIcon, label: "Metrics" },
            { href: "/discover", icon: MagnifyingGlassIcon, label: "Discover" },
            { href: "/catalogs", icon: RectangleStackIcon, label: "Catalogs" },
        ],
    },
    {
        id: "management",
        items: [
            { href: "/users", icon: UsersIcon, label: "Users" },
            { href: "/groups", icon: UserGroupIcon, label: "Groups" },
            { href: "/addons", icon: PuzzlePieceIcon, label: "Addons" },
            { href: "/vault", icon: ShieldCheckIcon, label: "Vault" },
            { href: "/invitations", icon: EnvelopeIcon, label: "Invitations" },
        ],
    },
    {
        id: "system",
        items: [
            { href: "/tasks", icon: QueueListIcon, label: "Tasks" },
            { href: "/settings", icon: Cog6ToothIcon, label: "Settings" },
            { href: "/guides", icon: BookOpenIcon, label: "Guides" },
        ],
    },
];

/** The admin pages' bar: their nav rows, and the admin account button. */
export function NebulaTopbar() {
    // Reuses the same open/close state Original layout's Sidebar drawer
    // already gets from AdminClientLayout - the two never render at once.
    const menu = useMobileMenu();
    // Mirrors Sidebar.tsx's own account-info fetch - Nebula's topbar had no
    // equivalent of the sidebar's bottom "Administrator" panel switcher at
    // all, so there was no way to see who's logged in, switch to the User
    // panel, or log out from this layout.
    const [accountInfo, setAccountInfo] = useState<{
        username?: string;
        email?: string | null;
        uuid?: string | null;
        linkedProvider?: "stremio" | "nuvio" | null;
        avatarUrl?: string | null;
    } | null>(null);
    const isPublicInstance = (process.env.NEXT_PUBLIC_INSTANCE_TYPE || "private") === "public";

    useEffect(() => {
        api.getAccountStats()
            .then((stats) => {
                const uuid = stats.uuid || null;
                const email = stats.email || null;
                setAccountInfo({
                    avatarUrl: stats.avatarUrl || null,
                    email,
                    linkedProvider: stats.linkedProvider || null,
                    username: isPublicInstance ? uuid || email || "Admin" : "Administrator",
                    uuid,
                });
            })
            .catch(() => undefined);
    }, [isPublicInstance]);

    // Ends the session on the server too (api.logout) - dropping the local
    // token alone left the cookies, and so the session, alive.
    const handleLogout = async () => {
        await api.logout();
        window.location.href = "/login?mode=admin";
    };

    return (
        <NebulaBar
            account={
                <PanelSwitcher
                    align="right"
                    dropdownPosition="down"
                    mode="admin"
                    onLogout={handleLogout}
                    userInfo={accountInfo}
                    variant="compact"
                />
            }
            homeHref="/"
            menu={menu}
            sections={NEBULA_NAV_SECTIONS}
        />
    );
}

/** Page identity and actions share a stable, left-aligned reading axis. */
export function NebulaPageHeading({
    title,
    subtitle,
    actions,
    stats,
    leading,
}: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    stats?: ReactNode;
    leading?: ReactNode;
}) {
    return (
        <div className="interface-heading flex flex-col gap-5">
            {leading && <div className="flex items-center">{leading}</div>}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="font-display text-default">{title}</h1>
                    {subtitle && <p className="mt-2 text-muted text-sm">{subtitle}</p>}
                </div>
                <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-3">
                    {actions}
                    <TopbarActions />
                </div>
            </div>
            {stats && <div className="flex items-center">{stats}</div>}
        </div>
    );
}

// Compact inline KPI strip for NebulaPageHeading's `stats` slot - a row of
// separate NebulaCompactStatCards with a gap between them (same individual-
// card look Groups/Users use in their own stat row), not one shared pill.
// An earlier version used one continuous box with divide-x border lines
// between segments, which read as visually different from - and less
// polished than - the separate-card look everywhere else Nebula's compact
// stats show up.
export function NebulaHeaderStats({
    stats,
}: {
    stats: Array<{ label: string; value: string | number; icon?: ReactNode }>;
}) {
    return (
        // On a phone, an even full-width row of three - the same as the stat row
        // on Users and Groups - rather than cards shrunk to their text.
        <div className="grid w-full grid-cols-3 gap-2 md:flex md:w-auto md:items-center md:gap-4">
            {stats.map((s, i) => (
                <NebulaCompactStatCard
                    colorIndex={i}
                    icon={s.icon}
                    key={s.label}
                    label={s.label}
                    value={s.value}
                />
            ))}
        </div>
    );
}

// Retain the shared exports used by page layouts. Content panels are solid;
// translucency belongs to the floating navigation, not every nested card.
export const NEBULA_GLASS_CLASS = "interface-panel relative rounded-2xl overflow-hidden";
export const nebulaGlassStyle: React.CSSProperties = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-surface-border)",
};

/** Kept as a no-op for pages that still include the former accent stripe. */
export function NebulaGlassStripe() {
    return null;
}

// Nebula's stat-card equivalent of Current mode's <StatCard> - same
// label/value/icon shape, so other pages can swap between the two based on
// layoutMode without restructuring the surrounding grid. Icon color
// alternates primary/secondary by index so a row of these doesn't read as
// one flat block of a single hue.
export function NebulaStatCard({
    label,
    value,
    icon,
    colorIndex = 0,
}: {
    label: string;
    value: string | number;
    icon?: ReactNode;
    colorIndex?: number;
}) {
    const isPrimary = colorIndex % 2 === 0;
    return (
        <div
            className={`${NEBULA_GLASS_CLASS} flex items-center justify-between p-5`}
            style={nebulaGlassStyle}
        >
            <NebulaGlassStripe />
            <div>
                <p className="mb-1 text-muted text-sm">{label}</p>
                <p className="interface-stat-value font-semibold text-3xl text-default">{value}</p>
            </div>
            {icon && (
                <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                    style={{
                        background: isPrimary
                            ? "var(--color-primary-muted)"
                            : "var(--color-secondary-muted)",
                        color: isPrimary ? "var(--color-primary)" : "var(--color-secondary)",
                    }}
                >
                    {icon}
                </div>
            )}
        </div>
    );
}

/** Quiet summaries leave the management list as the main content. */
export function NebulaCompactStatCard({
    label,
    value,
    icon,
}: {
    label: string;
    value: string | number;
    icon?: ReactNode;
    colorIndex?: number;
}) {
    return (
        <dl className="interface-compact-stat">
            {icon && (
                <span aria-hidden="true" className="interface-compact-stat-icon">
                    {icon}
                </span>
            )}
            <div className="min-w-0">
                <dt className="text-muted text-xs">{label}</dt>
                <dd className="interface-stat-value mt-1 font-semibold text-2xl text-default">
                    {value}
                </dd>
            </div>
        </dl>
    );
}
