// A person's facts in words, for the top of their page in Discover: what
// they do, and when they were born and how old they are, from the fields
// server/utils/personFacts.js sends.

import type { DiscoverPerson } from "./api";

// The work as the person who does it: "Acting" is an actor.
const PEOPLE: Record<string, string> = {
    Acting: "actor",
    Cinematography: "cinematographer",
    Creating: "creator",
    Directing: "director",
    Editing: "editor",
    Music: "composer",
    Producing: "producer",
    Writing: "writer",
};

/** "Actor and producer" - what the person does, as a person. */
export function workAsPerson(knownFor: string[] | null | undefined): string | null {
    const roles = (knownFor ?? []).map((w) => PEOPLE[w] ?? w.toLowerCase()).filter(Boolean);
    if (roles.length === 0) {
        return null;
    }
    const text =
        roles.length === 1 ? roles[0] : `${roles.slice(0, -1).join(", ")} and ${roles.at(-1)}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// "1962-07-03" read as the calendar date it is - never through a time zone,
// which would move a birthday a day either way.
function parts(iso: string | null | undefined): { y: number; m: number; d: number } | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
    return m ? { d: Number(m[3]), m: Number(m[2]), y: Number(m[1]) } : null;
}

const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const longDate = (p: { y: number; m: number; d: number }) => `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;

function yearsBetween(
    from: { y: number; m: number; d: number },
    to: { y: number; m: number; d: number }
): number {
    let age = to.y - from.y;
    if (to.m < from.m || (to.m === from.m && to.d < from.d)) {
        age -= 1;
    }
    return age;
}

/** "Born July 3, 1962 · age 64", or with a death, "July 3, 1962 – March 1, 2020 (aged 57)". */
export function bornLine(
    facts: Pick<DiscoverPerson, "birthday" | "deathday">,
    now = new Date()
): string | null {
    const b = parts(facts.birthday);
    if (!b) {
        return null;
    }
    const d = parts(facts.deathday);
    const end = d ?? { d: now.getDate(), m: now.getMonth() + 1, y: now.getFullYear() };
    const age = yearsBetween(b, end);
    return d ? `${longDate(b)} – ${longDate(d)} (aged ${age})` : `Born ${longDate(b)} · age ${age}`;
}
