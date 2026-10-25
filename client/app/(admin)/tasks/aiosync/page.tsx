"use client";

// AIOSync, reached from Tasks: the same page as on a person's own page,
// with a For switcher on top to change person without leaving it.

import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/ui";
import { WatchSyncView } from "@/components/user/WatchSyncView";
import { api, type User } from "@/lib/api";
import { providerTypeLabel } from "@/lib/providers";

function ForSwitcher({
    people,
    current,
    onPick,
}: {
    people: User[];
    current: User | null;
    onPick: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const close = (e: MouseEvent | TouchEvent) => {
            if (!ref.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("touchstart", close);
        document.addEventListener("keydown", esc);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("touchstart", close);
            document.removeEventListener("keydown", esc);
        };
    }, [open]);
    return (
        <div className="mb-5 flex items-center justify-center gap-2.5">
            <span className="text-muted text-sm">For</span>
            <div className="relative" ref={ref}>
                <button
                    aria-expanded={open}
                    className="inline-flex items-center gap-2 rounded-full border border-default bg-surface-hover py-1 pr-3 pl-1 font-semibold text-default text-sm"
                    onClick={() => setOpen((o) => !o)}
                    type="button"
                >
                    {current ? (
                        <>
                            <UserAvatar
                                colorIndex={current.colorIndex}
                                email={current.email}
                                name={current.username}
                                size="xs"
                                src={current.avatarUrl || undefined}
                                useGravatar={current.useGravatar}
                                userId={current.id}
                            />
                            {current.username}
                        </>
                    ) : (
                        <span className="pl-2">Choose a person</span>
                    )}
                    <ChevronDownIcon className="h-4 w-4 text-muted" />
                </button>
                {open && (
                    <div className="absolute left-1/2 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-default bg-surface p-2 shadow-xl">
                        {people.map((p) => (
                            <button
                                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-hover"
                                key={p.id}
                                onClick={() => {
                                    setOpen(false);
                                    onPick(p.id);
                                }}
                                type="button"
                            >
                                <UserAvatar
                                    colorIndex={p.colorIndex}
                                    email={p.email}
                                    name={p.username}
                                    size="sm"
                                    src={p.avatarUrl || undefined}
                                    useGravatar={p.useGravatar}
                                    userId={p.id}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-default text-sm">
                                        {p.username}
                                    </span>
                                    <span className="block truncate text-muted text-xs">
                                        {providerTypeLabel(p.providerType)}
                                    </span>
                                </span>
                                {p.id === current?.id && (
                                    <CheckIcon
                                        className="h-4 w-4"
                                        style={{ color: "var(--color-primary)" }}
                                    />
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function WatchSyncFromTasks() {
    const router = useRouter();
    const search = useSearchParams();
    const [people, setPeople] = useState<User[] | null>(null);
    useEffect(() => {
        api.getUsers()
            .then(setPeople)
            .catch(() => setPeople([]));
    }, []);

    const wanted = search.get("person");
    // Nobody is picked for you - the page waits until you choose who.
    const current = people?.find((p) => p.id === wanted) || null;
    if (!people) {
        return null;
    }
    if (!people.length) {
        return (
            <p className="p-10 text-center text-muted">
                Add people first - AIOSync works between their sign-ins.
            </p>
        );
    }
    return (
        <WatchSyncView
            forSlot={
                <ForSwitcher
                    current={current}
                    onPick={(id) =>
                        router.replace(`/tasks/aiosync?person=${encodeURIComponent(id)}`)
                    }
                    people={people}
                />
            }
            home="tasks"
            key={current?.id || "nobody"}
            userId={current?.id || ""}
        />
    );
}

export default function WatchSyncPage() {
    return (
        <Suspense fallback={null}>
            <WatchSyncFromTasks />
        </Suspense>
    );
}
