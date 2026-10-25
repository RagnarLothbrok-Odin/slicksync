import type { AutomationActionConfig, AutomationCondition } from "@/lib/api";

// One-click starting points for automation rules.
//
// The rule builder is genuinely capable, which also makes it a blank form
// with a trigger dropdown, a condition list and an action list - and nobody
// new to it knows what a good rule looks like. These are the rules people
// actually want, pre-filled, so the first useful automation costs one click
// and a save instead of an afternoon of reading.
//
// Deliberately NOT a separate execution path: picking a recipe opens the
// SAME rule editor with fields pre-populated, using the same prefill
// mechanism the addon page's "Automate" button already uses. Every recipe is
// therefore fully editable before saving, and produces an ordinary rule with
// nothing special about it afterwards.
//
// Every trigger referenced here is registered in
// server/utils/automation/registry.js - keep them in step; an unknown
// triggerType would leave the editor's trigger dropdown unset.

export interface AutomationRecipe {
    actions?: AutomationActionConfig[];
    conditions?: AutomationCondition[];
    /** Plain-language description of what the finished rule does. */
    description: string;
    id: string;
    name: string;
    /** Shown when the recipe needs something filled in before it can be saved. */
    needs?: string;
    title: string;
    triggerType: string;
}

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
    {
        actions: [
            {
                config: { message: "An addon stopped responding.", title: "Addon offline" },
                type: "notify",
            },
        ],
        description:
            "Sends a notification the moment any addon stops responding, so you find out before someone reports that streams stopped working.",
        id: "addon-down-notify",
        name: "Addon went offline",
        title: "Tell me when an addon goes down",
        triggerType: "addon.offline",
    },
    {
        actions: [
            {
                config: { message: "An addon is responding again.", title: "Addon back online" },
                type: "notify",
            },
        ],
        description:
            "The other half of the pair - confirms an addon is working again without you having to go and check.",
        id: "addon-back-notify",
        name: "Addon back online",
        title: "Tell me when an addon recovers",
        triggerType: "addon.online",
    },
    {
        actions: [
            {
                config: {
                    message: "A metadata provider key stopped working.",
                    title: "API key not working",
                },
                type: "notify",
            },
        ],
        description:
            "TMDb, OMDb, MDBList and RPDB keys fail silently - posters and ratings just quietly stop appearing. This turns that into an actual alert.",
        id: "key-failed-notify",
        name: "Metadata key failed",
        title: "Tell me when an API key stops working",
        triggerType: "metadata_key.failed",
    },
    {
        actions: [
            {
                config: {
                    message: "The backup was written locally but did not reach the remote target.",
                    title: "Off-site backup failed",
                },
                type: "notify",
            },
        ],
        description:
            "The local backup still gets written, but the copy going to S3/WebDAV did not arrive. Worth knowing immediately rather than the day you need it.",
        id: "backup-failed-notify",
        name: "Off-site backup failed",
        title: "Tell me when an off-site backup fails",
        triggerType: "backup.failed",
    },
    {
        actions: [
            {
                config: {
                    message: "A Vault entry is approaching its renewal date.",
                    title: "Subscription expiring soon",
                },
                type: "notify",
            },
        ],
        description:
            "Fires on the lead time set for each Vault entry, so a debrid subscription never lapses without warning.",
        id: "vault-expiring-notify",
        name: "Vault entry expiring",
        title: "Tell me before a subscription expires",
        triggerType: "vault.expiring",
    },
    {
        actions: [{ config: {}, type: "user.sync" }],
        description:
            "When someone new is added, push their addons straight away so they are ready to watch without a manual sync.",
        id: "new-user-sync",
        name: "Sync new users",
        title: "Sync every new user automatically",
        triggerType: "user.created",
    },
    {
        actions: [
            {
                config: {
                    message: "A newer release has been published.",
                    title: "SlickSync update available",
                },
                type: "notify",
            },
        ],
        description:
            "Fires once per new release when this instance is behind the latest published version.",
        id: "update-available-notify",
        name: "Update available",
        title: "Tell me when a SlickSync update is out",
        triggerType: "update.available",
    },
    {
        actions: [{ config: { url: "" }, type: "webhook" }],
        description:
            "Same trigger as the first recipe, but sends it to Discord or any other webhook instead of the in-app bell.",
        id: "addon-down-webhook",
        name: "Addon offline webhook",
        needs: "Add your webhook URL before saving.",
        title: "Post to a webhook when an addon goes down",
        triggerType: "addon.offline",
    },
    {
        actions: [
            {
                config: {
                    message:
                        "A metadata provider key stopped working and has no backup key configured.",
                    title: "API key down, no backup",
                },
                type: "notify",
            },
        ],
        conditions: [{ field: "hasBackup", op: "is_false" }],
        description:
            "The louder half of the pair. Fires when a metadata key stops working and no backup key is set for it, so posters and ratings really have stopped. A key that fails with a backup behind it is handled by the quieter recipe below.",
        id: "key-failed-no-backup",
        name: "Metadata key failed with no backup",
        title: "Alert me only when a failed key has no spare",
        triggerType: "metadata_key.failed",
    },
    {
        actions: [
            { config: {}, type: "keys.promote_backup" },
            {
                config: {
                    message:
                        "The backup {{providerLabel}} key is now the primary. The failed key was kept as the backup - replace it when you can.",
                    title: "Backup key promoted",
                },
                type: "notify",
            },
        ],
        description:
            "Completes the failover instead of running on a detour forever: the backup becomes the primary, the dead key is kept as the new backup, and any addon still carrying the old key is rewritten and re-synced. And it round-trips by itself - when the failed original passes a later check (a daily limit resetting, say), the pair swaps back automatically. One notification each way.",
        id: "key-failover-promote",
        name: "Promote the backup key when it takes over",
        title: "If a backup key takes over, make it the new primary",
        triggerType: "metadata_key.failover_activated",
    },
    {
        actions: [
            { config: {}, type: "keys.promote_backup" },
            {
                config: {
                    message:
                        "{{backupName}} is now the primary for {{entryName}}. The failed key was kept as the backup - replace it when you can.",
                    title: "Backup credential promoted",
                },
                type: "notify",
            },
        ],
        description:
            "The Vault version: when a stored credential fails and its backup steps in, swap them for good. Everything referencing the credential keeps working, addons embedding the old key are rewritten, and the dead key stays on file as the backup.",
        id: "vault-failover-promote",
        name: "Promote the backup credential when it takes over",
        title: "If a backup credential takes over, make it the new primary",
        triggerType: "vault.failover_activated",
    },
    {
        actions: [
            {
                config: {
                    message:
                        "A metadata key failed and its backup is now being used. Replace the primary when you can.",
                    title: "Running on the backup key",
                },
                type: "notify",
            },
        ],
        description:
            "Nothing is broken for anyone using the app - the spare picked up the slack. Worth knowing anyway, because you are now running on your last key for that provider.",
        id: "key-failover-notify",
        name: "Backup metadata key took over",
        title: "Tell me when a backup key takes over",
        triggerType: "metadata_key.failover_activated",
    },
    {
        actions: [
            {
                config: {
                    message:
                        "A Vault credential failed its check and its backup is now being used.",
                    title: "Running on the backup credential",
                },
                type: "notify",
            },
        ],
        description:
            "The Vault version of the same thing - a stored credential failed its check and its configured backup is now in use.",
        id: "vault-failover-notify",
        name: "Backup credential took over",
        title: "Tell me when a backup credential takes over",
        triggerType: "vault.failover_activated",
    },
    {
        actions: [
            {
                config: {
                    message: "A Vault credential stopped working and has no backup configured.",
                    title: "Credential down, no backup",
                },
                type: "notify",
            },
        ],
        conditions: [{ field: "hasBackup", op: "is_false" }],
        description:
            "Fires when a Vault credential stops working and no backup is set for it. Pair it with the recipe above to keep the urgent alerts separate from the informational ones.",
        id: "vault-failed-no-backup",
        name: "Credential failed with no backup",
        title: "Alert me when a credential fails with nothing to fall back on",
        triggerType: "vault.check_failed",
    },
    {
        actions: [{ config: { url: "" }, type: "webhook" }],
        description:
            "Sends quota warnings to Discord or anywhere else, so whoever tops the key up sees it without needing an admin login. Fires before the key runs out, not after.",
        id: "key-quota-failover-webhook",
        name: "Key quota low webhook",
        needs: "Add your webhook URL before saving.",
        title: "Post to a webhook when a key runs low",
        triggerType: "metadata_key.quota_low",
    },
    {
        actions: [{ config: { url: "" }, type: "webhook" }],
        description:
            "Fires once when something is genuinely finished (the real playback-position test, not just stopped) and posts it wherever you point it. Scrobble-out to anything that accepts HTTP - a dashboard, a Discord thread, your own script.",
        id: "watch-finished-webhook",
        name: "Finished title webhook",
        needs: "Add your webhook URL before saving.",
        title: "Send every finished title to a webhook",
        triggerType: "watch.finished",
    },
    {
        actions: [{ config: {}, type: "user.deactivate" }],
        description:
            "When someone hasn't watched anything for the number of days you set, they're switched off - the same as the toggle on their card, so switching them back on is one click. Nothing is deleted, and anyone given an access end date is left alone.",
        id: "inactive-deactivate",
        name: "Switch off inactive people",
        needs: "Set how many days without watching before saving.",
        title: "Switch off people who stopped watching",
        triggerType: "user.inactive",
    },
    {
        actions: [{ config: {}, type: "backup.run" }],
        description:
            "The nightly backup already runs on its own schedule; this adds another at whatever hour you set - useful before a nightly maintenance window, or just for belt-and-braces.",
        id: "nightly-extra-backup",
        name: "Extra scheduled backup",
        title: "Run an extra backup at an hour you choose",
        triggerType: "time.daily",
    },
];
