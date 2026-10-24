"use client";

import { useEffect, useState } from "react";
import { useUserCache } from "@/components/providers/UserCacheProvider";
import { Avatar } from "@/components/ui";

interface UserAvatarProps {
    avatarClassName?: string;
    className?: string;
    colorIndex?: number;
    email?: string;
    imgClassName?: string;
    name?: string;
    showRing?: boolean;
    size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
    src?: string;
    status?: "online" | "offline" | "away";
    useGravatar?: boolean;
    userId: string;
}

export function UserAvatar({
    userId,
    name,
    email: providedEmail,
    src,
    useGravatar,
    size = "md",
    showRing = false,
    status,
    colorIndex: providedColorIndex,
    className,
    imgClassName,
    avatarClassName,
}: UserAvatarProps) {
    const { getUser, fetchUser } = useUserCache();
    const [userData, setUserData] = useState<{
        name: string;
        email?: string;
        colorIndex?: number;
    } | null>(null);
    const [_isLoading, setIsLoading] = useState(!providedEmail);

    useEffect(() => {
        // If email is provided, use it directly
        if (providedEmail) {
            setUserData({
                colorIndex: providedColorIndex,
                email: providedEmail,
                name: name || "Unknown",
            });
            setIsLoading(false);
            return;
        }

        // Otherwise, try to get from cache or fetch
        const loadUser = async () => {
            // Check cache first
            const cached = getUser(userId);
            if (cached) {
                setUserData(cached);
                setIsLoading(false);
                return;
            }

            // Fetch from API
            const fetched = await fetchUser(userId);
            if (fetched) {
                setUserData(fetched);
            } else {
                // Fallback to provided name or unknown
                setUserData({
                    colorIndex: providedColorIndex,
                    email: undefined,
                    name: name || "Unknown",
                });
            }
            setIsLoading(false);
        };

        loadUser();
    }, [userId, name, providedEmail, providedColorIndex, getUser, fetchUser]);

    const displayName = userData?.name || name || "Unknown";
    const email = userData?.email || providedEmail;
    const colorIdx = userData?.colorIndex ?? providedColorIndex;

    return (
        <Avatar
            avatarClassName={avatarClassName}
            className={className}
            colorIndex={colorIdx}
            email={email}
            imgClassName={imgClassName}
            name={displayName}
            showRing={showRing}
            size={size}
            src={src}
            status={status}
            useGravatar={useGravatar}
        />
    );
}
