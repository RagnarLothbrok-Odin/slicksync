"use client";

import { LightBulbIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useBeginnerMode } from "@/lib/beginnerMode";

// One-sentence inline explainer, shown only while Beginner Mode is on
// (Settings -> Appearance). Renders nothing otherwise, so experienced users
// never see it and no layout shifts for them.
//
// `guideId` links into the real guide rather than restating it here - the
// guides are the single source of truth for how a feature works, and a
// second copy of that explanation living in components would drift.

interface BeginnerHintProps {
    /** One plain sentence. Assume the reader knows nothing about the feature. */
    children: React.ReactNode;
    className?: string;
    /** id from lib/helpContent.ts - adds a "Learn more" link when set. */
    guideId?: string;
}

export function BeginnerHint({ children, guideId, className }: BeginnerHintProps) {
    const enabled = useBeginnerMode();
    if (!enabled) {
        return null;
    }

    return (
        <div
            className={`mb-4 flex items-start gap-2.5 rounded-xl p-3 ${className || ""}`}
            style={{
                background: "color-mix(in srgb, var(--color-secondary) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-secondary) 30%, transparent)",
            }}
        >
            <LightBulbIcon
                className="mt-0.5 h-5 w-5 shrink-0"
                style={{ color: "var(--color-secondary)" }}
            />
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
                {children}
                {guideId && (
                    <>
                        {" "}
                        <Link
                            className="font-medium underline"
                            href={`/guides/${guideId}`}
                            style={{ color: "var(--color-secondary)" }}
                        >
                            Learn more
                        </Link>
                    </>
                )}
            </p>
        </div>
    );
}
