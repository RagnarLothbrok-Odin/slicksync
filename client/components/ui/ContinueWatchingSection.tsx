"use client";

import type { ReactNode } from "react";
import { PageSection } from "@/components/layout/PageContainer";
import { useLayoutMode } from "@/lib/layout-mode";
import { Card } from "./Card";

/** Both dashboards use the same section chrome for the selected layout. */
export function ContinueWatchingSection({ children }: { children: ReactNode }) {
    const { layoutMode } = useLayoutMode();
    if (layoutMode === "nebula") {
        return (
            <section aria-label="Continue watching" className="interface-media-section my-7">
                <h2 className="mb-4 font-display font-semibold text-default text-xl">
                    Continue Watching
                </h2>
                {children}
            </section>
        );
    }
    return (
        <PageSection className="mb-6" delay={0.18}>
            <Card padding="lg">
                <h3 className="mb-4 font-display font-semibold text-base text-default">
                    Continue Watching
                </h3>
                {children}
            </Card>
        </PageSection>
    );
}
