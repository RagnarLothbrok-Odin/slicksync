// The catalog of what an automation rule can actually listen for and do.
//
// This file is the ONLY source of truth for that - the DB columns are
// stringified JSON and can hold anything, so every read path validates against
// these definitions rather than trusting what's stored. That matters because
// actions here are genuinely destructive (removing a user from a group changes
// which addons their device receives), and a malformed/stale rule row must fail
// closed rather than half-execute.
//
// Adding a trigger = add an entry here + call emitAutomationEvent() from
// wherever that thing actually happens. Adding an action = add an entry here
// with a run() implementation. Nothing else needs touching, including the UI,
// which builds its dropdowns from GET /api/automation/registry.

// ---- Triggers --------------------------------------------------------------
//
// `fields` is what the event payload carries, and doubles as the condition
// builder's field list in the UI. Keep field names stable - existing saved
// rules reference them by name.
const TRIGGERS = {
    "addon.offline": {
        description:
            "Fires when the health checker sees an addon stop responding (once per transition, not once per check).",
        fields: [
            { label: "Addon name", name: "addonName", type: "string" },
            { label: "Addon ID", name: "addonId", type: "string" },
            { label: "Error message", name: "error", type: "string" },
            { label: "Has a backup addon", name: "hasBackup", type: "boolean" },
        ],
        label: "An addon goes offline",
    },
    "addon.online": {
        description: "Fires when an addon recovers after being offline.",
        fields: [
            { label: "Addon name", name: "addonName", type: "string" },
            { label: "Addon ID", name: "addonId", type: "string" },
        ],
        label: "An addon comes back online",
    },
    "backup.failed": {
        description:
            "Fires when a scheduled backup was written locally but could not be sent to the configured S3/WebDAV target. The local copy still exists - this is about the off-site copy not arriving.",
        fields: [
            { label: "Target type", name: "target", type: "string" },
            { label: "Failure message", name: "message", type: "string" },
        ],
        label: "An off-site backup upload fails",
    },
    "invite.accepted": {
        description: "Fires when someone completes an invite and their user is created.",
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Email", name: "email", type: "string" },
            { label: "Invite code", name: "inviteCode", type: "string" },
            { label: "Provider", name: "providerType", type: "string" },
        ],
        label: "An invitation is accepted",
    },
    "metadata_key.failed": {
        description:
            "Fires when a TMDb/OMDb/MDBList/RPDB key goes from working to failing (revoked, rate-limited, or otherwise rejected).",
        fields: [
            { label: "Provider", name: "provider", type: "string" },
            { label: "Provider name", name: "providerLabel", type: "string" },
            { label: "Failure message", name: "message", type: "string" },
            { label: "Rate limited", name: "rateLimited", type: "boolean" },
            { label: "Has a backup key", name: "hasBackup", type: "boolean" },
        ],
        label: "A metadata provider key stops working",
    },
    "metadata_key.failover_activated": {
        description:
            "Fires when a TMDb/OMDb/MDBList/RPDB key fails its check and a backup key is configured for it, so lookups switch to the backup. Posters and ratings keep working - this is the alert that says you are now down to your spare.",
        fields: [
            { label: "Provider", name: "provider", type: "string" },
            { label: "Provider name", name: "providerLabel", type: "string" },
            { label: "Why the primary failed", name: "message", type: "string" },
            { label: "Rate limited", name: "rateLimited", type: "boolean" },
        ],
        label: "A backup metadata key takes over",
    },
    "metadata_key.quota_low": {
        description:
            "Fires when a provider that reports usage (currently MDBList) crosses a percentage of its allowance. Lets you react before it runs out and posters/ratings quietly stop appearing, rather than after.",
        fields: [
            { label: "Provider", name: "provider", type: "string" },
            { label: "Provider name", name: "providerLabel", type: "string" },
            { label: "Percent used", name: "percentUsed", type: "number" },
            { label: "Requests used", name: "used", type: "number" },
            { label: "Request limit", name: "limit", type: "number" },
        ],
        label: "A metadata provider key is running low on its quota",
    },
    "metadata_key.recovered": {
        description:
            "Fires when a previously-failing TMDb/OMDb/MDBList/RPDB key passes its check again.",
        fields: [
            { label: "Provider", name: "provider", type: "string" },
            { label: "Provider name", name: "providerLabel", type: "string" },
        ],
        label: "A metadata provider key starts working again",
    },
    // Fires on a recurring daily schedule rather than in response to
    // something happening elsewhere in the app - the odd one out among these
    // triggers, which is why it's the only one with its own triggerConfig
    // (hour/minute, account-timezone aware) instead of relying purely on
    // conditions. See automation/scheduler.js for the tick that fires this.
    "time.daily": {
        description:
            "Fires at the time you set below, in your account's timezone (Settings -> Privacy & Display). Pick days to run only on those days - leave them all off for every day.",
        fields: [
            { label: "Hour (0-23)", name: "hour", type: "number" },
            { label: "Minute (0-59)", name: "minute", type: "number" },
            // Which day it actually fired on, so a rule scheduled for several
            // days can still branch per-day with a condition (0 = Sunday).
            { label: "Day of week (0=Sun)", name: "weekday", type: "number" },
        ],
        label: "At a scheduled time",
        // Distinct from `fields` (the event payload/condition fields) - this
        // describes the trigger's OWN configuration, only meaningful for a
        // schedule-driven trigger like this one. The rule builder shows a time
        // picker writing into rule.triggerConfig when this trigger is selected;
        // every other trigger type has no use for triggerConfig at all.
        triggerConfigFields: [
            { label: "Hour (0-23)", name: "hour", required: true, type: "number" },
            { label: "Minute (0-59)", name: "minute", required: true, type: "number" },
            // Optional on purpose: an empty/absent list means every day, which is
            // exactly what every rule saved before this field existed has stored.
            // Keeping the trigger key as 'time.daily' rather than adding a separate
            // weekly trigger is what lets those rules keep working untouched.
            {
                hint: "Leave all off to run every day.",
                label: "Days",
                name: "days",
                type: "weekdays",
            },
        ],
    },
    "update.available": {
        description:
            "Fires once per new released version, when the running instance is behind the latest published release.",
        fields: [
            { label: "Latest version", name: "latestVersion", type: "string" },
            { label: "Running version", name: "runningVersion", type: "string" },
        ],
        label: "A new SlickSync release is available",
    },
    // Broader than invite.accepted - fires for ANY new user, including ones
    // created directly from the Users page (Add User), which invite.accepted
    // never sees since there's no invite involved. Also fires for invited
    // users (both emit on the same creation), so a rule that genuinely only
    // cares about invites should still use invite.accepted for its inviteCode
    // field - this one carries no invite context at all.
    "user.created": {
        description:
            "Fires for any new user - via an invitation or created directly from the Users page.",
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Email", name: "email", type: "string" },
            { label: "Provider", name: "providerType", type: "string" },
        ],
        label: "A new user is created",
    },
    "user.expired": {
        description: "Fires when the expiration job retires a user whose expiresAt has passed.",
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Email", name: "email", type: "string" },
            { label: "Provider", name: "providerType", type: "string" },
        ],
        label: "A user's access expires",
    },
    // Checked hourly (automation/inactivity.js) from the same "Last seen" the
    // person cards show. Its own triggerConfig carries the number of days.
    "user.inactive": {
        description:
            'Fires once when a person hasn\'t watched anything for the number of days you set - the "Last seen" on their card - and again only after they come back and go quiet once more. Checked every hour. People already switched off, and people given an access end date in the future, are skipped.',
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Email", name: "email", type: "string" },
            { label: "Provider", name: "providerType", type: "string" },
            { label: "Days without watching", name: "daysInactive", type: "number" },
            { label: "Never watched anything", name: "neverSeen", type: "boolean" },
        ],
        label: "Someone has been inactive for a while",
        triggerConfigFields: [
            { label: "Days without watching", name: "days", required: true, type: "number" },
        ],
    },
    "user.sync_reverted": {
        description:
            "Fires when Sync Guardian detects another client overwrote a synced user's addons outside SlickSync.",
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Provider", name: "providerType", type: "string" },
        ],
        label: "A user's addons get reverted externally",
    },
    "vault.check_failed": {
        description: "Fires when an entry's automated check goes from passing to failing.",
        fields: [
            { label: "Entry name", name: "entryName", type: "string" },
            { label: "Entry ID", name: "entryId", type: "string" },
            { label: "Category", name: "category", type: "string" },
            { label: "Failure message", name: "message", type: "string" },
            { label: "Has a backup key", name: "hasBackup", type: "boolean" },
            { label: "Backup key name", name: "backupName", type: "string" },
        ],
        label: "A vault credential stops working",
    },
    "vault.expiring": {
        description:
            "Fires from the vault monitor when an entry is inside its notify-days-before window.",
        fields: [
            { label: "Entry name", name: "entryName", type: "string" },
            { label: "Entry ID", name: "entryId", type: "string" },
            { label: "Category", name: "category", type: "string" },
            { label: "Days until expiry", name: "daysLeft", type: "number" },
        ],
        label: "A vault credential is expiring",
    },
    "vault.failover_activated": {
        description:
            'Fires when a credential fails its check and a working backup is configured, so the backup is what gets used from now on. Distinct from "stops working": this one means the spare picked up the slack, which is usually a quieter kind of news - but still worth knowing, because you are now running on your last key.',
        fields: [
            { label: "Failed entry name", name: "entryName", type: "string" },
            { label: "Failed entry ID", name: "entryId", type: "string" },
            { label: "Category", name: "category", type: "string" },
            { label: "Backup entry name", name: "backupName", type: "string" },
            { label: "Backup entry ID", name: "backupId", type: "string" },
            { label: "Why the primary failed", name: "message", type: "string" },
        ],
        label: "A backup credential takes over",
    },
    "watch.ahead": {
        description:
            'Fires when a member of a "watching together" show starts an episode that another member has not seen yet (Activity -> Watched -> a show\'s Watching Together setting). The built-in alert already covers push and the bell - this trigger is for anything extra, like a pointed Discord message.',
        fields: [
            { label: "Who watched ahead", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Show", name: "itemName", type: "string" },
            { label: "Show ID", name: "showId", type: "string" },
            { label: "Season", name: "season", type: "number" },
            { label: "Episode", name: "episode", type: "number" },
            { label: "Who they left behind", name: "behindUsernames", type: "string" },
        ],
        label: "Someone watches ahead of the group",
    },
    // Fired by utils/screenTime.js, once per person per account day.
    "watch.budget_exceeded": {
        description:
            "Fires once a day when a person's watching today reaches the daily limit set on their page. Counted like Watch Time, so it can fire a little late for Stremio and Nuvio - they only report at pause or stop - but never early. The built-in alert already covers push and the bell; this is for anything extra.",
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Minutes watched today", name: "minutesWatched", type: "number" },
            { label: "Daily limit (minutes)", name: "limitMinutes", type: "number" },
        ],
        label: "Someone reaches their daily screen-time limit",
    },
    "watch.finished": {
        description:
            "Fires once when a watch crosses the real-completion threshold - the same playback-position test the history record uses, so it means genuinely finished, not merely stopped. Fires once per title per user - finishing cannot un-finish, so it cannot repeat.",
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Title", name: "itemName", type: "string" },
            { label: "IMDb ID", name: "itemId", type: "string" },
            { label: "Type (movie/series)", name: "contentType", type: "string" },
            { label: "Season (episodes only)", name: "season", type: "number" },
            { label: "Episode (episodes only)", name: "episode", type: "number" },
        ],
        label: "A title is finished",
    },
    "watch.started": {
        description:
            'Fires when a live stream starts (the same event as the "started watching" notification). With the webhook action this is scrobble-out to anything that accepts HTTP.',
        fields: [
            { label: "Username", name: "username", type: "string" },
            { label: "User ID", name: "userId", type: "string" },
            { label: "Title", name: "itemName", type: "string" },
            { label: "IMDb ID", name: "itemId", type: "string" },
            { label: "Type (movie/series)", name: "contentType", type: "string" },
        ],
        label: "Someone starts watching",
    },
};

