import { equal } from "node:assert/strict";
import { test } from "node:test";
import {
    notificationClearStorageKey,
    notificationSurvivesClear,
    storedNotificationCutoff,
} from "../client/lib/notificationVisibility";

const cleared = new Date("2026-10-26T00:30:00Z");

test("an old persisted notification stays cleared when a late poll returns it", () => {
    equal(notificationSurvivesClear("2026-10-25T01:30:00Z", cleared), false);
    equal(notificationSurvivesClear(cleared, cleared), false);
    equal(notificationSurvivesClear("2026-10-26T00:30:01Z", cleared), true);
});

test("clear compares instants across offsets and the daylight-saving change", () => {
    equal(notificationSurvivesClear("2026-10-26T01:00:00+01:00", cleared), false);
    equal(notificationSurvivesClear("2026-10-26T01:31:00+01:00", cleared), true);
});

test("only an actual valid Clear creates a cutoff", () => {
    equal(storedNotificationCutoff(null), null);
    equal(storedNotificationCutoff("bad"), null);
    equal(storedNotificationCutoff(cleared.toISOString())?.getTime(), cleared.getTime());
    equal(notificationSurvivesClear("2026-10-10T00:00:00Z", null), true);
    equal(notificationSurvivesClear("invalid", cleared), false);
});

test("clear cutoffs follow the account rather than a rotating login token", () => {
    const token = (accId: string, marker: string) =>
        `header.${btoa(JSON.stringify({ accId, marker }))}.signature`;
    equal(
        notificationClearStorageKey(token("account-a", "old")),
        notificationClearStorageKey(token("account-a", "new"))
    );
    equal(
        notificationClearStorageKey(token("account-a", "old")) ===
            notificationClearStorageKey(token("account-b", "old")),
        false
    );
    equal(notificationClearStorageKey(null), "notifications-cleared-before:private");
    equal(notificationClearStorageKey("malformed"), "notifications-cleared-before:private");
});
