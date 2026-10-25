"use client";

// AIOSync from a person's own page (components/user/WatchSyncView.tsx);
// Tasks opens the same page at /tasks/aiosync.

import { useParams } from "next/navigation";
import { WatchSyncView } from "@/components/user/WatchSyncView";

export default function PersonWatchSyncPage() {
    const params = useParams();
    return <WatchSyncView home="person" userId={String(params?.id || "")} />;
}
