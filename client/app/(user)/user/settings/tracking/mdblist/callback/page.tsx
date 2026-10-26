"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { personalRequest } from "@/lib/user-api";

export default function TrackingCallbackPage() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const router = useRouter();
    const pending = useRef<Promise<unknown> | null>(null);
    const [failure, setFailure] = useState("");
    useEffect(() => {
        if (!(isReady && userId && authKey)) {
            return;
        }
        let active = true;
        if (!pending.current) {
            const params = new URLSearchParams(window.location.search);
            const code = params.get("code");
            const state = params.get("state");
            // Remove one-use authorization values before navigating or rendering links.
            window.history.replaceState(null, "", window.location.pathname);
            pending.current =
                code && state && !params.has("error")
                    ? personalRequest(userId, authKey, "/tracking-services/mdblist/complete", {
                          body: JSON.stringify({ code, state }),
                          method: "POST",
                      })
                    : Promise.reject(
                          new Error(
                              "MDBList sign-in was cancelled or the response was incomplete. Start again from Tracking services."
                          )
                      );
        }
        pending.current
            .then(() => {
                if (active) {
                    router.replace("/user/settings?section=tracking");
                }
            })
            .catch((reason) => {
                if (active) {
                    setFailure(
                        readErrorMessage(reason, "Could not finish linking this tracking service.")
                    );
                }
            });
        return () => {
            active = false;
        };
    }, [isReady, userId, authKey, router]);
    return (
        <div className="mx-auto max-w-lg px-5 py-16">
            <Card padding="lg">
                <h1 className="font-semibold text-default text-xl">Tracking services</h1>
                <p className="mt-3 text-muted text-sm" role={failure ? "alert" : "status"}>
                    {failure || "Finishing your MDBList connection…"}
                </p>
                {failure && (
                    <Link
                        className="mt-5 inline-block text-primary underline-offset-4 hover:underline"
                        href="/user/settings?section=tracking"
                    >
                        Return to settings
                    </Link>
                )}
            </Card>
        </div>
    );
}
