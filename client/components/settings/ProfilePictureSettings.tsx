"use client";

import { UserCircleIcon } from "@heroicons/react/24/outline";
import type { ComponentProps, ReactNode } from "react";
import { Avatar, Button, Card } from "@/components/ui";

// Keep the account picture and its action identical for both account roles.
export function ProfilePictureSettings({
    onChange,
    children,
    ...avatar
}: Omit<ComponentProps<typeof Avatar>, "size"> & { onChange: () => void; children?: ReactNode }) {
    return (
        <Card padding="lg">
            <div className="mb-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                    <UserCircleIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h3 className="font-display font-semibold text-base text-default">
                        Profile Picture
                    </h3>
                    <p className="text-muted text-xs">Shown on your account button and its menu</p>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <Avatar {...avatar} size="xl" />
                <div className="flex-1">
                    <Button onClick={onChange} size="sm" variant="secondary">
                        Change Picture
                    </Button>
                    <p className="mt-2 text-muted text-xs">
                        Choose an avatar, upload an image, or paste a link.
                    </p>
                </div>
            </div>
            {children}
        </Card>
    );
}
