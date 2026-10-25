// Shared failover resolution for Vault credentials.
//
// Any VaultEntry can name another entry as its backup (VaultEntry.backupEntry,
// the same self-relation shape Addon.backupAddon uses). When the primary's own
// health check last came back failing, consumers transparently use the backup
// instead. That is the whole point of the feature: a debrid key that expired,
// a usenet provider that revoked access, or a metadata key that hit its cap
// should not take the feature down when a spare is sitting right there.
//
// This lives in one place rather than being re-implemented per consumer so the
// rules cannot drift apart - in particular "only fail over when the primary is
// KNOWN bad", never on an unchecked or merely-stale entry. An entry that has
// never been checked (lastCheckStatus null) is not assumed dead; silently
// switching keys on someone whose primary is actually fine would make billing
// and rate limits impossible to reason about.
//
// Backups are deliberately not chained. If the backup is also failing we stop
// there and report it, rather than walking a chain that a user could point in
// a circle.

const FAILING_STATUSES = new Set(["failed", "error", "expired"]);

function isFailing(entry) {
    return !!entry && FAILING_STATUSES.has(String(entry.lastCheckStatus || "").toLowerCase());
}

/**
 * Pick the entry a consumer should actually use.
 * Returns { entry, usedBackup, reason } - entry is never null if one was given.
 */
async function resolveVaultEntry(prisma, entry) {
    if (!(entry?.backupEntryId && isFailing(entry))) {
        return { entry, reason: null, usedBackup: false };
    }

    const backup = await prisma.vaultEntry
        .findFirst({
            where: { accountId: entry.accountId, id: entry.backupEntryId, isActive: true },
        })
        .catch(() => null);

    if (!backup) {
        return { entry, reason: "backup-missing", usedBackup: false };
    }
    // Not chained on purpose - see header.
    if (isFailing(backup)) {
        return { entry, reason: "backup-also-failing", usedBackup: false };
    }

    return { entry: backup, reason: `primary "${entry.name}" failing`, usedBackup: true };
}

/**
 * Resolve straight to a usable plaintext secret, applying failover.
 * `decrypt` is passed in so callers keep whatever request/account context
 * their own encryption calls already use.
 * Returns { secret, entry, usedBackup } with secret null when nothing decrypts.
 */
async function resolveVaultSecret(prisma, entry, decrypt) {
    const resolved = await resolveVaultEntry(prisma, entry);
    const target = resolved.entry;
    if (!target) {
        return { entry: null, secret: null, usedBackup: false };
    }

    let secret = null;
    try {
        secret = decrypt(target.encryptedSecret, { appAccountId: target.accountId });
    } catch {
        secret = null;
    }

    // A backup that will not even decrypt is no better than no backup - fall
    // back to the primary rather than returning nothing at all.
    if (!secret && resolved.usedBackup) {
        try {
            secret = decrypt(entry.encryptedSecret, { appAccountId: entry.accountId });
        } catch {
            secret = null;
        }
        return { entry, secret, usedBackup: false };
    }

    return { entry: target, secret, usedBackup: resolved.usedBackup };
}

module.exports = { isFailing, resolveVaultEntry, resolveVaultSecret };
