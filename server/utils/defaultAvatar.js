const { randomBytes, randomInt } = require("node:crypto");

const BACKGROUNDS = [
    "e8ecff",
    "d5f2e8",
    "fce7d5",
    "f6dfe9",
    "dceafa",
    "fff0ba",
    "c7c9d1",
    "bde7f0",
];

// Called only when creating an account or person. Persist the complete URL
// so signing in, changing a name and restarting never reroll the avatar.
function createDefaultAvatar() {
    const seed = randomBytes(16).toString("hex");
    const background = BACKGROUNDS[randomInt(BACKGROUNDS.length)];
    return `https://api.dicebear.com/10.x/voxel-bot/svg?seed=${seed}&backgroundColor=${background}`;
}

module.exports = { createDefaultAvatar };
