"use client";

import {
    ArrowLeftIcon,
    ArrowTopRightOnSquareIcon,
    ArrowUturnLeftIcon,
    ChartPieIcon,
    CheckIcon,
    ClipboardIcon,
    ClockIcon,
    EnvelopeIcon,
    ExclamationTriangleIcon,
    LinkIcon,
    PencilIcon,
    TrashIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EditInvitationForm } from "@/components/invitations/EditInvitationForm";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection, StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import { Badge, Button, Card, ConfirmModal, Modal, UserAvatar } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type Group, type Invitation, type InviteRequest } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useLayoutMode } from "@/lib/layout-mode";
import { displayEmail } from "@/lib/providers";

interface InvitationWithRequests extends Invitation {
    requests?: InviteRequest[];
}

export default function InvitationDetailPage() {
    const params = useParams();
    const router = useRouter();
    const invitationId = params.id as string;

    const [invitation, setInvitation] = useState<InvitationWithRequests | null>(null);
    const [groups, setGroups] = useState<Group[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteUserConfirm, setDeleteUserConfirm] = useState<{
        open: boolean;
        request: InviteRequest | null;
    }>({ open: false, request: null });
    const [copiedLink, setCopiedLink] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const { layoutMode } = useLayoutMode();
    const isNebula = layoutMode === "nebula";

    // Fetch invitation data
    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [invitationsData, groupsData] = await Promise.all([
                    api.getInvitations(),
                    api.getGroups(),
                ]);

                const foundInvitation = invitationsData.find((inv: any) => inv.id === invitationId);
                if (!foundInvitation) {
                    throw new Error("Invitation not found");
                }

                // Fetch requests for this invitation
                let requests: InviteRequest[] = [];
                if (foundInvitation.requests && Array.isArray(foundInvitation.requests)) {
                    requests = foundInvitation.requests;
                } else {
                    try {
                        const invRequests = await api.getInvitationRequests(invitationId);
                        if (Array.isArray(invRequests)) {
                            requests = invRequests;
                        }
                    } catch {
                        // Skip if requests can't be fetched
                    }
                }

                setInvitation({ ...foundInvitation, requests });
                setGroups(groupsData);
            } catch (err) {
                setError(err as Error);
                toast.error("Failed to load invitation");
            } finally {
                setIsLoading(false);
            }
        };

        if (invitationId) {
            fetchData();
        }
    }, [invitationId]);

    useEffect(() => {
        if (invitation) {
            document.title = `SlickSync - Invitation ${invitation.code || invitation.inviteCode || ""}`;
        }
    }, [invitation]);

    const handleCopyLink = () => {
        const origin = typeof window === "undefined" ? "" : window.location.origin;
        copyToClipboard(`${origin}/invite/${invitation?.code || invitation?.inviteCode}`);
        setCopiedLink(true);
        toast.success("Invite link copied to clipboard");
        setTimeout(() => setCopiedLink(false), 2000);
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await api.deleteInvitation(invitationId);
            toast.success("Invitation deleted successfully");
            router.push("/invitations");
        } catch (err: any) {
            toast.error(err.message || "Failed to delete invitation");
            setIsDeleting(false);
        }
    };

    const handleAcceptRequest = async (requestId: string) => {
        try {
            await api.acceptInviteRequest(requestId);
            toast.success("Request accepted");
            // Refresh data
            window.location.reload();
        } catch (err: any) {
            toast.error(err.message || "Failed to accept request");
        }
    };

    const handleRejectRequest = async (requestId: string) => {
        try {
            await api.rejectInviteRequest(requestId);
            toast.success("Request rejected");
            window.location.reload();
        } catch (err: any) {
            toast.error(err.message || "Failed to reject request");
        }
    };

    const handleDeleteUser = async (requestId: string) => {
        try {
            await api.rejectInviteRequest(requestId);
            toast.success("User removed");
            window.location.reload();
        } catch (err: any) {
            toast.error(err.message || "Failed to remove user");
        }
    };

    const usagePercentage = useMemo(() => {
        if (!invitation?.maxUses) {
            return 0;
        }
        const uses = invitation.currentUses || invitation.uses || 0;
        return (uses / invitation.maxUses) * 100;
    }, [invitation]);

    const isExpired = invitation?.expiresAt && new Date(invitation.expiresAt) < new Date();
    const isFull =
        invitation?.maxUses &&
        (invitation.currentUses || invitation.uses || 0) >= invitation.maxUses;
    const _isActive = !(isExpired || isFull);

    if (isLoading) {
        return (
            <>
                {!isNebula && (
                    <Header
                        title={
                            <Breadcrumbs
                                items={[
                                    { href: "/invitations", label: "Invitations" },
                                    { label: "Loading..." },
                                ]}
                            />
                        }
                    />
                )}
                <div className="p-8">
                    <div className="flex items-center justify-center py-20">
                        <div className="flex items-center gap-3 text-muted">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            <span>Loading invitation...</span>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    if (error || !invitation) {
        return (
            <>
                {!isNebula && (
                    <Header
                        title={
                            <Breadcrumbs
                                items={[
                                    { href: "/invitations", label: "Invitations" },
                                    { label: "Error" },
                                ]}
                            />
                        }
                    />
                )}
                <div className="p-8">
                    <Card className="py-16 text-center" padding="lg">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-error-muted">
                            <XMarkIcon className="h-8 w-8 text-error" />
                        </div>
                        <h3 className="mb-2 font-medium text-default text-lg">
                            Invitation Not Found
                        </h3>
                        <p className="mb-4 text-muted">
                            {error?.message || "The invitation you are looking for does not exist."}
                        </p>
                        <Button onClick={() => router.push("/invitations")} variant="primary">
                            Back to Invitations
                        </Button>
                    </Card>
                </div>
            </>
        );
    }

    const code = invitation.code || invitation.inviteCode || "";
    const group = groups.find((g) => g.name === invitation.groupName);

    const detailActions = (
        <div className="flex items-center gap-2">
            <Button
                leftIcon={<PencilIcon className="h-4 w-4" />}
                onClick={() => setEditOpen(true)}
                size="sm"
                variant="ghost"
            >
                Edit
            </Button>
            <Button
                leftIcon={<TrashIcon className="h-4 w-4" />}
                onClick={() => setDeleteConfirmOpen(true)}
                size="sm"
                variant="ghost"
            >
                Delete
            </Button>
        </div>
    );

    return (
        <>
            {!isNebula && (
                <Header
                    actions={detailActions}
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[
                                { href: "/invitations", label: "Invitations" },
                                { label: code },
                            ]}
                        />
                    }
                />
            )}

            <div className={isNebula ? "px-4 pt-6 pb-8 md:px-6" : "p-8"}>
                <div
                    className={isNebula ? "mx-auto" : ""}
                    style={isNebula ? { maxWidth: "var(--interface-content-width)" } : undefined}
                >
                    {isNebula && (
                        <NebulaPageHeading
                            actions={detailActions}
                            leading={
                                <Button
                                    leftIcon={<ArrowLeftIcon className="h-4 w-4" />}
                                    onClick={() => router.push("/invitations")}
                                    size="sm"
                                    variant="ghost"
                                >
                                    Back
                                </Button>
                            }
                            subtitle="Invitations"
                            title={invitation.name || code}
                        />
                    )}
                    {/* Hero Section - Invitation Info */}
                    <PageSection className="mb-8">
                        <Card padding="lg">
                            <div className="flex items-start gap-6">
                                {/* Envelope Icon */}
                                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary-muted text-primary">
                                    <EnvelopeIcon className="h-8 w-8" />
                                </div>

                                {/* Info */}
                                <div className="min-w-0 flex-1">
                                    {/* A long code is one unbroken word: let it wrap, and the badge drop under it, on a narrow screen. */}
                                    <div className="mb-2 flex flex-wrap items-center gap-3">
                                        <h1 className="min-w-0 break-all font-bold font-display text-2xl text-default">
                                            {code}
                                        </h1>
                                        {isExpired ? (
                                            <Badge variant="error">Expired</Badge>
                                        ) : isFull ? (
                                            <Badge variant="error">Full</Badge>
                                        ) : (
                                            <Badge variant="success">Active</Badge>
                                        )}
                                    </div>

                                    {invitation.groupName && !group ? (
                                        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-warning">
                                            <span className="inline-flex items-start gap-1.5">
                                                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                                                <span>
                                                    {invitation.groupName} was deleted, so people
                                                    who join won&apos;t be put in a group.
                                                </span>
                                            </span>
                                            <Button
                                                onClick={() => setEditOpen(true)}
                                                size="sm"
                                                variant="secondary"
                                            >
                                                Pick a group
                                            </Button>
                                        </div>
                                    ) : (
                                        <p className="mb-4 text-muted">
                                            {invitation.groupName || "No group assigned"}
                                        </p>
                                    )}

                                    {/* Stats Row */}
                                    <div className="flex flex-wrap items-center gap-6 text-sm">
                                        <div className="flex items-center gap-2">
                                            <UsersIcon className="h-4 w-4 text-muted" />
                                            <span className="font-medium text-default">
                                                {invitation.currentUses || invitation.uses || 0}
                                            </span>
                                            <span className="text-muted">/</span>
                                            <span className="text-muted">
                                                {invitation.maxUses || "∞"} uses
                                            </span>
                                        </div>

                                        {invitation.expiresAt && (
                                            <div className="flex items-center gap-2">
                                                <ClockIcon className="h-4 w-4 text-muted" />
                                                <span
                                                    className={
                                                        isExpired ? "text-error" : "text-muted"
                                                    }
                                                >
                                                    {isExpired ? "Expired " : "Expires "}
                                                    {format(
                                                        new Date(invitation.expiresAt),
                                                        "MMM d, yyyy"
                                                    )}
                                                </span>
                                            </div>
                                        )}

                                        <div className="flex items-center gap-2">
                                            <ClockIcon className="h-4 w-4 text-muted" />
                                            <span className="text-muted">
                                                Created{" "}
                                                {format(
                                                    new Date(invitation.createdAt),
                                                    "MMM d, yyyy"
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </PageSection>

                    {/* Invite Link Section */}
                    <PageSection className="mb-8" delay={0.1}>
                        <Card padding="lg">
                            <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                                        <LinkIcon className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Invite Link
                                        </h3>
                                        <p className="text-muted text-sm">
                                            Share this link to invite users
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    leftIcon={
                                        copiedLink ? (
                                            <CheckIcon className="h-4 w-4" />
                                        ) : (
                                            <ClipboardIcon className="h-4 w-4" />
                                        )
                                    }
                                    onClick={handleCopyLink}
                                    size="sm"
                                    variant="secondary"
                                >
                                    {copiedLink ? "Copied!" : "Copy Link"}
                                </Button>
                            </div>
                            <div className="flex items-center gap-3 rounded-xl border border-default bg-surface-hover p-4">
                                <LinkIcon className="h-5 w-5 shrink-0 text-muted" />
                                <code className="flex-1 truncate font-mono text-default text-sm">
                                    {typeof window === "undefined" ? "" : window.location.origin}
                                    /invite/{code}
                                </code>
                            </div>
                        </Card>
                    </PageSection>

                    {/* Usage Progress Section */}
                    {invitation.maxUses != null && invitation.maxUses > 0 && (
                        <PageSection className="mb-8" delay={0.15}>
                            <Card padding="lg">
                                <div className="mb-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/20">
                                            <ChartPieIcon className="h-5 w-5 text-secondary" />
                                        </div>
                                        <div>
                                            <h3 className="font-display font-semibold text-base text-default">
                                                Usage
                                            </h3>
                                            <p className="text-muted text-sm">
                                                {invitation.currentUses || invitation.uses || 0} of{" "}
                                                {invitation.maxUses} uses
                                            </p>
                                        </div>
                                    </div>
                                    <span
                                        className={`font-bold text-sm tabular-nums ${usagePercentage >= 80 ? "text-error" : usagePercentage >= 50 ? "text-warning" : "text-primary"}`}
                                    >
                                        {Math.round(usagePercentage)}%
                                    </span>
                                </div>

                                <div className="relative mb-3 h-8 overflow-hidden rounded-lg bg-surface-hover shadow-inner">
                                    <div className="pointer-events-none absolute inset-0 z-10 rounded-lg shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]" />

                                    {/* Background track with unused count */}
                                    <div className="absolute inset-0 flex items-center justify-end pr-3">
                                        <span className="font-bold text-default text-xs tabular-nums">
                                            {(invitation.maxUses || 0) -
                                                (invitation.currentUses || invitation.uses || 0)}
                                        </span>
                                    </div>

                                    <motion.div
                                        animate={{ width: `${Math.min(usagePercentage, 100)}%` }}
                                        className={`relative flex h-full items-center justify-center rounded-lg ${usagePercentage >= 80 ? "usage-bar-hot" : "usage-bar-ok"}`}
                                        initial={{ width: 0 }}
                                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                                    >
                                        {/* Used count in center of used portion (only show if > 0) */}
                                        {(invitation.currentUses || invitation.uses || 0) > 0 && (
                                            <span className="font-bold text-white text-xs tabular-nums drop-shadow-md">
                                                {invitation.currentUses || invitation.uses || 0}
                                            </span>
                                        )}
                                        <div className="absolute inset-0 overflow-hidden rounded-lg">
                                            <div className="absolute inset-0 h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                                        </div>
                                    </motion.div>
                                </div>
                            </Card>
                        </PageSection>
                    )}

                    {/* Invited Users Section */}
                    <PageSection delay={0.2}>
                        <Card padding="lg">
                            <div className="mb-6 flex items-center justify-between">
                                <h3 className="font-display font-semibold text-default text-lg">
                                    <span className="mr-2 font-normal text-muted">
                                        {invitation.requests?.length || 0}
                                    </span>
                                    Invited Users
                                </h3>
                            </div>

                            {invitation.requests && invitation.requests.length > 0 ? (
                                <StaggerContainer className="space-y-3">
                                    {invitation.requests.map((request, index) => (
                                        <StaggerItem key={request.id}>
                                            <motion.div
                                                animate={{ opacity: 1, y: 0 }}
                                                className="flex items-center gap-4 overflow-hidden rounded-xl border border-default bg-surface-hover p-4"
                                                initial={{ opacity: 0, y: 10 }}
                                                transition={{ delay: index * 0.05 }}
                                            >
                                                <UserAvatar
                                                    email={request.email}
                                                    name={
                                                        request.username ||
                                                        displayEmail(request.email)
                                                    }
                                                    size="md"
                                                    userId={request.id}
                                                />

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-default">
                                                            {request.username ||
                                                                displayEmail(request.email)}
                                                        </span>
                                                        <Badge
                                                            size="sm"
                                                            variant={
                                                                request.status === "accepted" ||
                                                                request.status === "joined"
                                                                    ? "success"
                                                                    : request.status === "rejected"
                                                                      ? "error"
                                                                      : request.status === "pending"
                                                                        ? "warning"
                                                                        : "muted"
                                                            }
                                                        >
                                                            {request.status}
                                                        </Badge>
                                                    </div>
                                                    <p className="mt-0.5 text-muted text-xs">
                                                        {request.email &&
                                                            request.username !== request.email && (
                                                                <>
                                                                    {displayEmail(request.email)} •{" "}
                                                                </>
                                                            )}
                                                        Requested{" "}
                                                        {format(
                                                            new Date(request.createdAt),
                                                            "MMM d, yyyy"
                                                        )}
                                                        {request.respondedAt && (
                                                            <>
                                                                {" "}
                                                                • Responded{" "}
                                                                {format(
                                                                    new Date(request.respondedAt),
                                                                    "MMM d, yyyy"
                                                                )}
                                                            </>
                                                        )}
                                                    </p>

                                                    {/* OAuth Code Display */}
                                                    {request.oauthCode &&
                                                        request.status === "accepted" && (
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <code className="rounded bg-surface px-2 py-1 font-mono text-default text-xs">
                                                                    {request.oauthCode}
                                                                </code>
                                                                {request.oauthLink && (
                                                                    <a
                                                                        className="flex items-center gap-1 text-primary text-xs hover:text-primary-hover"
                                                                        href={request.oauthLink}
                                                                        rel="noopener noreferrer"
                                                                        target="_blank"
                                                                    >
                                                                        Open Link
                                                                        <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                                                                    </a>
                                                                )}
                                                            </div>
                                                        )}
                                                </div>

                                                {/* Action Buttons */}
                                                <div className="flex items-center gap-1">
                                                    {request.status === "pending" && (
                                                        <>
                                                            <Button
                                                                leftIcon={
                                                                    <CheckIcon className="h-4 w-4" />
                                                                }
                                                                onClick={() =>
                                                                    handleAcceptRequest(request.id)
                                                                }
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                Accept
                                                            </Button>
                                                            <Button
                                                                leftIcon={
                                                                    <XMarkIcon className="h-4 w-4" />
                                                                }
                                                                onClick={() =>
                                                                    handleRejectRequest(request.id)
                                                                }
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                Reject
                                                            </Button>
                                                        </>
                                                    )}
                                                    {request.status === "rejected" && (
                                                        <Button
                                                            leftIcon={
                                                                <ArrowUturnLeftIcon className="h-4 w-4" />
                                                            }
                                                            onClick={() =>
                                                                handleAcceptRequest(request.id)
                                                            }
                                                            size="sm"
                                                            variant="ghost"
                                                        >
                                                            Undo
                                                        </Button>
                                                    )}
                                                    {(request.status === "accepted" ||
                                                        request.status === "joined") && (
                                                        <Button
                                                            leftIcon={
                                                                <TrashIcon className="h-4 w-4 text-error" />
                                                            }
                                                            onClick={() =>
                                                                setDeleteUserConfirm({
                                                                    open: true,
                                                                    request,
                                                                })
                                                            }
                                                            size="sm"
                                                            variant="ghost"
                                                        >
                                                            Remove
                                                        </Button>
                                                    )}
                                                </div>
                                            </motion.div>
                                        </StaggerItem>
                                    ))}
                                </StaggerContainer>
                            ) : (
                                <div className="py-12 text-center">
                                    <UsersIcon className="mx-auto mb-3 h-12 w-12 text-muted" />
                                    <p className="text-muted">No users have been invited yet</p>
                                </div>
                            )}
                        </Card>
                    </PageSection>
                </div>
            </div>

            <Modal
                description={`Update settings for invitation ${code}`}
                isOpen={editOpen}
                onClose={() => setEditOpen(false)}
                size="md"
                title="Edit Invitation"
            >
                {editOpen && (
                    <EditInvitationForm
                        groups={groups}
                        invitation={{
                            code,
                            groupId: invitation.groupId || group?.id,
                            groupName: invitation.groupName,
                            id: invitation.id,
                            jellyfinServerKey:
                                (invitation as { jellyfinServerKey?: string | null })
                                    .jellyfinServerKey || null,
                            maxUses:
                                typeof invitation.maxUses === "number"
                                    ? invitation.maxUses
                                    : undefined,
                            membershipDuration:
                                invitation.membershipDuration ??
                                invitation.membershipDurationDays ??
                                undefined,
                            name: invitation.name,
                            syncOnJoin: invitation.syncOnJoin === true,
                            uses: invitation.currentUses || invitation.uses || 0,
                        }}
                        onClose={() => setEditOpen(false)}
                    />
                )}
            </Modal>

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete Invitation"}
                description={`Are you sure you want to delete invitation "${code}"? This will invalidate the invite code and remove all associated users.`}
                isLoading={isDeleting}
                isOpen={deleteConfirmOpen}
                onClose={() => setDeleteConfirmOpen(false)}
                onConfirm={handleDelete}
                title="Delete Invitation"
                variant="danger"
            />

            {/* Remove User Confirmation Modal */}
            <ConfirmModal
                confirmText="Remove User"
                description={`Are you sure you want to remove ${deleteUserConfirm.request?.username || displayEmail(deleteUserConfirm.request?.email)} from this invitation?`}
                isOpen={deleteUserConfirm.open}
                onClose={() => setDeleteUserConfirm({ open: false, request: null })}
                onConfirm={() => {
                    if (deleteUserConfirm.request) {
                        handleDeleteUser(deleteUserConfirm.request.id);
                    }
                    setDeleteUserConfirm({ open: false, request: null });
                }}
                title="Remove User"
                variant="danger"
            />
        </>
    );
}