// ---- Condition operators ---------------------------------------------------

const OPERATORS = {
    contains: {
        apply: (a, b) =>
            String(a ?? "")
                .toLowerCase()
                .includes(String(b ?? "").toLowerCase()),
        label: "contains",
    },
    eq: {
        apply: (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase(),
        label: "is",
    },
    gt: {
        apply: (a, b) =>
            Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) > Number(b),
        label: "is greater than",
    },
    is_false: {
        apply: (a) => a === false || a === "false" || a === undefined || a === null,
        label: "is false",
        unary: true,
    },
    is_true: { apply: (a) => a === true || a === "true", label: "is true", unary: true },
    // Numeric comparisons coerce explicitly and refuse non-numbers rather than
    // falling through to JS's string comparison, which would make "10" < "9".
    lt: {
        apply: (a, b) =>
            Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) < Number(b),
        label: "is less than",
    },
    neq: {
        apply: (a, b) => String(a ?? "").toLowerCase() !== String(b ?? "").toLowerCase(),
        label: "is not",
    },
    not_contains: {
        apply: (a, b) =>
            !String(a ?? "")
                .toLowerCase()
                .includes(String(b ?? "").toLowerCase()),
        label: "does not contain",
    },
};

// ---- Actions ---------------------------------------------------------------
//
// Each run() gets ({ prisma, accountId, config, payload }) and returns a short
// human-readable string describing what it did - that string is what lands in
// the run log, so it should name the actual thing acted on, not just "ok".
// Throwing is fine and expected: the engine records the failure per-action and
// keeps going with the rest of the rule.

