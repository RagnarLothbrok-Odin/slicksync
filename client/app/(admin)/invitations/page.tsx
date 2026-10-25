"use client";

import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import {
    ArrowPathIcon,
    ArrowUturnLeftIcon,
    CheckIcon,
    ClipboardIcon,
    DocumentDuplicateIcon,
    EnvelopeIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    LinkIcon,
    PencilIcon,
    PlusIcon,
    QrCodeIcon,
    TrashIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { EditInvitationForm } from "@/components/invitations/EditInvitationForm";
import { InviteJellyfinAccountPicker } from "@/components/jellyfin/InviteJellyfinAccountPicker";
import { Header } from "@/components/layout/Header";
import { NebulaGlassStripe, NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { TVPageProvider } from "@/components/tv/TVPageProvider";
import {
    Badge,
    Button,
    Card,
    ConfirmModal,
    ContextMenu,
    Input,
    Modal,
    PageToolbar,
    Select,
    SelectAllCheckbox,
    SelectionCheckbox,
    UserAvatar,
    useContextMenu,
} from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { api, type Group, type Invitation } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";
import { useIsTV } from "@/lib/hooks/useIsTV";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLayoutMode } from "@/lib/layout-mode";
import { displayEmail } from "@/lib/providers";
import { useDefaultViewMode } from "@/lib/viewMode";

// Invitation display type
interface InvitationDisplay {
    code: string;
    createdAt: string;
    expiresAt?: string;
    groupColor?: string;
    groupId?: string;
    /** Its group was deleted (or renamed before renames carried over): joiners land in no group. */
    groupMissing?: boolean;
    groupName?: string;
    id: string;
    isActive?: boolean;
    jellyfinServerKey?: string | null;
    maxUses?: number;
    membershipDuration?: number;
    name?: string;
    syncOnJoin: boolean;
    uses: number;
}

// Request display type
interface RequestDisplay {
    createdAt: string;
    email?: string;
    id: string;
    invitationId: string;
    oauthCode?: string;
    oauthExpiresAt?: string;
    oauthLink?: string;
    respondedAt?: string;
    status: "pending" | "accepted" | "rejected" | "joined" | "expired" | "renewed" | "removed";
    userId?: string;
    username?: string;
}

export default function InvitationsPage() {
    const { layoutMode } = useLayoutMode();
    const isTV = useIsTV();
    const Wrapper = isTV ? TVPageProvider : Fragment;
    const [activeTab, setActiveTab] = useState<"invitations" | "requests">("invitations");
    const { viewMode, setViewMode: _setViewMode } = useDefaultViewMode();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Data state
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    // Only once the groups are known can an invitation's group be called missing.
    const [groupsLoaded, setGroupsLoaded] = useState(false);
    const [requests, setRequests] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Instant navigation: last-known invitations and groups shown at once
    // while the fetch below refreshes them - see useLastKnown's comment.
    useLastKnown<Invitation[]>("/invitations", (cached) => {
        setInvitations(cached);
        setIsLoading(false);
    });
    useLastKnown<Group[]>("/groups", (cached) => {
        setGroups(cached);
        setGroupsLoaded(true);
    });
    const [error, setError] = useState<Error | null>(null);

    // Multi-select state - NO isSelectMode, just selectedIds
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Single item delete state (for quick action menu)
    const [deleteTarget, setDeleteTarget] = useState<InvitationDisplay | null>(null);

    // Edit state
    const [editTarget, setEditTarget] = useState<InvitationDisplay | null>(null);

    // Duplicate state
    const [duplicateTarget, setDuplicateTarget] = useState<InvitationDisplay | null>(null);

    // Fetch invitations, groups, and requests
    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [invitationsData, groupsData] = await Promise.all([
                    api.getInvitations(),
                    api.getGroups(),
                ]);
                setInvitations(invitationsData);
                setGroups(groupsData);
                setGroupsLoaded(true);

                // Extract requests from invitations (they may be embedded)
                const allRequests: any[] = [];
                for (const inv of invitationsData) {
                    if (inv.requests && Array.isArray(inv.requests)) {
                        allRequests.push(
                            ...inv.requests.map((req) => ({
                                ...req,
                                invitationId: inv.id,
                            }))
                        );
                    } else {
                        // Try to fetch requests if not embedded
                        try {
                            const invRequests = await api.getInvitationRequests(inv.id);
                            if (Array.isArray(invRequests)) {
                                allRequests.push(
                                    ...invRequests.map((req) => ({
                                        ...req,
                                        invitationId: inv.id,
                                    }))
                                );
                            }
                        } catch {
                            // Skip if requests can't be fetched for this invitation
                        }
                    }
                }
                setRequests(allRequests);
            } catch (err) {
                setError(err as Error);
                toast.error("Failed to load invitations");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    // Transform invitations for display
    const invitationsDisplay = useMemo<InvitationDisplay[]>(() => {
        // Map groups by name so we can recover color/id from invitation.groupName
        const groupByName = new Map(groups.map((g) => [g.name, g]));

        // Group requests by invitation ID
        const requestsByInvitation = new Map<string, any[]>();
        for (const req of requests) {
            const invId = String(req.invitationId || req.invitation?.id || "");
            if (invId) {
                const bucket = requestsByInvitation.get(invId);
                if (bucket) {
                    bucket.push(req);
                } else {
                    requestsByInvitation.set(invId, [req]);
                }
            }
        }

        return (invitations || []).map((inv) => {
            const code = inv.code || inv.inviteCode || "";
            const rawGroupName = inv.groupName || "";
            const group = rawGroupName ? groupByName.get(rawGroupName) : undefined;

            const maxUses: number | undefined =
                typeof inv.maxUses === "number" ? inv.maxUses : undefined;

            // Calculate base uses from backend
            const baseUses: number =
                typeof inv.uses === "number"
                    ? inv.uses
                    : typeof inv.currentUses === "number"
                      ? inv.currentUses
                      : 0;

            // Add accepted requests count (since they occupy a slot but might not be fully joined yet)
            const invitationRequests = requestsByInvitation.get(String(inv.id)) || [];
            const acceptedRequests = invitationRequests.filter(
                (r: any) => r.status === "accepted"
            ).length;
            const uses = baseUses + acceptedRequests;

            const membershipDuration: number | undefined =
                typeof inv.membershipDuration === "number"
                    ? inv.membershipDuration
                    : typeof inv.membershipDurationDays === "number"
                      ? inv.membershipDurationDays
                      : undefined;

            return {
                code,
                createdAt: inv.createdAt || new Date().toISOString(),
                expiresAt: inv.expiresAt || undefined,
                groupColor: group?.color,
                groupId: group?.id,
                groupMissing: groupsLoaded && !!rawGroupName && !group,
                groupName: rawGroupName || group?.name,
                id: String(inv.id),
                isActive: inv.isActive !== false,
                jellyfinServerKey:
                    (inv as { jellyfinServerKey?: string | null }).jellyfinServerKey || null,
                maxUses,
                membershipDuration,
                name: inv.name || code,
                syncOnJoin: inv.syncOnJoin === true,
                uses,
            };
        });
    }, [invitations, groups, groupsLoaded, requests]);

    // Transform requests for display
    const requestsDisplay = useMemo<RequestDisplay[]>(
        () =>
            (requests || []).map((req: any) => ({
                createdAt: req.createdAt || req.requestedAt || new Date().toISOString(),
                email: req.email,
                id: req.id,
                invitationId: req.invitationId || req.invitation?.id || "",
                status: req.status || "pending",
                username: req.username,
            })),
        [requests]
    );

    const pendingRequests = requestsDisplay.filter((r) => r.status === "pending");

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedIds(new Set(invitationsDisplay.map((i) => i.id)));
    }, [invitationsDisplay]);

    const deselectAll = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const handleDeleteSelected = useCallback(async () => {
        setIsDeleting(true);
        const ids = Array.from(selectedIds);
        let success = 0;

        for (const id of ids) {
            try {
                await api.deleteInvitation(id);
                success++;
            } catch (err) {
                console.error("Failed to delete invitation:", err);
            }
        }

        setIsDeleting(false);
        setIsDeleteModalOpen(false);
        if (success > 0) {
            toast.success(`Deleted ${success} invitation${success === 1 ? "" : "s"} successfully`);
            // Refresh invitations
            try {
                const invitationsData = await api.getInvitations();
                setInvitations(invitationsData);
            } catch (err) {
                console.error("Failed to refresh invitations:", err);
            }
        }
        setSelectedIds(new Set());
    }, [selectedIds]);

    // Delete single invitation (from quick action menu)
    const handleDeleteSingle = useCallback(async () => {
        if (!deleteTarget) {
            return;
        }
        setIsDeleting(true);
        try {
            await api.deleteInvitation(deleteTarget.id);
            toast.success(`Invitation ${deleteTarget.code} deleted successfully`);
            // Refresh invitations
            try {
                const invitationsData = await api.getInvitations();
                setInvitations(invitationsData);
            } catch (err) {
                console.error("Failed to refresh invitations:", err);
            }
        } catch (err) {
            toast.error(`Failed to delete invitation ${deleteTarget.code}`);
            console.error("Failed to delete invitation:", err);
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    }, [deleteTarget]);

    // Reset selection when switching tabs
    const handleTabChange = (tab: "invitations" | "requests") => {
        setActiveTab(tab);
        setSelectedIds(new Set());
    };

    const hasSelection = selectedIds.size > 0;

    return (
        <Wrapper>
            {layoutMode !== "nebula" && (
                <Header
                    subtitle={
                        isLoading
                            ? "Loading..."
                            : `${invitations.length} active invite${invitations.length === 1 ? "" : "s"} • ${pendingRequests.length} pending request${pendingRequests.length === 1 ? "" : "s"}`
                    }
                    title="Invitations"
                />
            )}

            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={
                        layoutMode === "nebula"
                            ? { maxWidth: "var(--interface-content-width)" }
                            : undefined
                    }
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            subtitle={
                                isLoading
                                    ? "Loading..."
                                    : `${invitations.length} active invite${invitations.length === 1 ? "" : "s"} • ${pendingRequests.length} pending request${pendingRequests.length === 1 ? "" : "s"}`
                            }
                            title="Invitations"
                        />
                    )}
                    <div className="interface-management-content">
                        {layoutMode === "nebula" && <NebulaGlassStripe />}
                        {/* Filters */}
                        <PageToolbar
                            filterTabs={{
                                activeKey: activeTab,
                                layoutId: "invitations-filter-tabs",
                                onChange: (key) =>
                                    handleTabChange(key as "invitations" | "requests"),
                                options: [
                                    { key: "invitations", label: "Invitations" },
                                    {
                                        badge:
                                            pendingRequests.length > 0
                                                ? {
                                                      value: pendingRequests.length,
                                                      variant: "error" as const,
                                                  }
                                                : undefined,
                                        key: "requests",
                                        label: "Requests",
                                    },
                                ],
                            }}
                            primaryAction={(() => {
                                const btn = (
                                    <Button
                                        leftIcon={<PlusIcon className="h-5 w-5" />}
                                        onClick={() => setIsCreateModalOpen(true)}
                                        variant="primary"
                                    >
                                        Add
                                    </Button>
                                );
                                return isTV ? (
                                    <TVFocusable onEnterPress={() => setIsCreateModalOpen(true)}>
                                        {btn}
                                    </TVFocusable>
                                ) : (
                                    btn
                                );
                            })()}
                            selectionConfig={
                                activeTab === "invitations"
                                    ? {
                                          onDeselectAll: deselectAll,
                                          onSelectAll: selectAll,
                                          selectedCount: selectedIds.size,
                                          totalCount: invitationsDisplay.length,
                                      }
                                    : undefined
                            }
                        />

                        <AnimatePresence mode="wait">
                            {activeTab === "invitations" ? (
                                <motion.div
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    initial={{ opacity: 0, x: -20 }}
                                    key="invitations"
                                >
                                    {isLoading ? (
                                        <div className="py-16 text-center">
                                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                                <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                                            </div>
                                            <p className="text-muted">Loading invitations...</p>
                                        </div>
                                    ) : error ? (
                                        <div className="py-16 text-center">
                                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                                <XMarkIcon className="h-8 w-8 text-error" />
                                            </div>
                                            <h3 className="mb-2 font-medium text-default text-lg">
                                                Error Loading Invitations
                                            </h3>
                                            <p className="mb-4 text-muted">{error.message}</p>
                                            <Button
                                                onClick={() => window.location.reload()}
                                                variant="primary"
                                            >
                                                Retry
                                            </Button>
                                        </div>
                                    ) : (
                                        <LayoutGroup>
                                            <AnimatePresence mode="popLayout">
                                                {viewMode === "grid" ? (
                                                    <StaggerContainer
                                                        className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
                                                        key="grid"
                                                    >
                                                        <AnimatePresence mode="popLayout">
                                                            {invitationsDisplay.map((invite) => (
                                                                <StaggerItem key={invite.id}>
                                                                    <InvitationCard
                                                                        focusable={isTV}
                                                                        invitation={invite}
                                                                        isSelected={selectedIds.has(
                                                                            invite.id
                                                                        )}
                                                                        onDelete={() =>
                                                                            setDeleteTarget(invite)
                                                                        }
                                                                        onDuplicate={() =>
                                                                            setDuplicateTarget(
                                                                                invite
                                                                            )
                                                                        }
                                                                        onEdit={() =>
                                                                            setEditTarget(invite)
                                                                        }
                                                                        onToggleSelect={() =>
                                                                            toggleSelect(invite.id)
                                                                        }
                                                                    />
                                                                </StaggerItem>
                                                            ))}
                                                        </AnimatePresence>
                                                    </StaggerContainer>
                                                ) : (
                                                    <motion.div
                                                        animate={{ opacity: 1 }}
                                                        className="overflow-hidden overflow-x-auto rounded-2xl border border-default bg-surface"
                                                        exit={{ opacity: 0 }}
                                                        initial={{ opacity: 0 }}
                                                        key="list"
                                                        layout
                                                    >
                                                        <table className="w-full min-w-[500px]">
                                                            <thead>
                                                                <tr className="border-default border-b">
                                                                    <th className="w-12 px-4 py-4 text-left">
                                                                        <SelectAllCheckbox
                                                                            onDeselectAll={
                                                                                deselectAll
                                                                            }
                                                                            onSelectAll={selectAll}
                                                                            selectedCount={
                                                                                selectedIds.size
                                                                            }
                                                                            totalCount={
                                                                                invitationsDisplay.length
                                                                            }
                                                                        />
                                                                    </th>
                                                                    <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                        Invitation
                                                                    </th>
                                                                    <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                        Group
                                                                    </th>
                                                                    <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                        Uses
                                                                    </th>
                                                                    <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                        Expires
                                                                    </th>
                                                                    <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                        Actions
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                <AnimatePresence mode="popLayout">
                                                                    {invitationsDisplay.map(
                                                                        (invite) => (
                                                                            <motion.tr
                                                                                animate={{
                                                                                    opacity: 1,
                                                                                }}
                                                                                className={`cursor-pointer border-default border-b transition-colors ${
                                                                                    selectedIds.has(
                                                                                        invite.id
                                                                                    )
                                                                                        ? "bg-primary-muted"
                                                                                        : "hover:bg-white/5"
                                                                                }`}
                                                                                exit={{
                                                                                    opacity: 0,
                                                                                }}
                                                                                initial={{
                                                                                    opacity: 0,
                                                                                }}
                                                                                key={invite.id}
                                                                                onClick={() =>
                                                                                    toggleSelect(
                                                                                        invite.id
                                                                                    )
                                                                                }
                                                                            >
                                                                                <td className="px-4 py-4">
                                                                                    <div
                                                                                        className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-all ${
                                                                                            selectedIds.has(
                                                                                                invite.id
                                                                                            )
                                                                                                ? "border-primary bg-primary"
                                                                                                : "border-default"
                                                                                        }`}
                                                                                    >
                                                                                        {selectedIds.has(
                                                                                            invite.id
                                                                                        ) && (
                                                                                            <CheckIcon className="h-3 w-3 text-white" />
                                                                                        )}
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-6 py-4">
                                                                                    <div>
                                                                                        <p
                                                                                            className="truncate font-medium text-default"
                                                                                            style={{
                                                                                                maxWidth:
                                                                                                    "200px",
                                                                                            }}
                                                                                        >
                                                                                            {invite.name ||
                                                                                                invite.code}
                                                                                        </p>
                                                                                        <p className="font-mono text-muted text-sm">
                                                                                            {
                                                                                                invite.code
                                                                                            }
                                                                                        </p>
                                                                                    </div>
                                                                                </td>
                                                                                <td
                                                                                    className={`px-6 py-4 ${invite.groupMissing ? "text-warning" : "text-muted"}`}
                                                                                >
                                                                                    {invite.groupName ||
                                                                                        "No group"}
                                                                                    {invite.groupMissing
                                                                                        ? " (deleted)"
                                                                                        : ""}
                                                                                </td>
                                                                                <td className="px-6 py-4 text-muted">
                                                                                    {invite.uses}/
                                                                                    {invite.maxUses ||
                                                                                        "∞"}
                                                                                </td>
                                                                                <td className="px-6 py-4 text-muted">
                                                                                    {invite.expiresAt
                                                                                        ? new Date(
                                                                                              invite.expiresAt
                                                                                          ).toLocaleDateString()
                                                                                        : "Never"}
                                                                                </td>
                                                                                <td className="px-6 py-4">
                                                                                    <Button
                                                                                        onClick={(
                                                                                            e
                                                                                        ) => {
                                                                                            e.stopPropagation();
                                                                                            const origin =
                                                                                                typeof window ===
                                                                                                "undefined"
                                                                                                    ? ""
                                                                                                    : window
                                                                                                          .location
                                                                                                          .origin;
                                                                                            copyToClipboard(
                                                                                                `${origin}/invite/${invite.code}`
                                                                                            );
                                                                                            toast.success(
                                                                                                "Invite link copied"
                                                                                            );
                                                                                        }}
                                                                                        size="sm"
                                                                                        variant="ghost"
                                                                                    >
                                                                                        <ClipboardIcon className="h-4 w-4" />
                                                                                    </Button>
                                                                                </td>
                                                                            </motion.tr>
                                                                        )
                                                                    )}
                                                                </AnimatePresence>
                                                            </tbody>
                                                        </table>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </LayoutGroup>
                                    )}

                                    {!(isLoading || error) && invitationsDisplay.length === 0 && (
                                        <EmptyState
                                            action={
                                                <Button
                                                    onClick={() => setIsCreateModalOpen(true)}
                                                    variant="primary"
                                                >
                                                    Create invitation
                                                </Button>
                                            }
                                            description="Create an invitation so someone can join your household with their own sign-in."
                                            icon={<EnvelopeIcon className="h-6 w-6" />}
                                            title="A place for your people"
                                        />
                                    )}
                                </motion.div>
                            ) : (
                                <motion.div
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    initial={{ opacity: 0, x: 20 }}
                                    key="requests"
                                >
                                    {/* Request Status Summary */}
                                    {!isLoading && requestsDisplay.length > 0 && (
                                        <div className="mb-6">
                                            <Card padding="md">
                                                <div className="flex items-center justify-between">
                                                    <h3 className="font-medium text-default">
                                                        Request Summary
                                                    </h3>
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-3 w-3 rounded-full bg-warning" />
                                                            <span className="text-muted text-sm">
                                                                {
                                                                    requestsDisplay.filter(
                                                                        (r) =>
                                                                            r.status === "pending"
                                                                    ).length
                                                                }{" "}
                                                                pending
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-3 w-3 rounded-full bg-success" />
                                                            <span className="text-muted text-sm">
                                                                {
                                                                    requestsDisplay.filter(
                                                                        (r) =>
                                                                            r.status ===
                                                                                "accepted" ||
                                                                            r.status === "joined"
                                                                    ).length
                                                                }{" "}
                                                                accepted
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-3 w-3 rounded-full bg-error" />
                                                            <span className="text-muted text-sm">
                                                                {
                                                                    requestsDisplay.filter(
                                                                        (r) =>
                                                                            r.status === "rejected"
                                                                    ).length
                                                                }{" "}
                                                                rejected
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </Card>
                                        </div>
                                    )}

                                    {isLoading ? (
                                        <div className="py-16 text-center">
                                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                                <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                                            </div>
                                            <p className="text-muted">Loading requests...</p>
                                        </div>
                                    ) : (
                                        <StaggerContainer className="space-y-4">
                                            {requestsDisplay.map((request) => (
                                                <StaggerItem key={request.id}>
                                                    <RequestCard
                                                        onUpdate={() => {
                                                            // Refresh invitations to get updated requests
                                                            api.getInvitations()
                                                                .then(setInvitations)
                                                                .catch(console.error);
                                                        }}
                                                        request={request}
                                                    />
                                                </StaggerItem>
                                            ))}
                                        </StaggerContainer>
                                    )}

                                    {!isLoading && requestsDisplay.length === 0 && (
                                        <div className="py-16 text-center">
                                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                                <EnvelopeIcon className="h-8 w-8 text-subtle" />
                                            </div>
                                            <h3 className="mb-2 font-medium text-default text-lg">
                                                No pending requests
                                            </h3>
                                            <p className="text-muted">
                                                Invite requests will appear here when users try to
                                                join
                                            </p>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Floating Action Bar */}
            <AnimatePresence>
                {hasSelection && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
                        exit={{ opacity: 0, y: 100 }}
                        initial={{ opacity: 0, y: 100 }}
                    >
                        <div className="flex items-center gap-4 rounded-2xl border border-default bg-surface px-6 py-4 shadow-2xl backdrop-blur-xl">
                            <div className="flex items-center gap-2 border-default border-r pr-4">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted">
                                    <span className="font-bold text-primary text-sm">
                                        {selectedIds.size}
                                    </span>
                                </div>
                                <span className="text-muted text-sm">selected</span>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    leftIcon={<TrashIcon className="h-4 w-4" />}
                                    onClick={() => setIsDeleteModalOpen(true)}
                                    size="sm"
                                    variant="danger"
                                >
                                    Delete
                                </Button>
                            </div>

                            <button
                                className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover"
                                onClick={deselectAll}
                                type="button"
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Floating Add Button - Mobile Only */}
            <button
                aria-label="Create invitation"
                className="nav-item-hover-pill fixed right-4 bottom-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-default bg-surface shadow-lg lg:hidden"
                onClick={() => setIsCreateModalOpen(true)}
                style={{
                    boxShadow:
                        "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                }}
                type="button"
            >
                <PlusIcon className="h-6 w-6" />
            </button>

            {/* Create Invitation Modal */}
            <CreateInvitationModal
                groups={groups}
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
            />

            {/* Delete Confirmation Modal (bulk) */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete Invitations"}
                description={`Are you sure you want to delete ${selectedIds.size} invitation${selectedIds.size === 1 ? "" : "s"}? This will invalidate the invite codes.`}
                isLoading={isDeleting}
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteSelected}
                title="Delete Invitations"
                variant="danger"
            />

            {/* Delete Confirmation Modal (single) */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete Invitation"}
                description={`Are you sure you want to delete invitation "${deleteTarget?.code}"? This will invalidate the invite code.`}
                isLoading={isDeleting}
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDeleteSingle}
                title="Delete Invitation"
                variant="danger"
            />

            {/* Edit Invitation Modal */}
            <Modal
                description={`Update settings for invitation ${editTarget?.code}`}
                isOpen={!!editTarget}
                onClose={() => setEditTarget(null)}
                size="md"
                title="Edit Invitation"
            >
                {editTarget && (
                    <EditInvitationForm
                        groups={groups}
                        invitation={editTarget}
                        onClose={() => setEditTarget(null)}
                    />
                )}
            </Modal>

            {/* Duplicate Invitation Modal */}
            <Modal
                description={`Create a new invitation based on ${duplicateTarget?.code}`}
                isOpen={!!duplicateTarget}
                onClose={() => setDuplicateTarget(null)}
                size="md"
                title="Duplicate Invitation"
            >
                {duplicateTarget && (
                    <DuplicateInvitationForm
                        groups={groups}
                        invitation={duplicateTarget}
                        onClose={() => setDuplicateTarget(null)}
                    />
                )}
            </Modal>
        </Wrapper>
    );
}

// Invitation Card - with click-to-toggle selection
function InvitationCard({
    invitation,
    isSelected,
    onToggleSelect,
    onDelete,
    onEdit,
    onDuplicate,
    focusable = false,
}: {
    invitation: InvitationDisplay;
    isSelected: boolean;
    onToggleSelect: () => void;
    onDelete: () => void;
    onEdit: () => void;
    onDuplicate: () => void;
    /** TV mode: wraps the card in a D-pad-focusable container. Enter/OK
     *  opens the invitation, the same as a click. */
    focusable?: boolean;
}) {
    const router = useRouter();
    const [_copiedLink, setCopiedLink] = useState(false);
    const [copiedCode, setCopiedCode] = useState(false);
    const { isOpen, position, handleContextMenu, close } = useContextMenu();

    // Add touch handling for mobile context menu
    const touchTimerRef = useRef<NodeJS.Timeout | null>(null);
    // A long press opens the menu; the tap that ends it must not also open
    // the invitation underneath.
    const longPressedRef = useRef(false);

    const handleTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        longPressedRef.current = false;
        touchTimerRef.current = setTimeout(() => {
            longPressedRef.current = true;
            // Create a synthetic mouse event-like object for handleContextMenu
            const syntheticEvent = {
                clientX: touch.clientX,
                clientY: touch.clientY,
                preventDefault: () => undefined,
            } as unknown as React.MouseEvent;

            handleContextMenu(syntheticEvent);
        }, 500); // 500ms long press
    };

    const handleTouchEnd = () => {
        if (touchTimerRef.current) {
            clearTimeout(touchTimerRef.current);
            touchTimerRef.current = null;
        }
    };

    // QR onboarding: hand a phone the invite without typing anything - point
    // the camera, open the link, connect the provider, and the existing
    // invite flow does the rest (group assignment + sync-on-join).
    const [qrOpen, setQrOpen] = useState(false);
    const inviteUrl = `${typeof window === "undefined" ? "" : window.location.origin}/invite/${invitation.code}`;

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        const origin = typeof window === "undefined" ? "" : window.location.origin;
        copyToClipboard(`${origin}/invite/${invitation.code}`);
        setCopiedLink(true);
        toast.success("Invite link copied to clipboard");
        setTimeout(() => setCopiedLink(false), 2000);
    };

    const handleCopyCode = (e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        copyToClipboard(invitation.code);
        setCopiedCode(true);
        toast.success("Invitation code copied to clipboard");
        setTimeout(() => setCopiedCode(false), 2000);
    };

    // One click opens the invitation, like a person, group or addon card;
    // the checkbox in the corner selects it.
    const handleClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("button")) {
            return;
        }
        if (longPressedRef.current) {
            longPressedRef.current = false;
            return;
        }
        router.push(`/invitations/${invitation.id}`);
    };

    const handleEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        onEdit();
    };

    const handleDuplicate = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        onDuplicate();
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        onDelete();
    };

    const handleViewDetail = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        router.push(`/invitations/${invitation.id}`);
    };

    const usagePercentage = invitation.maxUses ? (invitation.uses / invitation.maxUses) * 100 : 0;

    const _isExpiringSoon = invitation.expiresAt
        ? new Date(invitation.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
        : false;

    const cardElement = (
        <Card
            className={`group relative cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}
            onClick={handleClick}
            padding="none"
        >
            <div
                className="h-full w-full"
                onContextMenu={handleContextMenu}
                onTouchEnd={handleTouchEnd}
                onTouchStart={handleTouchStart}
                role="none"
            >
                {/* Selection indicator */}
                <div className="absolute top-4 right-4 z-10">
                    <SelectionCheckbox checked={isSelected} onChange={onToggleSelect} />
                </div>

                {/* Header + usage (addon-card style) */}
                <div className="relative overflow-hidden border-default border-b p-6 pb-4">
                    {/* Subtle color accent */}
                    <div
                        className="absolute inset-0 opacity-10"
                        style={{
                            background: `linear-gradient(135deg, ${invitation.groupColor || "#4b5563"}40 0%, transparent 60%)`,
                        }}
                    />
                    <div className="relative flex items-start gap-4">
                        {/* Envelope icon */}
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-muted text-primary">
                            <EnvelopeIcon className="h-7 w-7" />
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1 pr-8">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <h3 className="truncate font-semibold text-default text-lg">
                                    {invitation.name || invitation.code}
                                </h3>
                                {/* Invitation status badges */}
                                {(() => {
                                    const isExpired =
                                        invitation.expiresAt &&
                                        new Date(invitation.expiresAt) < new Date();
                                    const isFull =
                                        invitation.maxUses && invitation.uses >= invitation.maxUses;

                                    if (isExpired) {
                                        return (
                                            <Badge size="sm" variant="error">
                                                Expired
                                            </Badge>
                                        );
                                    }
                                    if (isFull) {
                                        return (
                                            <Badge size="sm" variant="error">
                                                Full
                                            </Badge>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                            {invitation.groupMissing ? (
                                <p
                                    className="mb-2 flex items-center gap-1 text-warning text-xs"
                                    title="People who join with this invitation won't be put in a group. Edit it to pick one."
                                >
                                    <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">
                                        {invitation.groupName} was deleted
                                    </span>
                                </p>
                            ) : (
                                <p className="mb-2 text-muted text-xs">
                                    {invitation.groupName || "No group"}
                                </p>
                            )}

                            {/* Progress bar for uses - Industrial Precision Design */}
                            {invitation.maxUses && (
                                <div className="group mt-4">
                                    {/* Status indicator */}
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="font-semibold text-[10px] text-muted uppercase tracking-widest">
                                            Usage
                                        </span>
                                        <span
                                            className={`font-bold text-[10px] tabular-nums ${usagePercentage >= 80 ? "text-error" : usagePercentage >= 50 ? "text-warning" : "text-primary"}`}
                                        >
                                            {Math.round(usagePercentage)}%
                                        </span>
                                    </div>

                                    {/* Track with depth */}
                                    <div className="relative h-6 overflow-hidden rounded-lg bg-surface-hover shadow-inner">
                                        {/* Inner shadow overlay */}
                                        <div className="pointer-events-none absolute inset-0 z-10 rounded-lg shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]" />

                                        {/* Background track with remaining count */}
                                        <div className="absolute inset-0 flex items-center justify-end pr-2">
                                            <span className="font-bold text-[10px] text-default tabular-nums">
                                                {(invitation.maxUses || 0) - (invitation.uses || 0)}
                                            </span>
                                        </div>

                                        {/* Filled bar with color-coded gradient */}
                                        <motion.div
                                            animate={{
                                                width: `${Math.min(usagePercentage, 100)}%`,
                                            }}
                                            className={`relative flex h-full items-center justify-center rounded-lg ${usagePercentage >= 80 ? "usage-bar-hot" : "usage-bar-ok"}`}
                                            initial={{ width: 0 }}
                                            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                                        >
                                            {/* Uses count in center of used portion (only show if > 0) */}
                                            {(invitation.uses || 0) > 0 && (
                                                <span className="font-bold text-[10px] text-white tabular-nums drop-shadow-md">
                                                    {invitation.uses || 0}
                                                </span>
                                            )}

                                            {/* Shimmer effect - sliding gradient overlay */}
                                            <div className="absolute inset-0 overflow-hidden rounded-lg">
                                                <div className="absolute inset-0 h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                                            </div>

                                            {/* Glow on hover */}
                                            <div
                                                className={`absolute inset-0 rounded-lg opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${usagePercentage >= 80 ? "usage-glow-hot" : "usage-glow-ok"}`}
                                            />
                                        </motion.div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer with summary stats and copyable code */}
                <div className="flex items-center justify-between border-default border-t px-6 py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted text-xs">
                        {[
                            invitation.syncOnJoin && "Auto-sync",
                            invitation.jellyfinServerKey && "Makes a Jellyfin account",
                            invitation.expiresAt
                                ? `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`
                                : "Never expires",
                            invitation.membershipDuration
                                ? `${invitation.membershipDuration} days`
                                : "Permanent",
                        ]
                            .filter(Boolean)
                            .map((item, i) => (
                                <Fragment key={String(item)}>
                                    {i > 0 && <span aria-hidden="true">•</span>}
                                    <span>{item}</span>
                                </Fragment>
                            ))}
                    </div>

                    <motion.button
                        aria-label={
                            copiedCode ? "Code copied to clipboard" : "Copy invitation code"
                        }
                        className="flex items-center gap-2 rounded-lg border border-default bg-surface-hover px-3 py-1.5 font-mono text-primary text-xs tracking-wide"
                        onClick={handleCopyCode}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <span>{invitation.code}</span>
                        {copiedCode ? (
                            <CheckIcon className="h-4 w-4" />
                        ) : (
                            <ClipboardIcon className="h-4 w-4" />
                        )}
                    </motion.button>
                </div>
            </div>
        </Card>
    );

    return (
        <>
            {focusable ? (
                <TVFocusable onEnterPress={() => router.push(`/invitations/${invitation.id}`)}>
                    {cardElement}
                </TVFocusable>
            ) : (
                cardElement
            )}

            <ContextMenu isOpen={isOpen} onClose={close} position={position}>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={handleViewDetail}
                    type="button"
                >
                    <EyeIcon className="h-4 w-4" />
                    View Details
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={handleEdit}
                    type="button"
                >
                    <PencilIcon className="h-4 w-4" />
                    Edit
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={handleDuplicate}
                    type="button"
                >
                    <DocumentDuplicateIcon className="h-4 w-4" />
                    Duplicate
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={handleCopy}
                    type="button"
                >
                    <ClipboardIcon className="h-4 w-4" />
                    Copy Link
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={(e) => {
                        e.stopPropagation();
                        close();
                        setQrOpen(true);
                    }}
                    type="button"
                >
                    <QrCodeIcon className="h-4 w-4" />
                    Show QR
                </button>
                <div className="my-1 border-default border-t" />
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-error text-sm transition-colors hover:bg-error-muted"
                    onClick={handleDelete}
                    type="button"
                >
                    <TrashIcon className="h-4 w-4" />
                    Delete
                </button>
            </ContextMenu>

            <Modal isOpen={qrOpen} onClose={() => setQrOpen(false)} size="sm" title="Scan to join">
                <div className="space-y-3 text-center">
                    {/* Served by /api/qr (allowlisted), so this renders even on the
              pre-login page a scanned phone lands on. White padding behind
              the PNG keeps it scannable on dark themes. */}
                    <div className="inline-block rounded-xl bg-white p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            alt={`QR code for invitation ${invitation.name || invitation.code}`}
                            height={240}
                            src={`/api/qr?data=${encodeURIComponent(inviteUrl)}`}
                            width={240}
                        />
                    </div>
                    <p className="text-muted text-sm">
                        Point a phone camera at this. It opens the invite, they connect their own
                        account, and sync sets them up - nothing to type, no credentials through
                        you.
                    </p>
                    <code className="block break-all text-subtle text-xs">{inviteUrl}</code>
                </div>
            </Modal>
        </>
    );
}

// OAuth Countdown Timer Component
function OAuthCountdown({ expiresAt }: { expiresAt: string }) {
    const [timeLeft, setTimeLeft] = useState("");
    const [isExpired, setIsExpired] = useState(false);

    useEffect(() => {
        const updateCountdown = () => {
            const now = Date.now();
            const expiry = new Date(expiresAt).getTime();
            const diff = expiry - now;

            if (diff <= 0) {
                setIsExpired(true);
                setTimeLeft("Expired");
                return;
            }

            const minutes = Math.floor(diff / 60_000);
            const seconds = Math.floor((diff % 60_000) / 1000);
            setTimeLeft(`${minutes}:${seconds.toString().padStart(2, "0")}`);
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);
        return () => clearInterval(interval);
    }, [expiresAt]);

    return (
        <span className={`font-mono text-sm ${isExpired ? "text-error" : "text-muted"}`}>
            {timeLeft}
        </span>
    );
}

// Request Card with enhanced features
function RequestCard({ request, onUpdate }: { request: RequestDisplay; onUpdate?: () => void }) {
    const isTV = useIsTV();
    const [isProcessing, setIsProcessing] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [copiedCode, setCopiedCode] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);

    const handleAction = async (action: "accept" | "reject") => {
        setIsProcessing(true);
        try {
            if (action === "accept") {
                await api.acceptInviteRequest(request.id);
                toast.success(`${request.username || displayEmail(request.email)} accepted`);
            } else {
                await api.rejectInviteRequest(request.id);
                toast.success(`${request.username || displayEmail(request.email)} rejected`);
            }
            // Refresh data
            if (onUpdate) {
                onUpdate();
            }
        } catch (err) {
            toast.error(readErrorMessage(err, `Failed to ${action} request`));
            console.error(`Failed to ${action} request:`, err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleUndoReject = async () => {
        setIsProcessing(true);
        try {
            // Re-accept a rejected request (undo rejection)
            await api.acceptInviteRequest(request.id);
            toast.success(`${request.username || displayEmail(request.email)} rejection undone`);
            if (onUpdate) {
                onUpdate();
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to undo rejection"));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRefreshOAuth = async () => {
        setIsRefreshing(true);
        try {
            const _result = await api.refreshInvitationOAuth(request.id);
            toast.success("OAuth link refreshed");
            if (onUpdate) {
                onUpdate();
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to refresh OAuth"));
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleCopyCode = () => {
        if (request.oauthCode) {
            copyToClipboard(request.oauthCode);
            setCopiedCode(true);
            toast.success("OAuth code copied");
            setTimeout(() => setCopiedCode(false), 2000);
        }
    };

    const handleCopyLink = () => {
        if (request.oauthLink) {
            copyToClipboard(request.oauthLink);
            setCopiedLink(true);
            toast.success("OAuth link copied");
            setTimeout(() => setCopiedLink(false), 2000);
        }
    };

    const isPending = request.status === "pending";
    const isRejected = request.status === "rejected";
    const isAccepted = request.status === "accepted";
    const hasOAuth = request.oauthCode && request.oauthExpiresAt;

    // Status badge variant
    const getStatusVariant = () => {
        switch (request.status) {
            case "pending":
                return "warning";
            case "accepted":
                return "success";
            case "joined":
                return "primary";
            case "rejected":
                return "error";
            case "expired":
                return "muted";
            case "renewed":
                return "secondary";
            case "removed":
                return "error";
            default:
                return "muted";
        }
    };

    return (
        <Card className={isRejected ? "opacity-60" : ""} padding="md">
            <div className="flex items-center gap-4">
                {/* userId is required by UserAvatar's props but unused here - it only
            looks a user up by id when no email is given, and this always
            passes one. InviteRequest has no userId field at all (it's not
            tied to a managed User record), so request.id just fills the
            required prop without referencing a property that doesn't exist. */}
                <UserAvatar
                    email={request.email}
                    name={request.username || "Unknown"}
                    size="lg"
                    userId={request.id}
                />

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-default">
                            {request.username || "Unknown"}
                        </h3>
                        <Badge size="sm" variant={getStatusVariant()}>
                            {request.status}
                        </Badge>
                    </div>
                    <p className="text-muted text-sm">{displayEmail(request.email)}</p>
                    <p className="mt-1 text-subtle text-xs">
                        Requested {new Date(request.createdAt).toLocaleDateString()} at{" "}
                        {new Date(request.createdAt).toLocaleTimeString()}
                    </p>
                    {request.respondedAt && (
                        <p className="text-subtle text-xs">
                            Responded: {new Date(request.respondedAt).toLocaleString()}
                        </p>
                    )}
                </div>

                {/* OAuth section for accepted requests */}
                {isAccepted && hasOAuth && (
                    <div className="flex items-center gap-3 rounded-xl bg-surface-hover p-3">
                        <div className="text-center">
                            <p className="mb-1 text-muted text-xs">OAuth Code</p>
                            <div className="flex items-center gap-2">
                                <code className="font-mono text-primary text-sm">
                                    {request.oauthCode}
                                </code>
                                <button
                                    className="rounded p-1 hover:bg-surface-hover"
                                    onClick={handleCopyCode}
                                    title="Copy code"
                                    type="button"
                                >
                                    {copiedCode ? (
                                        <CheckIcon className="h-4 w-4 text-success" />
                                    ) : (
                                        <ClipboardIcon className="h-4 w-4 text-muted" />
                                    )}
                                </button>
                            </div>
                        </div>
                        <div className="border-default border-l pl-3 text-center">
                            <p className="mb-1 text-muted text-xs">Expires</p>
                            {request.oauthExpiresAt && (
                                <OAuthCountdown expiresAt={request.oauthExpiresAt} />
                            )}
                        </div>
                        <div className="flex flex-col gap-1">
                            <button
                                className="rounded-lg bg-surface-hover p-1.5 text-muted transition-colors hover:bg-primary-muted hover:text-primary"
                                onClick={handleCopyLink}
                                title="Copy OAuth link"
                                type="button"
                            >
                                {copiedLink ? (
                                    <CheckIcon className="h-4 w-4" />
                                ) : (
                                    <LinkIcon className="h-4 w-4" />
                                )}
                            </button>
                            <button
                                className="rounded-lg bg-surface-hover p-1.5 text-muted transition-colors hover:bg-secondary-muted hover:text-secondary disabled:opacity-50"
                                disabled={isRefreshing}
                                onClick={handleRefreshOAuth}
                                title="Refresh OAuth link"
                                type="button"
                            >
                                <ArrowPathIcon
                                    className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                                />
                            </button>
                        </div>
                    </div>
                )}

                {/* Actions for pending requests */}
                {isPending && (
                    <div className="flex items-center gap-2">
                        {(() => {
                            const btn = (
                                <motion.button
                                    aria-label={`Accept request from ${request.username}`}
                                    className="rounded-xl bg-success-muted p-3 text-success transition-colors disabled:opacity-50"
                                    disabled={isProcessing}
                                    onClick={() => handleAction("accept")}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                >
                                    <CheckIcon className="h-5 w-5" />
                                </motion.button>
                            );
                            return isTV ? (
                                <TVFocusable onEnterPress={() => handleAction("accept")}>
                                    {btn}
                                </TVFocusable>
                            ) : (
                                btn
                            );
                        })()}
                        {(() => {
                            const btn = (
                                <motion.button
                                    aria-label={`Reject request from ${request.username}`}
                                    className="rounded-xl bg-error-muted p-3 text-error transition-colors disabled:opacity-50"
                                    disabled={isProcessing}
                                    onClick={() => handleAction("reject")}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </motion.button>
                            );
                            return isTV ? (
                                <TVFocusable onEnterPress={() => handleAction("reject")}>
                                    {btn}
                                </TVFocusable>
                            ) : (
                                btn
                            );
                        })()}
                    </div>
                )}

                {/* Undo button for rejected requests */}
                {isRejected && (
                    <motion.button
                        className="flex items-center gap-2 rounded-xl bg-surface-hover px-4 py-2 text-muted transition-colors hover:text-default disabled:opacity-50"
                        disabled={isProcessing}
                        onClick={handleUndoReject}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <ArrowUturnLeftIcon className="h-4 w-4" />
                        Undo
                    </motion.button>
                )}
            </div>
        </Card>
    );
}

// Quick expiration presets
const expirationPresets = [
    { label: "5m", minutes: 5 },
    { label: "30m", minutes: 30 },
    { label: "1h", minutes: 60 },
    { label: "12h", minutes: 720 },
    { label: "1d", minutes: 1440 },
    { label: "1w", minutes: 10_080 },
    { label: "2w", minutes: 20_160 },
    { label: "30d", minutes: 43_200 },
];

// Membership duration presets
const membershipPresets = [
    { days: 1, label: "1 day" },
    { days: 7, label: "7 days" },
    { days: 30, label: "30 days" },
    { days: 90, label: "90 days" },
    { days: 365, label: "1 year" },
    { days: 0, label: "Lifetime" },
];

// Create Invitation Modal - Premium styled
function CreateInvitationModal({
    isOpen,
    onClose,
    groups,
}: {
    isOpen: boolean;
    onClose: () => void;
    groups: Group[];
}) {
    const groupLabelId1 = useId();
    const fieldId1 = useId();
    const reduceMotion = useReducedMotion();
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        expiresAt: "",
        groupId: "",
        maxUses: "",
        membershipDuration: "",
        name: "",
        syncOnJoin: true,
    });
    const [jellyfinServerKey, setJellyfinServerKey] = useState<string | null>(null);
    const [useCustomExpiration, setUseCustomExpiration] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
    const [showSuccess, setShowSuccess] = useState(false);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setTimeout(() => {
                setFormData({
                    expiresAt: "",
                    groupId: "",
                    maxUses: "",
                    membershipDuration: "",
                    name: "",
                    syncOnJoin: true,
                });
                setJellyfinServerKey(null);
                setUseCustomExpiration(false);
                setSelectedPreset(null);
                setShowSuccess(false);
            }, 300);
        }
    }, [isOpen]);

    const handlePresetClick = (minutes: number) => {
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
        setFormData({ ...formData, expiresAt: expiresAt.toISOString() });
        setSelectedPreset(minutes);
        setUseCustomExpiration(false);
    };

    const handleMembershipPresetClick = (days: number) => {
        setFormData({ ...formData, membershipDuration: days === 0 ? "" : days.toString() });
    };

    const handleSubmit = async () => {
        setIsLoading(true);
        try {
            const selectedGroup = groups.find((g) => g.id === formData.groupId);
            const _created = await api.createInvitation({
                expiresAt: formData.expiresAt || undefined,
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
            setShowSuccess(true);
            setTimeout(() => {
                onClose();
                // No dedicated invitation detail page yet; keep user on list for now.
                window.location.reload();
            }, 800);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to create invitation"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <Dialog className="relative z-50" onClose={onClose} open={isOpen}>
                    <motion.div
                        animate={{ opacity: 1 }}
                        className="fixed inset-0"
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        style={{
                            background: "rgba(0,0,0,0.55)",
                        }}
                    />

                    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
                        <motion.div
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="w-full"
                            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
                            initial={
                                reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }
                            }
                            style={{ maxWidth: "512px" }}
                            transition={{ bounce: 0, duration: 0.3, type: "spring" }}
                        >
                            <DialogPanel
                                className="interface-modal relative my-8 max-h-[85dvh] w-full overflow-hidden overflow-y-auto"
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                    borderRadius: "24px",
                                    boxShadow:
                                        "0 0 0 1px rgba(255,255,255,0.05), 0 40px 80px -20px rgba(0,0,0,0.5)",
                                    maxWidth: "512px",
                                }}
                            >
                                <DialogTitle className="sr-only">Create invitation</DialogTitle>
                                <button
                                    aria-label="Close invitation"
                                    className="absolute top-3 right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-hover"
                                    onClick={onClose}
                                    type="button"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>

                                <div className="p-6 md:p-8">
                                    <AnimatePresence mode="wait">
                                        {showSuccess ? (
                                            <motion.div
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="py-8 text-center"
                                                initial={{ opacity: 0, scale: 0.9 }}
                                                key="success"
                                            >
                                                <motion.div
                                                    animate={{ scale: 1 }}
                                                    className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
                                                    initial={{ scale: 0 }}
                                                    style={{
                                                        background:
                                                            "linear-gradient(135deg, var(--color-secondary) 0%, color-mix(in srgb, var(--color-secondary) 80%, var(--color-primary)) 100%)",
                                                        boxShadow:
                                                            "0 12px 40px -8px var(--color-secondary)",
                                                    }}
                                                    transition={{
                                                        damping: 10,
                                                        delay: 0.1,
                                                        type: "spring",
                                                    }}
                                                >
                                                    <CheckIcon className="h-10 w-10 text-white" />
                                                </motion.div>
                                                <h3
                                                    className="mb-2 font-bold text-2xl"
                                                    style={{ color: "var(--color-text)" }}
                                                >
                                                    Invitation Created!
                                                </h3>
                                                <p
                                                    className="text-sm"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    {formData.name || "New invite"} is ready to
                                                    share
                                                </p>
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: 20 }}
                                                initial={{ opacity: 0, x: -20 }}
                                                key="form"
                                            >
                                                {/* Header */}
                                                <div className="mb-7 pr-6">
                                                    <motion.div
                                                        animate={{ scale: 1 }}
                                                        className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl"
                                                        initial={false}
                                                        style={{
                                                            background:
                                                                "var(--color-primary-muted)",
                                                        }}
                                                        transition={{ delay: 0.1, type: "spring" }}
                                                    >
                                                        <EnvelopeIcon className="h-5 w-5 text-primary" />
                                                    </motion.div>
                                                    <h2
                                                        className="mb-2 font-bold text-2xl"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        Create Invitation
                                                    </h2>
                                                    <p
                                                        className="text-sm"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        Generate an invite code for new users
                                                    </p>
                                                </div>

                                                {/* Form */}
                                                <div className="space-y-5">
                                                    <div>
                                                        <label
                                                            className="mb-2 block font-medium text-sm"
                                                            htmlFor={`${fieldId1}-1`}
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Invitation Name
                                                        </label>
                                                        <input
                                                            className="w-full rounded-xl px-4 py-3.5 transition-all duration-200 focus:outline-none"
                                                            id={`${fieldId1}-1`}
                                                            onChange={(e) =>
                                                                setFormData({
                                                                    ...formData,
                                                                    name: e.target.value,
                                                                })
                                                            }
                                                            placeholder="e.g., Friends & Family"
                                                            style={{
                                                                background: "var(--color-subtle)",
                                                                border: "1px solid var(--color-surface-border)",
                                                                color: "var(--color-text)",
                                                            }}
                                                            type="text"
                                                            value={formData.name}
                                                        />
                                                        <p
                                                            className="mt-1.5 text-xs"
                                                            style={{
                                                                color: "var(--color-text-subtle)",
                                                            }}
                                                        >
                                                            Optional. If empty, the invite code will
                                                            be used.
                                                        </p>
                                                    </div>

                                                    <div>
                                                        <label
                                                            className="mb-2 block font-medium text-sm"
                                                            htmlFor={`${fieldId1}-2`}
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Assign to Group
                                                        </label>
                                                        <select
                                                            className="w-full appearance-none rounded-xl px-4 py-3.5 transition-all duration-200 focus:outline-none"
                                                            id={`${fieldId1}-2`}
                                                            onChange={(e) =>
                                                                setFormData({
                                                                    ...formData,
                                                                    groupId: e.target.value,
                                                                })
                                                            }
                                                            style={{
                                                                background: "var(--color-subtle)",
                                                                border: "1px solid var(--color-surface-border)",
                                                                color: "var(--color-text)",
                                                            }}
                                                            value={formData.groupId}
                                                        >
                                                            <option value="">
                                                                No group (assign later)
                                                            </option>
                                                            {groups.map((g) => (
                                                                <option key={g.id} value={g.id}>
                                                                    {g.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    <div>
                                                        <label
                                                            className="mb-2 block font-medium text-sm"
                                                            htmlFor={`${fieldId1}-3`}
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Max Uses
                                                        </label>
                                                        <input
                                                            className="w-full rounded-xl px-4 py-3.5 transition-all duration-200 focus:outline-none"
                                                            id={`${fieldId1}-3`}
                                                            onChange={(e) =>
                                                                setFormData({
                                                                    ...formData,
                                                                    maxUses: e.target.value,
                                                                })
                                                            }
                                                            placeholder="Unlimited"
                                                            style={{
                                                                background: "var(--color-subtle)",
                                                                border: "1px solid var(--color-surface-border)",
                                                                color: "var(--color-text)",
                                                            }}
                                                            type="number"
                                                            value={formData.maxUses}
                                                        />
                                                    </div>

                                                    {/* Expiration presets */}
                                                    <fieldset
                                                        aria-labelledby={`${groupLabelId1}-1`}
                                                        className="mx-0 min-w-0 border-0 p-0"
                                                    >
                                                        <p
                                                            className="mb-3 block font-medium text-sm"
                                                            id={`${groupLabelId1}-1`}
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Expiration
                                                        </p>
                                                        <div className="mb-3 flex flex-wrap gap-2">
                                                            {expirationPresets.map((preset) => (
                                                                <motion.button
                                                                    className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-all ${selectedPreset === preset.minutes && !useCustomExpiration ? "seg-on" : "seg-off-subtle"}`}
                                                                    key={preset.label}
                                                                    onClick={() =>
                                                                        handlePresetClick(
                                                                            preset.minutes
                                                                        )
                                                                    }
                                                                    type="button"
                                                                    whileHover={{ scale: 1.05 }}
                                                                    whileTap={{ scale: 0.95 }}
                                                                >
                                                                    {preset.label}
                                                                </motion.button>
                                                            ))}
                                                            <motion.button
                                                                className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-all ${formData.expiresAt || useCustomExpiration ? "seg-off-subtle" : "seg-on-secondary"}`}
                                                                onClick={() => {
                                                                    setFormData({
                                                                        ...formData,
                                                                        expiresAt: "",
                                                                    });
                                                                    setSelectedPreset(null);
                                                                    setUseCustomExpiration(false);
                                                                }}
                                                                type="button"
                                                                whileHover={{ scale: 1.05 }}
                                                                whileTap={{ scale: 0.95 }}
                                                            >
                                                                Never
                                                            </motion.button>
                                                        </div>
                                                        {formData.expiresAt && (
                                                            <p
                                                                className="text-xs"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                Expires:{" "}
                                                                {new Date(
                                                                    formData.expiresAt
                                                                ).toLocaleString()}
                                                            </p>
                                                        )}
                                                    </fieldset>

                                                    {/* Membership Duration */}
                                                    <fieldset
                                                        aria-labelledby={`${groupLabelId1}-2`}
                                                        className="mx-0 min-w-0 border-0 p-0"
                                                    >
                                                        <p
                                                            className="mb-3 block font-medium text-sm"
                                                            id={`${groupLabelId1}-2`}
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Membership Duration
                                                        </p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {membershipPresets.map((preset) => (
                                                                <motion.button
                                                                    className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-all ${(preset.days === 0 && !formData.membershipDuration) || formData.membershipDuration === preset.days.toString() ? "seg-on" : "seg-off-subtle"}`}
                                                                    key={preset.label}
                                                                    onClick={() =>
                                                                        handleMembershipPresetClick(
                                                                            preset.days
                                                                        )
                                                                    }
                                                                    type="button"
                                                                    whileHover={{ scale: 1.05 }}
                                                                    whileTap={{ scale: 0.95 }}
                                                                >
                                                                    {preset.label}
                                                                </motion.button>
                                                            ))}
                                                        </div>
                                                    </fieldset>

                                                    {/* Sync on Join */}
                                                    <motion.button
                                                        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl p-4 transition-all ${formData.groupId ? "" : "cursor-not-allowed opacity-50"} ${formData.syncOnJoin && formData.groupId ? "opt-row-on" : "opt-row-off"}`}
                                                        disabled={!formData.groupId}
                                                        onClick={() =>
                                                            formData.groupId &&
                                                            setFormData({
                                                                ...formData,
                                                                syncOnJoin: !formData.syncOnJoin,
                                                            })
                                                        }
                                                        type="button"
                                                        whileHover={{ scale: 1.01 }}
                                                        whileTap={{ scale: 0.99 }}
                                                    >
                                                        <div
                                                            className={`flex h-5 w-5 items-center justify-center rounded-md transition-all ${formData.syncOnJoin && formData.groupId ? "opt-box-on" : "opt-box-off"}`}
                                                        >
                                                            {formData.syncOnJoin &&
                                                                formData.groupId && (
                                                                    <CheckIcon className="h-3 w-3 text-white" />
                                                                )}
                                                        </div>
                                                        <div className="text-left">
                                                            <p
                                                                className="font-medium"
                                                                style={{
                                                                    color: "var(--color-text)",
                                                                }}
                                                            >
                                                                Sync on Join
                                                            </p>
                                                            <p
                                                                className="text-xs"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                {formData.groupId
                                                                    ? "Automatically sync addons when user joins"
                                                                    : "Select a group first"}
                                                            </p>
                                                        </div>
                                                    </motion.button>

                                                    <InviteJellyfinAccountPicker
                                                        onChange={setJellyfinServerKey}
                                                        value={jellyfinServerKey}
                                                    />
                                                </div>

                                                {/* Actions */}
                                                <div className="mt-8 flex gap-3">
                                                    <button
                                                        className="flex-1 rounded-xl py-3.5 font-medium text-sm transition-colors"
                                                        onClick={onClose}
                                                        style={{
                                                            background: "var(--color-subtle)",
                                                            color: "var(--color-text)",
                                                        }}
                                                        type="button"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <Button
                                                        className="flex-1"
                                                        isLoading={isLoading}
                                                        onClick={handleSubmit}
                                                        variant="primary"
                                                    >
                                                        Generate Invite
                                                    </Button>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </DialogPanel>
                        </motion.div>
                    </div>
                </Dialog>
            )}
        </AnimatePresence>
    );
}

// Duplicate Invitation Form
function DuplicateInvitationForm({
    invitation,
    groups,
    onClose,
}: {
    invitation: InvitationDisplay;
    groups: Group[];
    onClose: () => void;
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        expiresIn: "",
        groupId: invitation.groupId || "",
        maxUses: invitation.maxUses?.toString() || "",
        membershipDuration: invitation.membershipDuration?.toString() || "",
        name: invitation.name ? `${invitation.name} (Copy)` : "",
        syncOnJoin: invitation.syncOnJoin,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            // Calculate expiresAt from expiresIn
            let expiresAt: Date | undefined;
            if (formData.expiresIn) {
                const days = Number.parseInt(formData.expiresIn, 10);
                expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + days);
            }

            const selectedGroup = groups.find((g) => g.id === formData.groupId);
            await api.createInvitation({
                expiresAt: expiresAt?.toISOString(),
                groupId: formData.groupId || undefined,
                groupName: selectedGroup?.name || undefined,
                maxUses: formData.maxUses ? Number.parseInt(formData.maxUses, 10) : undefined,
                membershipDuration: formData.membershipDuration
                    ? Number.parseInt(formData.membershipDuration, 10)
                    : undefined,
                name: formData.name || undefined,
                syncOnJoin: formData.syncOnJoin,
            });
            toast.success("Invitation duplicated successfully");
            onClose();
            // Refresh page to show new invitation
            window.location.reload();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to duplicate invitation"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="rounded-xl border border-default bg-subtle p-4">
                <p className="mb-1 text-muted text-sm">Based on</p>
                <code className="font-mono text-lg text-primary">{invitation.code}</code>
                <p className="mt-1 text-subtle text-xs">A new code will be generated</p>
            </div>

            <Select
                label="Assign to Group"
                onChange={(value) => setFormData({ ...formData, groupId: value })}
                options={[
                    { label: "No group (assign later)", value: "" },
                    ...groups.map((g) => ({ label: g.name, value: g.id })),
                ]}
                value={formData.groupId}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                    hint="Leave empty for unlimited"
                    label="Max Uses"
                    onChange={(e) => setFormData({ ...formData, maxUses: e.target.value })}
                    placeholder="Unlimited"
                    type="number"
                    value={formData.maxUses}
                />
                <Select
                    label="Expires In"
                    onChange={(value) => setFormData({ ...formData, expiresIn: value })}
                    options={[
                        { label: "Never", value: "" },
                        { label: "7 days", value: "7" },
                        { label: "14 days", value: "14" },
                        { label: "30 days", value: "30" },
                        { label: "90 days", value: "90" },
                    ]}
                    value={formData.expiresIn}
                />
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

            <div className="flex justify-end gap-3 pt-4">
                <Button onClick={onClose} type="button" variant="secondary">
                    Cancel
                </Button>
                <Button isLoading={isLoading} type="submit" variant="primary">
                    Create Duplicate
                </Button>
            </div>
        </form>
    );
}
