"use client";

import { useDroppable } from "@dnd-kit/core";
import {
    ChartBarIcon,
    ClockIcon,
    Cog6ToothIcon,
    DocumentTextIcon,
    EnvelopeIcon,
    HomeIcon,
    MagnifyingGlassIcon,
    PuzzlePieceIcon,
    QueueListIcon,
    RectangleStackIcon,
    ShieldCheckIcon,
    UserGroupIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SIDEBAR_ADDONS_DROPZONE_ID } from "@/components/providers/VaultDragContext";
import { SlickSyncLogo } from "@/components/ui/SlickSyncLogo";
import { api } from "@/lib/api";
import { PanelSwitcher } from "./PanelSwitcher";

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

// Navigation structure with grouped sections
const navigationSections = [
    {
        id: "overview",
        items: [
            { href: "/", icon: HomeIcon, name: "Dashboard" },
            { href: "/discover", icon: MagnifyingGlassIcon, name: "Discover" },
            { href: "/catalogs", icon: RectangleStackIcon, name: "Catalogs" },
            { href: "/activity", icon: ClockIcon, name: "Activity" },
            { href: "/metrics", icon: ChartBarIcon, name: "Metrics" },
        ],
        label: "Overview",
    },
    {
        id: "management",
        items: [
            { href: "/users", icon: UsersIcon, name: "Users" },
            { href: "/groups", icon: UserGroupIcon, name: "Groups" },
            { href: "/addons", icon: PuzzlePieceIcon, name: "Addons" },
            { href: "/vault", icon: ShieldCheckIcon, name: "Vault" },
            { href: "/invitations", icon: EnvelopeIcon, name: "Invitations" },
        ],
        label: "Management",
    },
    {
        id: "system",
        items: [
            { href: "/tasks", icon: QueueListIcon, name: "Tasks" },
            { href: "/settings", icon: Cog6ToothIcon, name: "Settings" },
            { href: "/changelog", icon: DocumentTextIcon, name: "Changelog" },
        ],
        label: "System",
    },
];

interface NavItemProps {
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    index: number;
    isActive: boolean;
    name: string;
    onNavigate?: () => void;
}

function NavItem({ name, href, icon: Icon, isActive, index, onNavigate }: NavItemProps) {
    const isAddonsLink = href === "/addons";
    const { setNodeRef, isOver } = useDroppable({
        disabled: !isAddonsLink,
        id: SIDEBAR_ADDONS_DROPZONE_ID,
    });

    return (
        <motion.div
            animate={{ opacity: 1, x: 0 }}
            initial={{ opacity: 0, x: -20 }}
            ref={isAddonsLink ? setNodeRef : undefined}
            transition={{ delay: index * 0.03 }}
        >
            <Link
                className={`nav-item-hover-pill group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 ${isActive ? "text-primary" : "text-muted"} ${isOver ? "side-link-over" : ""}`}
                href={href}
                onClick={onNavigate}
                style={{
                    transition: "background 0.15s ease, box-shadow 0.15s ease",
                }}
            >
                {isActive && (
                    <span
                        aria-hidden
                        className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
                        style={{ background: "var(--color-primary)" }}
                    />
                )}

                <Icon className="nav-item-icon relative z-10 h-[18px] w-[18px] transition-colors" />
                <span
                    className={`nav-item-label relative z-10 font-display font-medium text-base transition-colors ${isActive ? "text-default" : ""}`}
                    style={{ fontWeight: isActive ? 600 : 500 }}
                >
                    {name}
                </span>
                {isOver && (
                    <span
                        className="relative z-10 ml-auto font-medium text-xs"
                        style={{ color: "var(--color-primary)" }}
                    >
                        Drop to move
                    </span>
                )}
            </Link>
        </motion.div>
    );
}

interface NavSectionProps {
    children: React.ReactNode;
    delay?: number;
    label: string;
}