// Headers a webhook rule may never set: the ones that describe the connection
// or the body, which would corrupt the request or confuse where the body ends.
// Compared in lower case.
const WEBHOOK_CONNECTION_HEADERS = new Set([
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
    "te",
    "trailer",
    "keep-alive",
    "proxy-authorization",
    "proxy-connection",
    "expect",
]);
// On an instance serving strangers a rule may not name another virtual host or
// borrow a cookie either. A household's own install keeps both: a rule that
// calls a LAN service by its address behind a name-routed proxy needs Host, and
// some services want a Cookie.
const WEBHOOK_STRANGER_HEADERS = new Set(["host", "cookie"]);
// An HTTP header name is a "token": letters, digits and a few symbols.
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// What the run log says when safeUrl turns an address away.
const WEBHOOK_REFUSALS = {
    "blocked host": (policy) =>
        policy.allowPrivate
            ? "Webhook address not allowed: this server never calls link-local addresses"
            : "Webhook address not allowed: this server only calls public addresses",
    "invalid url": "Webhook redirected to an invalid address",
    "too many redirects": "Webhook redirected too many times",
    "unresolvable host": "Webhook address could not be found",
    "unsupported protocol": "Webhook redirected to an address that is not http or https",
};

const ACTIONS = {
    "addon.disable": {
        configFields: [
            {
                hint: "Leave blank to act on the addon from the trigger.",
                label: "Addon",
                name: "addonId",
                required: true,
                type: "addon",
            },
        ],
        description: "Turns off a specific addon.",
        label: "Disable an addon",
        async run({ prisma, accountId, config, payload }) {
            const addonId = config.addonId || payload.addonId;
            if (!addonId) {
                throw new Error("No addon specified and the trigger carried none");
            }
            const addon = await prisma.addon.findFirst({ where: { accountId, id: addonId } });
            if (!addon) {
                throw new Error("Addon not found on this account");
            }
            await prisma.addon.update({ data: { isActive: false }, where: { id: addon.id } });
            return `Disabled addon "${addon.name}"`;
        },
    },

    "addon.enable": {
        configFields: [
            {
                hint: "Leave blank to act on the addon from the trigger.",
                label: "Addon",
                name: "addonId",
                required: true,
                type: "addon",
            },
        ],
        description: "Turns an addon back on.",
        label: "Enable an addon",
        async run({ prisma, accountId, config, payload }) {
            const addonId = config.addonId || payload.addonId;
            if (!addonId) {
                throw new Error("No addon specified and the trigger carried none");
            }
            const addon = await prisma.addon.findFirst({ where: { accountId, id: addonId } });
            if (!addon) {
                throw new Error("Addon not found on this account");
            }
            await prisma.addon.update({ data: { isActive: true }, where: { id: addon.id } });
            return `Enabled addon "${addon.name}"`;
        },
    },

    "backup.run": {
        configFields: [],
        description:
            'Writes a backup immediately, in addition to the nightly schedule - and uploads it off-site if a remote target is configured. Pairs with "At a scheduled time" for an extra daily backup at an hour you choose.',
        label: "Run a backup now",
        async run({ prisma }) {
            // Private-instance action: performBackupOnce with no public-mode deps
            // backs up the single account this instance is. On a public instance
            // one tenant's rule must not trigger instance-wide backup work, so it
            // declines rather than half-working - the nightly schedule covers
            // tenants there.
            const { INSTANCE_TYPE } = require("../config");
            if (INSTANCE_TYPE === "public") {
                throw new Error(
                    "Not available on this instance - nightly backups already cover it"
                );
            }
            const { performBackupOnce } = require("../backup");
            const result = await performBackupOnce(prisma, {});
            return result === false ? "Backup failed - see server logs" : "Backup written";
        },
    },

    "keys.check": {
        configFields: [],
        description:
            'Tests the configured TMDb/OMDb/MDBList/RPDB keys immediately and records the results - the same check "Check keys now" and the daily sweep run. Pairs with "At a scheduled time" for more-than-daily checking, or with a recovery trigger to confirm a fix.',
        label: "Run an API key check now",
        async run({ prisma, accountId }) {
            const { checkAndPersistAccountKeys } = require("../metadataKeyHealth");
            const keyHealth = await checkAndPersistAccountKeys(prisma, accountId, { notify: true });
            const checked = Object.keys(keyHealth || {});
            const failing = checked.filter((k) => keyHealth[k] && keyHealth[k].ok === false);
            if (checked.length === 0) {
                return "No API keys configured to check";
            }
            return failing.length === 0
                ? `Checked ${checked.length} key(s) - all working`
                : `Checked ${checked.length} key(s) - failing: ${failing.join(", ")}`;
        },
    },

    // Failover already happens on its own the moment a primary key goes bad -
    // requests quietly use the backup. What failover does NOT do is make that
    // permanent: the dead key stays "primary", every lookup keeps consulting
    // health state to route around it, and addons that embed the key keep
    // carrying a corpse. This action completes the succession: the backup
    // becomes the primary, the failed key becomes the (dead) backup - nothing
    // is discarded, so it is fully reversible by hand - and rotation
    // propagation rewrites any addon still embedding the old key.
    //
    // Previously shelved as "promotion semantics too ambiguous to automate";
    // the swap definition above is the disambiguation, and the user asked for
    // exactly this pairing (2026-09-02).
    "keys.promote_backup": {
        configFields: [],
        description:
            'Makes a failover permanent AND round-trips on its own: swaps the failed key with its backup (for a Settings metadata key or a Vault credential), so the working key IS the primary instead of being routed to around a dead one - and when the failed original passes a later health check (e.g. an OMDb daily limit resetting at midnight UTC), the pair swaps back automatically with a notification, no second rule needed. The old key is kept as the backup throughout - nothing is thrown away, and addons embedding the old key are rewritten and re-synced at each swap. Acts on the key named by the trigger; pair it with "A backup key/credential takes over". This ONE action covers both directions - never add a separate switch-back action or rule.',
        label: "Promote the backup key to primary",
        async run({ prisma, accountId, payload }) {
            const reqLike = { appAccountId: accountId };
            const { encrypt, decrypt, getDecryptedManifestUrl } = require("../encryption");
            const { manifestUrlHmac } = require("../hashing");
            const { propagateSecretRotation } = require("../keyRotation");
            const rotationDeps = { decrypt, encrypt, getDecryptedManifestUrl, manifestUrlHmac };

            // Vault credential path (vault.failover_activated / vault.check_failed)
            if (payload?.entryId) {
                const entry = await prisma.vaultEntry.findFirst({
                    where: { accountId, id: payload.entryId },
                });
                if (!entry) {
                    throw new Error("The failed Vault entry no longer exists");
                }
                const backupId = payload.backupId || entry.backupEntryId;
                if (!backupId) {
                    throw new Error(`"${entry.name}" has no backup credential to promote`);
                }
                const backup = await prisma.vaultEntry.findFirst({
                    where: { accountId, id: backupId },
                });
                if (!backup) {
                    throw new Error("The backup credential no longer exists");
                }

                let oldSecret = null,
                    newSecret = null;
                try {
                    oldSecret = decrypt(entry.encryptedSecret, reqLike);
                } catch {
                    // An unavailable key leaves the fallback value or next key candidate in use.
                }
                try {
                    newSecret = decrypt(backup.encryptedSecret, reqLike);
                } catch {
                    // An unavailable key leaves the fallback value or next key candidate in use.
                }
                if (!newSecret) {
                    throw new Error("Could not decrypt the backup credential");
                }

                // Swap the SECRETS, not the rows: everything that references the
                // primary entry (vault-injected addons, failover pairs) keeps
                // pointing at the same entry id, which now carries the working key.
                await prisma.$transaction([
                    prisma.vaultEntry.update({
                        data: {
                            encryptedSecret: backup.encryptedSecret,
                            lastCheckMessage: "Promoted from backup - awaiting first check",
                            lastCheckStatus: "unknown",
                        },
                        where: { id: entry.id },
                    }),
                    prisma.vaultEntry.update({
                        data: {
                            encryptedSecret: entry.encryptedSecret,
                            lastCheckMessage: "Demoted failed primary - replace this key",
                            lastCheckStatus: "unknown",
                        },
                        where: { id: backup.id },
                    }),
                ]);

                // Stamp the promotion so the vault monitor can complete the round
                // trip: when the demoted key (now sitting in the backup entry)
                // passes a check again, the secrets swap back automatically.
                try {
                    const acc = await prisma.appAccount.findUnique({
                        select: { sync: true },
                        where: { id: accountId },
                    });
                    let cfg2 = acc?.sync;
                    if (typeof cfg2 === "string") {
                        try {
                            cfg2 = JSON.parse(cfg2);
                        } catch {
                            cfg2 = {};
                        }
                    }
                    if (!cfg2 || typeof cfg2 !== "object") {
                        cfg2 = {};
                    }
                    cfg2.vaultPromotions = {
                        ...(cfg2.vaultPromotions || {}),
                        [entry.id]: { at: new Date().toISOString(), backupId: backup.id },
                    };
                    await prisma.appAccount.update({
                        data: { sync: JSON.stringify(cfg2) },
                        where: { id: accountId },
                    });
                } catch (e) {
                    console.warn("[Automation] promotion stamp failed:", e?.message);
                }

                let rotated = 0;
                if (oldSecret && oldSecret !== newSecret) {
                    try {
                        const rotation = await propagateSecretRotation(
                            prisma,
                            reqLike,
                            rotationDeps,
                            { accountId, newSecret, oldSecret }
                        );
                        rotated = rotation.addonsUpdated?.length || 0;
                    } catch (e) {
                        console.warn("[Automation] promote_backup rotation failed:", e?.message);
                    }
                }
                return `Promoted "${backup.name}" over "${entry.name}"${rotated ? ` and rewrote ${rotated} addon(s)` : ""} - the failed key is kept as the backup`;
            }

            // Settings metadata-key path (metadata_key.failed / failover_activated)
            const FIELD_BY_PROVIDER = {
                mdblist: "mdblistApiKey",
                omdb: "omdbApiKey",
                rpdb: "rpdbApiKey",
                tmdb: "tmdbApiKey",
            };
            const provider = payload?.provider;
            const field = FIELD_BY_PROVIDER[provider];
            if (!field) {
                throw new Error(
                    "The trigger named no key to promote - pair this action with a key-failure or failover trigger"
                );
            }

            const acc = await prisma.appAccount.findUnique({
                select: { sync: true },
                where: { id: accountId },
            });
            let cfg = acc?.sync;
            if (typeof cfg === "string") {
                try {
                    cfg = JSON.parse(cfg);
                } catch {
                    cfg = null;
                }
            }
            if (!cfg || typeof cfg !== "object") {
                cfg = {};
            }
            const primary = typeof cfg[field] === "string" ? cfg[field].trim() : "";
            const backupKey =
                typeof cfg[`${field}Backup`] === "string" ? cfg[`${field}Backup`].trim() : "";
            if (!backupKey) {
                throw new Error(
                    `No backup ${payload?.providerLabel || provider} key is configured to promote`
                );
            }

            cfg[field] = backupKey;
            cfg[`${field}Backup`] = primary; // the dead key becomes the backup - kept, not discarded
            // Stamped so the daily key check can swap back automatically the
            // moment the demoted original passes a check again.
            cfg.promotedKeys = {
                ...(cfg.promotedKeys || {}),
                [provider]: { at: new Date().toISOString() },
            };
            // Reset this provider's health so lookups stop routing around a
            // "failed primary" that is now the working key, and the next check
            // records the truth fresh.
            if (cfg.keyHealth?.[provider]) {
                delete cfg.keyHealth[provider];
            }
            await prisma.appAccount.update({
                data: { sync: JSON.stringify(cfg) },
                where: { id: accountId },
            });

            let rotated = 0;
            if (primary && primary !== backupKey) {
                try {
                    const rotation = await propagateSecretRotation(prisma, reqLike, rotationDeps, {
                        accountId,
                        newSecret: backupKey,
                        oldSecret: primary,
                    });
                    rotated = rotation.addonsUpdated?.length || 0;
                } catch (e) {
                    console.warn("[Automation] promote_backup rotation failed:", e?.message);
                }
            }
            return `Promoted the backup ${payload?.providerLabel || provider} key to primary${rotated ? ` and rewrote ${rotated} addon(s)` : ""} - the failed key is kept as the backup`;
        },
    },
    notify: {
        configFields: [
            { label: "Title", name: "title", required: true, type: "string" },
            {
                hint: "Use {{fieldName}} to insert values from the trigger, e.g. {{addonName}}.",
                label: "Message",
                name: "message",
                required: true,
                type: "text",
            },
        ],
        description:
            "Sends through the same channels as everything else (push/bell primary, Discord if configured).",
        label: "Send a notification",
        async run({ prisma, accountId, config, payload }) {
            const title = interpolate(config.title, payload);
            const message = interpolate(config.message, payload);
            const { notifyGeneric } = require("./notify");
            await notifyGeneric(prisma, accountId, title, message);
            return `Sent notification "${title}"`;
        },
    },

    "user.add_to_group": {
        configFields: [
            { label: "Group", name: "groupId", required: true, type: "group" },
            {
                hint: "Leave blank to act on the user from the trigger.",
                label: "User",
                name: "userId",
                type: "user",
            },
        ],
        description: "Adds the user from the trigger (or a specific one) to a group.",
        label: "Add a user to a group",
        async run({ prisma, accountId, config, payload }) {
            const userId = config.userId || payload.userId;
            if (!userId) {
                throw new Error("No user specified and the trigger carried none");
            }
            const [group, user] = await Promise.all([
                prisma.group.findFirst({ where: { accountId, id: config.groupId } }),
                prisma.user.findFirst({ where: { accountId, id: userId } }),
            ]);
            if (!group) {
                throw new Error("Group not found on this account");
            }
            if (!user) {
                throw new Error("User not found on this account");
            }
            const ids = parseIdList(group.userIds);
            if (ids.includes(userId)) {
                return `${user.username} was already in "${group.name}"`;
            }
            // One group per person, as everywhere else: moved out of any other.
            const members = require("../helpers/database");
            await members.withMembershipLock(accountId, () =>
                members.moveIntoGroup(prisma, accountId, userId, group.id)
            );
            return `Added ${user.username} to "${group.name}"`;
        },
    },

    // Reversible on purpose: the same switch as the toggle on a person's card,
    // never a delete. Pairs with "Someone has been inactive for a while".
    "user.deactivate": {
        configFields: [
            {
                hint: "Leave blank to act on the user from the trigger.",
                label: "User",
                name: "userId",
                type: "user",
            },
        ],
        description:
            "Switches the person off - the same as the toggle on their card, and switched back on the same way. Nothing is deleted. A Jellyfin account an invitation made for them is switched off on the server too. Someone given an access end date in the future is left alone.",
        label: "Deactivate a user",
        async run({ prisma, accountId, config, payload }) {
            const userId = config.userId || payload.userId;
            if (!userId) {
                throw new Error("No user specified and the trigger carried none");
            }
            const user = await prisma.user.findFirst({
                select: { expiresAt: true, id: true, isActive: true, username: true },
                where: { accountId, id: userId },
            });
            if (!user) {
                throw new Error("User not found on this account");
            }
            if (!user.isActive) {
                return `${user.username} was already switched off`;
            }
            if (user.expiresAt && new Date(user.expiresAt).getTime() > Date.now()) {
                return `Left ${user.username} on: their access has an end date set`;
            }
            await prisma.user.update({ data: { isActive: false }, where: { id: user.id } });
            try {
                const { decrypt } = require("../encryption");
                await require("../jellyfinInviteAccounts").reconcileAccount(
                    prisma,
                    decrypt,
                    accountId
                );
            } catch (e) {
                console.warn(
                    "[Automation] invite-made Jellyfin account not switched off yet:",
                    e?.message
                );
            }
            return `Deactivated ${user.username} - switch them back on from Users`;
        },
    },

    "user.remove_from_group": {
        configFields: [
            { label: "Group", name: "groupId", required: true, type: "group" },
            {
                hint: "Leave blank to act on the user from the trigger.",
                label: "User",
                name: "userId",
                type: "user",
            },
        ],
        description: "Removes the user from the trigger (or a specific one) from a group.",
        label: "Remove a user from a group",
        async run({ prisma, accountId, config, payload }) {
            const userId = config.userId || payload.userId;
            if (!userId) {
                throw new Error("No user specified and the trigger carried none");
            }
            const [group, user] = await Promise.all([
                prisma.group.findFirst({ where: { accountId, id: config.groupId } }),
                prisma.user.findFirst({ where: { accountId, id: userId } }),
            ]);
            if (!group) {
                throw new Error("Group not found on this account");
            }
            if (!user) {
                throw new Error("User not found on this account");
            }
            if (!parseIdList(group.userIds).includes(userId)) {
                return `${user.username} was not in "${group.name}"`;
            }
            // Read again inside the queue, so a change made meanwhile is kept.
            await require("../helpers/database").withMembershipLock(accountId, async () => {
                const fresh = await prisma.group.findFirst({
                    select: { userIds: true },
                    where: { accountId, id: group.id },
                });
                const ids = parseIdList(fresh?.userIds);
                if (ids.includes(userId)) {
                    await prisma.group.update({
                        data: { userIds: JSON.stringify(ids.filter((i) => i !== userId)) },
                        where: { id: group.id },
                    });
                }
            });
            return `Removed ${user.username} from "${group.name}"`;
        },
    },

    // The action this feature was most conspicuously missing. Syncing is
    // SlickSync's core operation, yet an automation could notify you about
    // things, flip addons and shuffle group membership - and not actually push
    // addons to anyone. Together with day-of-week scheduling on time.daily,
    // this is what makes "every Sunday at 3am, sync everyone" expressible.
    "user.sync": {
        configFields: [
            {
                hint: "A scheduled trigger carries no user, so pick a specific user, a group, or everyone.",
                label: "Who to sync",
                name: "scope",
                options: [
                    { label: "The user from the trigger", value: "trigger" },
                    { label: "A specific user", value: "user" },
                    { label: "Everyone in a group", value: "group" },
                    { label: "Every active user", value: "all" },
                ],
                required: true,
                type: "select",
            },
            {
                hint: 'Used when "A specific user" is selected.',
                label: "User",
                name: "userId",
                type: "user",
            },
            {
                hint: 'Used when "Everyone in a group" is selected.',
                label: "Group",
                name: "groupId",
                type: "group",
            },
        ],
        description:
            "Runs the same sync as the Sync button - pushes each user's assigned addons to their provider.",
        label: "Sync users",
        async run({ prisma, accountId, config, payload }) {
            const { syncUserAddons } = require("../../routes/users");
            const { decrypt } = require("../encryption");

            const scope = config.scope || "trigger";
            let userIds = [];
            let what = "";

            if (scope === "all") {
                const users = await prisma.user.findMany({
                    select: { id: true },
                    where: { accountId, isActive: true },
                });
                userIds = users.map((u) => u.id);
                what = "every active user";
            } else if (scope === "group") {
                const group = await prisma.group.findFirst({
                    where: { accountId, id: config.groupId },
                });
                if (!group) {
                    throw new Error("Group not found on this account");
                }
                // Re-check against the users table: userIds is a JSON blob that can
                // still name someone deleted or deactivated since it was written.
                const users = await prisma.user.findMany({
                    select: { id: true },
                    where: { accountId, id: { in: parseIdList(group.userIds) }, isActive: true },
                });
                userIds = users.map((u) => u.id);
                what = `"${group.name}"`;
            } else {
                const userId = scope === "user" ? config.userId : payload.userId;
                if (!userId) {
                    throw new Error("No user specified and the trigger carried none");
                }
                const user = await prisma.user.findFirst({
                    select: { id: true },
                    where: { accountId, id: userId },
                });
                if (!user) {
                    throw new Error("User not found on this account");
                }
                userIds = [user.id];
                what = "the user";
            }

            if (userIds.length === 0) {
                return `Nothing to sync - ${what} has no active users`;
            }

            // There is no HTTP request behind a scheduled run, so hand syncUserAddons
            // the same minimal req-like shape invitations.js already uses for its
            // sync-on-join. appAccountId is what it scopes every query by.
            const reqLike = { appAccountId: accountId, headers: {} };
            let synced = 0;
            const failures = [];
            for (const id of userIds) {
                try {
                    const result = await syncUserAddons(
                        prisma,
                        id,
                        [],
                        false,
                        reqLike,
                        decrypt,
                        () => accountId,
                        true
                    );
                    if (result?.success) {
                        synced++;
                    } else {
                        failures.push(result?.error || "unknown error");
                    }
                } catch (e) {
                    failures.push(e?.message || "unknown error");
                }
            }

            // Partial failure is reported, not thrown: the run log should say what
            // actually happened rather than hiding the successes behind an
            // exception. A total failure does throw, so the rule is marked failed.
            if (synced === 0) {
                throw new Error(
                    "Sync failed for all " +
                        userIds.length +
                        " user(s): " +
                        (failures[0] || "unknown error")
                );
            }
            return (
                "Synced " +
                synced +
                "/" +
                userIds.length +
                " user(s) in " +
                what +
                (failures.length ? `, ${failures.length} failed` : "")
            );
        },
    },

    webhook: {
        configFields: [
            { label: "URL", name: "url", required: true, type: "string" },
            {
                hint: "One per line, e.g. Authorization: Bearer xxx",
                label: "Extra headers (optional)",
                name: "headers",
                type: "text",
            },
        ],
        description:
            "POSTs the trigger's data as JSON to a URL you choose - for reaching anything outside SlickSync's built-in channels (Home Assistant, ntfy, a custom script, n8n/Zapier, etc).",
        label: "Call a webhook",
        // The URL and headers are free text, and on an instance that serves
        // strangers any account can write a rule, so this is a way to make the
        // server send a request wherever it likes. It goes through safeFetch: such
        // an instance only calls public addresses (and a redirect is checked at
        // every hop), while a household install may reach its own network - Home
        // Assistant, ntfy or n8n on the LAN is the point of this action - and is
        // only kept away from link-local addresses. The Discord webhook is not
        // comparable: it is always https on port 443 with a fixed body.
        async run({ config, payload }) {
            const { safeFetch, instancePolicy } = require("../safeUrl");
            const url = typeof config.url === "string" ? config.url.trim() : "";
            if (!url) {
                throw new Error("No webhook URL configured");
            }
            let parsed;
            try {
                parsed = new URL(url);
            } catch (cause) {
                throw new Error("Invalid webhook URL", { cause });
            }
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                throw new Error("Webhook URL must be http or https");
            }

            const policy = instancePolicy();
            const headers = { "Content-Type": "application/json" };
            const ignored = [];
            for (const line of String(config.headers || "").split("\n")) {
                const idx = line.indexOf(":");
                if (idx === -1) {
                    continue;
                }
                const key = line.slice(0, idx).trim();
                const value = line.slice(idx + 1).trim();
                if (!key) {
                    continue;
                }
                // These belong to the connection and the request itself, not to the
                // person writing the rule. Left out rather than failing the action,
                // and named in the result so the run log says why.
                const lower = key.toLowerCase();
                if (
                    WEBHOOK_CONNECTION_HEADERS.has(lower) ||
                    (!policy.allowPrivate && WEBHOOK_STRANGER_HEADERS.has(lower))
                ) {
                    ignored.push(key.slice(0, 40));
                    continue;
                }
                if (!HEADER_NAME.test(key) || /[\r\n\0]/.test(value)) {
                    throw new Error(`Invalid header "${key.slice(0, 40)}"`);
                }
                headers[key] = value;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            try {
                let res;
                try {
                    res = await safeFetch(
                        url,
                        {
                            body: JSON.stringify(payload || {}),
                            headers,
                            method: "POST",
                            signal: controller.signal,
                        },
                        policy
                    );
                } catch (e) {
                    const refused = WEBHOOK_REFUSALS[e?.message];
                    if (refused) {
                        throw new Error(typeof refused === "function" ? refused(policy) : refused, {
                            cause: e,
                        });
                    }
                    throw e;
                }
                if (!res.ok) {
                    throw new Error(`Webhook returned ${res.status}`);
                }
                return `Called webhook (${res.status})${ignored.length ? `; not sent: ${ignored.join(", ")}` : ""}`;
            } finally {
                clearTimeout(timeoutId);
            }
        },
    },
};

