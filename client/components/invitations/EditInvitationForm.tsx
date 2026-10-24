"use client";

import { useState } from "react";
import { InviteJellyfinAccountPicker } from "@/components/jellyfin/InviteJellyfinAccountPicker";
import { Button, Input, Select } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type Group } from "@/lib/api";

/** What the edit form needs from an invitation - shared by the Invitations
 *  list and an invitation's own page, so both edit it the same way. */
export interface EditableInvitation {
    code: string;
    groupId?: string;
    /** The group it names - shown when that group no longer exists. */
    groupName?: string;
    id: string;
    jellyfinServerKey?: string | null;
    maxUses?: number;
    membershipDuration?: number;
    name?: string;
    syncOnJoin: boolean;
    uses: number;
}

export function EditInvitationForm({
    invitation,
    groups,
    onClose,
}: {
    invitation: EditableInvitation;
    groups: Group[];
    onClose: () => void;
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        groupId: invitation.groupId || "",
        maxUses: invitation.maxUses?.toString() || "",
        membershipDuration: invitation.membershipDuration?.toString() || "",
        name: invitation.name || "",
        syncOnJoin: invitation.syncOnJoin,
    });
    const [jellyfinServerKey, setJellyfinServerKey] = useState<string | null>(
        invitation.jellyfinServerKey || null
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const selectedGroup = groups.find((g) => g.id === formData.groupId);
            await api.updateInvitation(invitation.id, {
                groupId: formData.groupId || undefined,
                groupName: selectedGroup?.name || undefined,
                jellyfinServerKey,
                maxUses: formData.maxUses ? Number.parseInt(formData.maxUses, 10) : undefined,
                membershipDuration: formData.membershipDuration
                    ? Number.parseInt(formData.membershipDuration, 10)
                    : undefined,
                name: formData.name || undefined,
                syncOnJoin: formData.syncOnJoin,
            });
            toast.success("Invitation updated successfully");
            onClose();
            // Refresh page to show updated invitation
            window.location.reload();
        } catch (err: unknown) {
            toast.error((err as Error)?.message || "Failed to update invitation");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="rounded-xl border border-default bg-subtle p-4">
                <p className="mb-1 text-muted text-sm">Invite Code</p>
                <code className="font-mono text-lg text-primary">{invitation.code}</code>
            </div>

            <Input
                hint="Optional. If empty, the invite code will be used as the name."
                label="Invitation Name"
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Friends & Family"
                value={formData.name}
            />

            <Select
                label="Assign to Group"
                onChange={(value) => setFormData({ ...formData, groupId: value })}
                options={[
                    { label: "No group (assign later)", value: "" },
                    ...groups.map((g) => ({ label: g.name, value: g.id })),
                ]}
                value={formData.groupId}
            />
            {invitation.groupName && !invitation.groupId && !formData.groupId && (
                <p className="-mt-4 text-warning text-xs">
                    Its group, {invitation.groupName}, was deleted. Pick another so people who join
                    are put in one.
                </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                    hint="Leave empty for unlimited"
                    label="Max Uses"
                    onChange={(e) => setFormData({ ...formData, maxUses: e.target.value })}
                    placeholder="Unlimited"
                    type="number"
                    value={formData.maxUses}
                />
                <div>
                    <p className="mb-2 font-medium text-muted text-sm">Current Usage</p>
                    <p className="font-medium text-default">{invitation.uses} uses</p>
                </div>
            </div>

            <Select
                label="Membership Duration"
                onChange={(value) => setFormData({ ...formData, membershipDuration: value })}
                options={[
                    { label: "Permanent", value: "" },
                    { label: "7 days", value: "7" },
                    { label: "30 days", value: "30" },
                    { label: "90 days", value: "90" },
                    { label: "1 year", value: "365" },
                ]}
                value={formData.membershipDuration}
            />

            <label className="flex cursor-pointer items-center gap-3">
                <input
                    checked={formData.syncOnJoin}
                    className="h-5 w-5 rounded border-default bg-subtle accent-primary"
                    onChange={(e) => setFormData({ ...formData, syncOnJoin: e.target.checked })}
                    type="checkbox"
                />
                <div>
                    <p className="font-medium text-default">Sync on Join</p>
                    <p className="text-muted text-sm">Automatically sync addons when user joins</p>
                </div>
            </label>

            <InviteJellyfinAccountPicker
                onChange={setJellyfinServerKey}
                value={jellyfinServerKey}
            />

            <div className="flex justify-end gap-3 pt-4">
                <Button onClick={onClose} type="button" variant="secondary">
                    Cancel
                </Button>
                <Button isLoading={isLoading} type="submit" variant="primary">
                    Save Changes
                </Button>
            </div>
        </form>
    );
}
