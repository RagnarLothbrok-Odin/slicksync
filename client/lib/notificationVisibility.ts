/** A later poll may contain a snapshot fetched before Clear completed. */
export function notificationSurvivesClear(createdAt: string | Date, clearedAt: Date | null) {
    if (!clearedAt) {
        return true;
    }
    const created = new Date(createdAt).getTime();
    // Invalid dates cannot prove an event happened after the clear boundary.
    return Number.isFinite(created) && created > clearedAt.getTime();
}

export function storedNotificationCutoff(value: string | null) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

/** Decode only for a UI storage namespace, never to authenticate a request. */
export function notificationClearStorageKey(token: string | null) {
    try {
        const payload = token?.split(".")[1];
        if (payload) {
            const account: unknown = JSON.parse(
                atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
            );
            if (
                account &&
                typeof account === "object" &&
                "accId" in account &&
                typeof account.accId === "string" &&
                account.accId
            ) {
                return `notifications-cleared-before:${account.accId}`;
            }
        }
    } catch {
        // Private instances may use a session cookie without a JWT in storage.
    }
    return "notifications-cleared-before:private";
}
