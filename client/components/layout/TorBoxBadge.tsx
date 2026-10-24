"use client";

// Referral badge next to the admin panel switcher (NebulaTopbar + Sidebar) -
// admin-only by design, not shown in the managed-user self-service panel
// (PersonTopbar), since a referral code has no business being shown to every
// family member logging into their own account.
export function TorBoxBadge({ size = 36 }: { size?: number }) {
    return (
        <a
            className="flex shrink-0 items-center justify-center rounded-lg transition-transform hover:scale-105"
            href="https://torbox.app/subscription?referral=790ccd5b-646d-43d7-9072-aef7a6eb1de8"
            rel="noopener noreferrer"
            style={{ height: size, width: size }}
            target="_blank"
            title="TorBox"
        >
            <img
                alt="TorBox"
                className="h-full w-full"
                src="https://torbox.app/assets/logo-bb7a9579.svg"
            />
        </a>
    );
}