function NavSection({ label, children, delay = 0 }: NavSectionProps) {
    return (
        <motion.div
            animate={{ opacity: 1 }}
            className="space-y-0.5"
            initial={{ opacity: 0 }}
            transition={{ delay }}
        >
            <h3
                className="px-3 py-2 font-semibold text-xs uppercase tracking-wider"
                style={{ color: "var(--color-text-subtle)" }}
            >
                {label}
            </h3>
            {children}
        </motion.div>
    );
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
    const pathname = usePathname();
    const _router = useRouter();
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
    }, []);

    const isItemActive = (href: string) => {
        if (href === "/") {
            return pathname === "/";
        }
        return pathname === href || pathname.startsWith(`${href}/`);
    };

    // Ends the session on the server too (api.logout) - dropping the local
    // token alone left the cookies, and so the session, alive.
    const handleLogout = async () => {
        await api.logout();
        window.location.href = "/login?mode=admin";
    };

    const handleNavigate = () => {
        if (onClose) {
            onClose();
        }
    };

    let globalIndex = 0;

    return (
        <>
            {/* Mobile Backdrop */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 z-40 bg-black/50 md:hidden"
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        onClick={onClose}
                        transition={{ duration: 0.2 }}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <motion.aside
                animate={{ x: 0 }}
                className={`interface-sidebar fixed top-0 bottom-0 left-0 z-50 flex w-60 flex-col md:z-40 md:flex md:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
                initial={{ x: -280 }}
                style={{
                    background: "var(--interface-material)",
                    borderRight: "1px solid var(--color-surface-border)",
                    boxShadow: "4px 0 24px -12px rgba(0,0,0,0.5)",
                }}
                transition={{ damping: 30, stiffness: 300, type: "spring" }}
            >
                {/* Mobile Close Button */}
                <div className="flex items-center justify-between p-4 md:hidden">
                    <span className="font-medium text-muted text-sm">Menu</span>
                    <button
                        aria-label="Close navigation"
                        className="rounded-lg p-2 transition-colors hover:bg-surface-hover"
                        onClick={onClose}
                        type="button"
                    >
                        <XMarkIcon className="h-5 w-5 text-muted" />
                    </button>
                </div>

                {/* Logo */}
                <div
                    className="hidden p-5 md:block"
                    style={{ borderBottom: "1px solid var(--color-surface-border)" }}
                >
                    <Link className="flex items-center gap-3" href="/">
                        <motion.div
                            className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl"
                            style={{
                                background: "var(--color-primary)",
                                boxShadow: "0 8px 24px -6px var(--color-primary)",
                            }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ rotate: 3, scale: 1.08 }}
                        >
                            <SlickSyncLogo className="h-10 w-10" />
                        </motion.div>
                        <div>
                            <h1
                                className="font-bold font-display text-2xl tracking-tight"
                                style={{
                                    background:
                                        "linear-gradient(135deg, var(--color-text) 0%, var(--color-primary) 100%)",
                                    backgroundClip: "text",
                                    WebkitBackgroundClip: "text",
                                    WebkitTextFillColor: "transparent",
                                }}
                            >
                                SlickSync
                            </h1>
                        </div>
                    </Link>
                </div>

                {/* Navigation Sections. overscroll-contain stops scroll chaining -
            without it, dragging past this list's own top/bottom edge (or
            even a small drag when there's barely anything to scroll)
            hands the gesture off to whatever scrollable ancestor is next,
            which on mobile meant the page underneath took over mid-drag
            even with the body-scroll lock in place (that lock stops the
            page from scrolling on its own, but doesn't stop an in-progress
            touch gesture from chaining into it once this list runs out of
            room to move). Confirmed live: touching over the nav and
            dragging moved the page instead once the list had little/no
            room left to scroll in that direction. */}
                <nav className="custom-scrollbar flex-1 space-y-5 overflow-y-auto overscroll-contain p-3">
                    {navigationSections.map((section, sectionIndex) => (
                        <NavSection
                            delay={sectionIndex * 0.1}
                            key={section.id}
                            label={section.label}
                        >
                            {section.items.map((item) => {
                                const itemIndex = globalIndex++;
                                return (
                                    <NavItem
                                        href={item.href}
                                        icon={item.icon}
                                        index={itemIndex}
                                        isActive={isItemActive(item.href)}
                                        key={item.href}
                                        name={item.name}
                                        onNavigate={handleNavigate}
                                    />
                                );
                            })}
                        </NavSection>
                    ))}
                </nav>

                {/* Version */}
                <div
                    className="mt-auto flex items-center justify-center px-4 py-2"
                    style={{ borderTop: "1px solid var(--color-surface-border)" }}
                >
                    <span
                        className="font-medium text-[10px] tracking-wide"
                        style={{ color: "var(--color-text-subtle)" }}
                    >
                        v{(process.env.NEXT_PUBLIC_APP_VERSION as string) || "dev"}
                    </span>
                </div>

                {/* Panel Switcher - TorBox referral moved into its dropdown (System
            group, alongside Tasks/Settings/Themes/Changelog) instead of
            floating here as its own badge - one stable spot instead of a
            positioning pass on every layout. */}
                <div
                    className="flex flex-col items-start gap-2 p-3"
                    style={{ borderTop: "1px solid var(--color-surface-border)" }}
                >
                    <div className="w-full min-w-0">
                        <PanelSwitcher
                            mode="admin"
                            onLogout={handleLogout}
                            userInfo={accountInfo}
                        />
                    </div>
                </div>
            </motion.aside>
        </>
    );
}
