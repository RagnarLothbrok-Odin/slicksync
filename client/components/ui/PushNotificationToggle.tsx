"use client";

import { BellAlertIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { readErrorMessage } from "@/lib/errors";

// Turns the browser's Push API subscription into a one-button toggle. Enabling
// registers the service worker, asks for notification permission, subscribes
// with the server's VAPID key, and hands the subscription to the backend so
// new-episode alerts can be delivered as native notifications even when
// SlickSync is closed. Everything degrades quietly on browsers/contexts that
// don't support push (older browsers, non-HTTPS, iOS before it's installed to
// the home screen).

// The VAPID public key arrives base64url-encoded; PushManager.subscribe needs
// it as a BufferSource. Backing the Uint8Array with an explicit ArrayBuffer
// (rather than the default ArrayBufferLike) keeps its type assignable to
// applicationServerKey under strict lib.dom.
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const buffer = new ArrayBuffer(raw.length);
    const out = new Uint8Array(buffer);
    for (let i = 0; i < raw.length; i++) {
        out[i] = raw.charCodeAt(i);
    }
    return out;
}

export function PushNotificationToggle() {
    const [supported, setSupported] = useState(false);
    const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
    const [subscribed, setSubscribed] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const ok =
            typeof window !== "undefined" &&
            "serviceWorker" in navigator &&
            "PushManager" in window;
        setSupported(ok);
        if (!ok) {
            return;
        }

        // Is push available on the server (VAPID configured), and are we already
        // subscribed on this device?
        api.getPushVapidKey()
            .then((r) => setServerEnabled(r.enabled))
            .catch(() => setServerEnabled(false));
        navigator.serviceWorker
            .getRegistration()
            .then((reg) => reg?.pushManager.getSubscription())
            .then((sub) => setSubscribed(!!sub))
            .catch(() => undefined);
    }, []);

    const enable = async () => {
        setBusy(true);
        try {
            const { enabled, publicKey } = await api.getPushVapidKey();
            if (!(enabled && publicKey)) {
                toast.error("Push notifications aren’t available on this server");
                return;
            }
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                toast.error("Notification permission was denied");
                return;
            }
            const reg = await navigator.serviceWorker.register("/sw.js");
            await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
                applicationServerKey: urlBase64ToUint8Array(publicKey),
                userVisibleOnly: true,
            });
            await api.savePushSubscription(sub.toJSON(), navigator.userAgent);
            setSubscribed(true);
            toast.success("Phone notifications enabled on this device");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to enable notifications"));
        } finally {
            setBusy(false);
        }
    };

    const disable = async () => {
        setBusy(true);
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) {
                await api.removePushSubscription(sub.endpoint).catch(() => undefined);
                await sub.unsubscribe().catch(() => undefined);
            }
            setSubscribed(false);
            toast.success("Notifications disabled on this device");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to disable notifications"));
        } finally {
            setBusy(false);
        }
    };

    if (!supported) {
        return (
            <p className="text-muted text-xs">
                This browser doesn&apos;t support push notifications. On iPhone, add SlickSync to
                your Home Screen first.
            </p>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-3">
            <Button
                disabled={serverEnabled === false}
                isLoading={busy}
                leftIcon={busy ? undefined : <BellAlertIcon className="h-4 w-4" />}
                onClick={subscribed ? disable : enable}
                size="sm"
                variant={subscribed ? "secondary" : "primary"}
            >
                {subscribed ? "Disable on this device" : "Enable phone notifications"}
            </Button>
            <p className="text-muted text-xs">
                {serverEnabled === false
                    ? "Push isn’t available on this server."
                    : subscribed
                      ? "New-episode alerts will buzz this device even when SlickSync is closed."
                      : "Get new-episode alerts as native notifications on this device."}
            </p>
        </div>
    );
}
