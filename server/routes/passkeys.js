/**
 * Passkey management - listing, adding and removing the passkeys registered
 * against this account. Signing in with one lives in publicAuth.js instead,
 * because that is where session cookies are issued and there is no session
 * to authenticate a login request with.
 *
 * Everything here requires an existing session: a passkey can only ever be
 * added by someone already signed in, which is what keeps "add a passkey"
 * from being a way to get in.
 */

const express = require("express");
const { publicMessage } = require("../utils/publicError");
const {
    getLib,
    putChallenge,
    takeChallenge,
    rpFromRequest,
    RP_NAME,
} = require("../utils/webauthn");

module.exports = ({ prisma, getAccountId }) => {
    const router = express.Router();

    const shape = (p) => ({
        createdAt: p.createdAt,
        id: p.id,
        lastUsedAt: p.lastUsedAt,
        name: p.name,
        rpId: p.rpId,
    });

    // GET /api/passkeys - what is registered, for the Security settings list.
    router.get("/", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const rows = await prisma.passkey.findMany({
                orderBy: { createdAt: "desc" },
                where: { accountId },
            });
            const rp = rpFromRequest(req);
            res.json({
                // The hostname this browser is on, so the UI can point out a passkey
                // that belongs to a different address and will not be offered here.
                currentRpId: rp?.rpID || null,
                passkeys: rows.map(shape),
            });
        } catch (e) {
            res.status(500).json({ error: publicMessage(e, "Failed to read passkeys") });
        }
    });

    // POST /api/passkeys/register/options - challenge for creating a passkey.
    router.post("/register/options", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const rp = rpFromRequest(req);
            if (!rp) {
                return res.status(400).json({ error: "Could not determine this instance address" });
            }

            const { generateRegistrationOptions } = await getLib();
            const existing = await prisma.passkey.findMany({
                select: { credentialId: true, transports: true },
                where: { accountId },
            });

            const options = await generateRegistrationOptions({
                attestationType: "none",
                authenticatorSelection: {
                    // Discoverable, so the login page can offer a passkey without
                    // being told who is signing in first.
                    residentKey: "required",
                    userVerification: "preferred",
                },
                // Already-registered credentials are excluded so the authenticator
                // says "you already have one of these" instead of quietly making a
                // second passkey for the same device.
                excludeCredentials: existing.map((p) => ({
                    id: p.credentialId,
                    transports: (() => {
                        try {
                            return JSON.parse(p.transports || "[]");
                        } catch {
                            return [];
                        }
                    })(),
                })),
                rpID: rp.rpID,
                rpName: RP_NAME,
                userDisplayName: "SlickSync",
                // The account id is the WebAuthn user handle. A private instance has
                // exactly one account, so this is stable and carries nothing
                // personal - no email, no username.
                userID: new TextEncoder().encode(accountId),
                userName: req.body?.label ? String(req.body.label).slice(0, 40) : "SlickSync",
            });

            putChallenge(`reg:${accountId}`, {
                challenge: options.challenge,
                origin: rp.origin,
                rpID: rp.rpID,
            });
            res.json(options);
        } catch (e) {
            res.status(500).json({
                error: publicMessage(e, "Failed to start passkey registration"),
            });
        }
    });

    // POST /api/passkeys/register/verify - finish creating a passkey.
    router.post("/register/verify", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const pending = takeChallenge(`reg:${accountId}`);
            if (!pending) {
                return res.status(400).json({ error: "That registration expired - start again" });
            }

            const { verifyRegistrationResponse } = await getLib();
            const verification = await verifyRegistrationResponse({
                expectedChallenge: pending.challenge,
                expectedOrigin: pending.origin,
                expectedRPID: pending.rpID,
                requireUserVerification: false,
                response: req.body?.credential,
            });
            if (!(verification.verified && verification.registrationInfo)) {
                return res.status(400).json({ error: "That passkey could not be verified" });
            }

            const info = verification.registrationInfo;
            const cred = info.credential;
            const name =
                String(req.body?.name || "")
                    .trim()
                    .slice(0, 40) || "Passkey";

            await prisma.passkey.create({
                data: {
                    accountId,
                    counter: Number(cred.counter) || 0,
                    credentialId: cred.id,
                    name,
                    publicKey: Buffer.from(cred.publicKey).toString("base64url"),
                    rpId: pending.rpID,
                    transports: JSON.stringify(
                        cred.transports || req.body?.credential?.response?.transports || []
                    ),
                },
            });

            const rows = await prisma.passkey.findMany({
                orderBy: { createdAt: "desc" },
                where: { accountId },
            });
            res.status(201).json({ passkeys: rows.map(shape), success: true });
        } catch (e) {
            // A duplicate credential id means this authenticator is already
            // registered - not an error worth a stack trace.
            if (/unique/i.test(e?.message || "")) {
                return res
                    .status(409)
                    .json({ error: "That device already has a passkey for this instance" });
            }
            res.status(500).json({ error: publicMessage(e, "Failed to save that passkey") });
        }
    });

    // DELETE /api/passkeys/:id - remove one.
    router.delete("/:id", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const row = await prisma.passkey.findFirst({ where: { accountId, id: req.params.id } });
            if (!row) {
                return res.status(404).json({ error: "Passkey not found" });
            }
            await prisma.passkey.delete({ where: { id: row.id } });
            const rows = await prisma.passkey.findMany({
                orderBy: { createdAt: "desc" },
                where: { accountId },
            });
            res.json({ passkeys: rows.map(shape), success: true });
        } catch (e) {
            res.status(500).json({ error: publicMessage(e, "Failed to remove that passkey") });
        }
    });

    return router;
};
