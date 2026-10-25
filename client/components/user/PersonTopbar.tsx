"use client";

// A person's own pages get the same top bar as the admin pages (NebulaBar),
// with their own rows - Home, Library, Activity, Addons, Shares, Settings -
// instead of the side menu they used to have. Addons is left out for
// Jellyfin, AIOStreams and AIOMetadata people, who have no addon list here.

import {
    ClockIcon,
    Cog6ToothIcon,
    FilmIcon,
    HomeIcon,
    MagnifyingGlassIcon,
    PuzzlePieceIcon,
    ShareIcon,
} from "@heroicons/react/24/outline";
import { NebulaBar, type NebulaNavSection } from "@/components/layout/NebulaBar";
import { useUserAuth } from "@/lib/hooks/useUserAuth";
import { useUserMobileMenu } from "@/lib/hooks/useUserMobileMenu";
import { PersonalAccountMenu } from "./PersonalAccountMenu";

const ITEMS: NebulaNavSection["items"] = [
    { href: "/user", icon: HomeIcon, label: "Home" },
    { href: "/user/discover", icon: MagnifyingGlassIcon, label: "Discover" },
    { href: "/user/library", icon: FilmIcon, label: "Library" },
    { href: "/user/activity", icon: ClockIcon, label: "Activity" },
    { href: "/user/addons", icon: PuzzlePieceIcon, label: "Addons" },
    { href: "/user/shares", icon: ShareIcon, label: "Shares" },
    { href: "/user/settings", icon: Cog6ToothIcon, label: "Settings" },
];

export function PersonTopbar() {
    const { logout, provider } = useUserAuth();
    const menu = useUserMobileMenu();
    const sections: NebulaNavSection[] = [
        {
            id: "person",
            items: ITEMS.filter((item) => provider !== "jellyfin" || item.href !== "/user/addons"),
        },
    ];

    const handleLogout = () => {
        logout();
        window.location.href = "/login?mode=user";
    };

    return (
        <NebulaBar
            account={<PersonalAccountMenu onLogout={handleLogout} />}
            homeHref="/user"
            menu={menu}
            sections={sections}
        />
    );
}