// ---- Helpers ---------------------------------------------------------------

function parseIdList(raw) {
    try {
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * {{field}} substitution for notification text. Deliberately dumb: only
 * replaces known top-level payload keys, leaves an unknown {{token}} visibly
 * intact rather than blanking it - a notification reading "addon {{addnName}}
 * is down" is a typo the admin can see and fix; one reading "addon  is down"
 * looks like a bug in the app.
 */
function interpolate(template, payload) {
    if (typeof template !== "string") {
        return "";
    }
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key) =>
        Object.hasOwn(payload || {}, key) ? String(payload[key] ?? "") : whole
    );
}

/** Shape returned to the client so the rule builder's dropdowns stay in lockstep with this file. */
function describeRegistry() {
    return {
        actions: Object.entries(ACTIONS).map(([type, a]) => ({
            configFields: a.configFields,
            description: a.description,
            label: a.label,
            type,
        })),
        operators: Object.entries(OPERATORS).map(([op, o]) => ({
            label: o.label,
            op,
            unary: !!o.unary,
        })),
        triggers: Object.entries(TRIGGERS).map(([type, t]) => ({
            description: t.description,
            fields: t.fields,
            label: t.label,
            type,
            ...(t.triggerConfigFields ? { triggerConfigFields: t.triggerConfigFields } : {}),
        })),
    };
}

module.exports = { ACTIONS, describeRegistry, interpolate, OPERATORS, parseIdList, TRIGGERS };
