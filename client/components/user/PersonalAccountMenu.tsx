"use client";

import { useEffect, useState } from "react";
import { PanelSwitcher } from "@/components/layout/PanelSwitcher";
import { Avatar, Modal } from "@/components/ui";
import { useUserAuth } from "@/lib/hooks/useUserAuth";
import { type PersonalProfile, personalProfiles, userAuth } from "@/lib/user-api";
import { usePersonalPreferences } from "./PersonalPreferences";

export function PersonalAccountMenu({ onLogout }: { onLogout: () => void }) {
    const { userInfo, userId, authKey, provider } = useUserAuth();
    const { preferences } = usePersonalPreferences();
    const [profiles, setProfiles] = useState<PersonalProfile[]>([]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        if (provider !== "nuvio" || !userId || !authKey) {
            return;
        }
        personalProfiles
            .list(userId, authKey)
            .then((data) => {
                if (!active) {
                    return;
                }
                const choices = Array.isArray(data.profiles) ? data.profiles : [];
                setProfiles(choices);
                const stored = JSON.parse(localStorage.getItem("slicksync-user-auth") || "{}");
                if (choices.length > 1 && !stored.profileSelected) {
                    setOpen(true);
                }
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [provider, userId, authKey]);
    const select = async (profile: PersonalProfile) => {
        if (!(userId && authKey) || busy) {
            return;
        }
        setBusy(true);
        setError("");
        try {
            const session = await personalProfiles.switch(userId, authKey, profile.id);
            const info = await userAuth.getUserInfo(session.userId, session.sessionToken);
            // Reload every personal view after selecting an identity so no previous
            // profile's in-memory library, history or preferences can carry over.
            localStorage.setItem(
                "slicksync-user-auth",
                JSON.stringify({
                    authKey: session.sessionToken,
                    profileSelected: true,
                    provider: "nuvio",
                    userId: session.userId,
                    userInfo: info,
                })
            );
            window.location.assign(new URL("/user", window.location.origin).href);
        } catch (error) {
            setError(error instanceof Error ? error.message : "Could not switch profiles");
            setBusy(false);
        }
    };
    const close = () => {
        if (busy) {
            return;
        }
        const stored = JSON.parse(localStorage.getItem("slicksync-user-auth") || "{}");
        localStorage.setItem(
            "slicksync-user-auth",
            JSON.stringify({ ...stored, profileSelected: true })
        );
        setOpen(false);
    };
    return (
        <>
            <PanelSwitcher
                align="right"
                dropdownPosition="down"
                mode="user"
                onLogout={onLogout}
                onSwitchProfile={profiles.length > 1 ? () => setOpen(true) : undefined}
                userInfo={
                    preferences.hideSensitive && userInfo ? { ...userInfo, email: "" } : userInfo
                }
                variant="compact"
            />
            <Modal
                description="Choose one of your profiles registered with SlickSync."
                isOpen={open}
                onClose={close}
                size="md"
                title="Who's watching?"
            >
                <div className="grid grid-cols-2 gap-3">
                    {profiles.map((profile) => (
                        <button
                            aria-label={`Use ${profile.username} profile`}
                            className="interface-panel flex flex-col items-center gap-3 rounded-2xl p-5 transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                            disabled={busy}
                            key={profile.id}
                            onClick={() => select(profile)}
                            type="button"
                        >
                            <Avatar
                                colorIndex={profile.colorIndex}
                                name={profile.username}
                                size="xl"
                                src={profile.avatarUrl || undefined}
                            />
                            <span className="break-words font-semibold text-default text-sm">
                                {profile.username}
                            </span>
                            <span className="text-muted text-xs">
                                {profile.id === userId
                                    ? "Current profile"
                                    : `Profile ${profile.nuvioProfileId}`}
                            </span>
                        </button>
                    ))}
                </div>
                {busy && (
                    <p className="mt-4 text-muted text-sm" role="status">
                        Opening your profile...
                    </p>
                )}
                {error && (
                    <p className="mt-4 text-error text-sm" role="alert">
                        {error}
                    </p>
                )}
            </Modal>
        </>
    );
}
