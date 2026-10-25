"use client";

// "Notifications on this device", on a person's own Settings page. Off until
// they turn it on; then this device is told when their sign-in stops working
// (with a tap straight to signing in again), ten minutes before a daily limit
// or bedtime pauses their streaming, and when it does. Their devices only -
// the admin's push is separate (server: PersonPushSubscription), so turning
// this off removes this person's registration and never unsubscribes the
// browser itself, which the admin may also be using on this device.

import { useEffect, useState } from "react";
import { SettingRow, ToggleSwitch } from "@/components/settings/SettingRow";
import { urlBase64ToUint8Array } from "@/components/ui/PushNotificationToggle";
import { toast } from "@/components/ui/Toast";
import { userPush } from "@/lib/user-api";

export function PersonPushRow({
    userId,
    authKey,
}: {
    userId: string | null;
    authKey: string | null;
}) {
    const [supported, setSupported] = useState<boolean | null>(null);
    const [available, setAvailable] = useState<boolean | null>(null);
    const [on, setOn] = useState(false);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const refresh = () => setRevision((value) => value + 1);
        window.addEventListener("personal-devices-changed", refresh);
        return () => window.removeEventListener("personal-devices-changed", refresh);
    }, []);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const ok =
            typeof window !== "undefined" &&
            "serviceWorker" in navigator &&
            "PushManager" in window &&
            "Notification" in window;
        setSupported(ok);
        if (!(ok && userId && authKey)) {
            return;
        }
        (async () => {
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                const sub = await reg?.pushManager.getSubscription();
                const status = await userPush.status(userId, authKey, sub?.endpoint);
                setAvailable(status.enabled && !!status.publicKey);
                setOn(status.subscribed && Notification.permission === "granted");
            } catch {
                setAvailable(false);
            }
        })();
    }, [userId, authKey, revision]);

    const turnOn = async () => {
        if (!(userId && authKey)) {
            return;
        }
        setBusy(true);
        try {
            const status = await userPush.status(userId, authKey);
            if (!(status.enabled && status.publicKey)) {
                throw new Error("Notifications aren’t available on this server");
            }
            if ((await Notification.requestPermission()) !== "granted") {
                throw new Error("Notifications are blocked for this site in your browser");
            }
            const reg = await navigator.serviceWorker.register("/sw.js");
            await navigator.serviceWorker.ready;
            const sub =
                (await reg.pushManager.getSubscription()) ||
                (await reg.pushManager.subscribe({
                    applicationServerKey: urlBase64ToUint8Array(status.publicKey),
                    userVisibleOnly: true,
                }));
            await userPush.subscribe(userId, authKey, sub.toJSON());
            setOn(true);
            window.dispatchEvent(new Event("personal-devices-changed"));
            toast.success("Notifications are on for this device");
        } catch (e) {
            toast.error((e as Error)?.message || "Could not turn notifications on");
        } finally {
            setBusy(false);
        }
    };

    const turnOff = async () => {
        if (!(userId && authKey)) {
            return;
        }
        setBusy(true);
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) {
                await userPush.unsubscribe(userId, authKey, sub.endpoint);
            }
            setOn(false);
            window.dispatchEvent(new Event("personal-devices-changed"));
            toast.success("Notifications are off for this device");
        } catch (e) {
            toast.error((e as Error)?.message || "Could not turn notifications off");
        } finally {
            setBusy(false);
        }
    };

    // Nothing to offer: say so only when the browser is the reason.
    if (supported === null || (supported && available === false)) {
        return null;
    }

    return (
        <SettingRow
            description={
                supported
                    ? "If your sign-in stops working, and before a daily limit or bedtime pauses your streaming."
                    : "This browser cannot show notifications. On an iPhone, add SlickSync to your Home Screen first."
            }
            label="Notifications on this device"
        >
            {supported && (
                <div className="flex shrink-0 items-center gap-3">
                    <span className={`font-medium text-sm ${on ? "text-success" : "text-muted"}`}>
                        {on ? "On" : "Off"}
                    </span>
                    <ToggleSwitch
                        disabled={busy || available !== true}
                        enabled={on}
                        label="Notifications on this device"
                        onChange={() => (on ? turnOff() : turnOn())}
                    />
                </div>
            )}
        </SettingRow>
    );
}
