"use client";

import {
    BoltIcon,
    CheckCircleIcon,
    PencilIcon,
    PlayIcon,
    PlusIcon,
    TrashIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Button, Card, ConfirmModal, Modal, ToggleSwitch } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import type {
    AutomationActionConfig,
    AutomationCondition,
    AutomationRegistry,
    AutomationRule,
    AutomationRun,
} from "@/lib/api";
import { api } from "@/lib/api";
import { readErrorMessage } from "@/lib/errors";
import { AUTOMATION_RECIPES } from "./automationRecipes";

// Index matches what the server stores in triggerConfig.days and what JS
// getDay() returns (0 = Sunday) - see automation/scheduler.js's WEEKDAYS.
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A rule builder for the automation engine (server/utils/automation/) - every
// trigger/action/operator here is read live from GET /api/automation/registry
// rather than hardcoded, so a new one shows up without touching this file.
//
// Lives inside a Modal launched from the Tasks page rather than its own
// nav-level route - this is operator tooling (same category as backups,
// snapshots, disaster recovery kit already on that page), not a page most
// admins need parked in the sidebar every day.
// One rule as one readable sentence: "When a vault credential stops working,
// only when Category is debrid, then send a notification." This is the core
// of making the panel approachable - the data model (trigger/conditions/
// actions) is fine, but describing a rule in its own jargon ("2 conditions
// -> 1 action") made every rule look like configuration instead of a plain
// statement of intent. Used by the rule list AND as the live preview while
// editing, so what you read later is exactly what you watched yourself say.
function describeRule(
    registry: AutomationRegistry,
    triggerType: string,
    conditions: AutomationCondition[],
    actions: AutomationActionConfig[]
) {
    const trigger = registry.triggers.find((t) => t.type === triggerType);
    const fields = trigger?.fields || [];
    const condText = conditions
        .map((c) => {
            const f = fields.find((x) => x.name === c.field);
            const op = registry.operators.find((o) => o.op === c.op);
            if (!(f && op)) {
                return null;
            }
            // The registry marks value-less operators (is true / is false) as
            // unary - same flag ConditionBuilder itself uses to hide the input.
            const unary = !!(op as { unary?: boolean }).unary;
            // An unfilled value renders as an ellipsis, not a bare "" - the
            // sentence previews while you're still typing the condition.
            const val = c.value === undefined || c.value === "" ? "…" : c.value;
            return `${f.label.toLowerCase()} ${op.label}${unary ? "" : ` "${val}"`}`;
        })
        .filter(Boolean)
        .join(" and ");
    const actText = actions
        .map((a) => registry.actions.find((x) => x.type === a.type)?.label.toLowerCase())
        .filter(Boolean)
        .join(", then ");
    const when = (trigger?.label || triggerType).toLowerCase();
    return {
        action: actText || "do nothing yet",
        cond: condText || null,
        when,
    };
}

function RuleSentence({
    registry,
    triggerType,
    conditions,
    actions,
}: {
    registry: AutomationRegistry;
    triggerType: string;
    conditions: AutomationCondition[];
    actions: AutomationActionConfig[];
}) {
    const d = describeRule(registry, triggerType, conditions, actions);
    return (
        <p className="text-muted text-sm">
            When <span className="font-medium text-default">{d.when}</span>
            {d.cond && (
                <>
                    {" "}
                    — only when <span className="text-default">{d.cond}</span> —{" "}
                </>
            )}
            {!d.cond && ", "}
            <span className="font-medium text-default">{d.action}</span>.
        </p>
    );
}

export function AutomationPanel() {
    // The "new rule" front door: a chooser offering the recipes first, with
    // "start from scratch" as the explicit escape hatch - not the reverse.
    // The blank editor with a name field, an 18-option trigger dropdown and
    // two builder sections is the power path, and leading with it is exactly
    // why this panel went unused ("seems very complicated" - direct quote).
    const [showChooser, setShowChooser] = useState(false);
    // The AI rule-writer input inside the chooser. Drafts open in the editor
    // exactly like a recipe - reviewed, never auto-created.
    const [composeText, setComposeText] = useState("");
    const [isComposing, setIsComposing] = useState(false);
    const handleCompose = async () => {
        if (!composeText.trim() || isComposing) {
            return;
        }
        setIsComposing(true);
        try {
            const { rule, warnings } = await api.composeAutomationRule(composeText.trim());
            setPrefill({
                actions: rule.actions,
                conditions: rule.conditions,
                name: rule.name,
                triggerType: rule.triggerType,
            });
            setEditingRule("new");
            setShowChooser(false);
            setComposeText("");
            if (warnings.length > 0) {
                toast.success(`Drafted, with notes: ${warnings.join("; ")}`);
            } else {
                toast.success("Drafted - review the sentence at the top, then save");
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Could not draft a rule from that"));
        } finally {
            setIsComposing(false);
        }
    };
    const [registry, setRegistry] = useState<AutomationRegistry | null>(null);
    const [rules, setRules] = useState<AutomationRule[]>([]);
    const [runs, setRuns] = useState<AutomationRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [editingRule, setEditingRule] = useState<AutomationRule | "new" | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    // New-rule defaults handed over by another page (e.g. an addon detail
    // page's "Automate" button pre-picking the addon.offline trigger scoped
    // to that addon). Read-and-clear from sessionStorage so a refresh of the
    // Tasks page later doesn't replay the handoff.
    const [prefill, setPrefill] = useState<{
        name?: string;
        triggerType?: string;
        conditions?: AutomationCondition[];
        actions?: AutomationActionConfig[];
    } | null>(null);
    useEffect(() => {
        const id = setTimeout(() => {
            try {
                const raw = sessionStorage.getItem("slicksync-automation-prefill");
                if (!raw) {
                    return;
                }
                sessionStorage.removeItem("slicksync-automation-prefill");
                setPrefill(JSON.parse(raw));
                setEditingRule("new");
            } catch {
                /* corrupt handoff - just open the panel normally */
            }
        }, 0);
        return () => clearTimeout(id);
    }, []);

    const loadAll = useCallback(async () => {
        try {
            const [reg, ruleList] = await Promise.all([
                api.getAutomationRegistry(),
                api.getAutomationRules(),
            ]);
            setRegistry(reg);
            setRules(ruleList);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to load automation"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const loadRuns = useCallback(async () => {
        try {
            setRuns(await api.getAutomationRuns());
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to load run history"));
        }
    }, []);

    useEffect(() => {
        if (showHistory) {
            loadRuns();
        }
    }, [showHistory, loadRuns]);

    const handleToggleEnabled = async (rule: AutomationRule, next: boolean) => {
        setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)));
        try {
            await api.updateAutomationRule(rule.id, { enabled: next });
        } catch (err) {
            setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !next } : r)));
            toast.error(readErrorMessage(err, "Failed to update rule"));
        }
    };

    const handleTest = async (rule: AutomationRule) => {
        setTestingId(rule.id);
        try {
            const { results } = await api.testAutomationRule(rule.id);
            const failed = results.filter((r) => !r.ok);
            if (failed.length === 0) {
                toast.success(`Test passed: ${results.map((r) => r.message).join("; ")}`);
            } else {
                toast.error(`Test found a problem: ${failed.map((r) => r.message).join("; ")}`);
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Test failed"));
        } finally {
            setTestingId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) {
            return;
        }
        try {
            await api.deleteAutomationRule(deleteTarget.id);
            setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
            toast.success(`Deleted "${deleteTarget.name}"`);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to delete rule"));
        } finally {
            setDeleteTarget(null);
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted text-sm">
                    When something happens, do something about it - without shipping code for every
                    combination.
                </p>
                <div className="flex shrink-0 items-center gap-2">
                    <Button onClick={() => setShowHistory((v) => !v)} size="sm" variant="secondary">
                        {showHistory ? "Hide history" : "Run history"}
                    </Button>
                    <Button
                        leftIcon={<PlusIcon className="h-4 w-4" />}
                        onClick={() => setShowChooser(true)}
                        size="sm"
                        variant="primary"
                    >
                        New rule
                    </Button>
                </div>
            </div>

            {showHistory && (
                <Card className="mb-4" padding="lg">
                    <h3 className="mb-3 font-semibold text-base text-default">Recent activity</h3>
                    {runs.length === 0 ? (
                        <p className="text-muted text-sm">No rules have fired yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {runs.map((run) => (
                                <div
                                    className="flex items-start gap-3 rounded-xl bg-surface-hover p-3"
                                    key={run.id}
                                >
                                    {run.ok ? (
                                        <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                                    ) : (
                                        <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-error" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium text-default text-sm">
                                            {run.ruleName}
                                            {run.triggerType.startsWith("test:") && (
                                                <Badge className="ml-2" size="sm" variant="muted">
                                                    Test run
                                                </Badge>
                                            )}
                                        </p>
                                        <p className="mt-0.5 text-muted text-xs">
                                            {run.results.map((r) => r.message).join(" · ")}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-subtle text-xs">
                                        {new Date(run.createdAt).toLocaleString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {/* Recipe cards are deliberately dense - title + two clamped lines,
          three columns - so the whole catalogue is visible at once. The
          earlier two-column layout with full descriptions meant scrolling
          inside the modal to even learn what the options were, which is the
          reverse of what a menu is for. */}
            <Modal
                isOpen={showChooser}
                onClose={() => setShowChooser(false)}
                size="full"
                title="New Rule"
            >
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-muted text-sm">
                            Pick something ready-made - the editor opens filled in, nothing is
                            created until you save.
                        </p>
                        <Button
                            leftIcon={<PlusIcon className="h-4 w-4" />}
                            onClick={() => {
                                setShowChooser(false);
                                setEditingRule("new");
                            }}
                            size="sm"
                            variant="secondary"
                        >
                            Start from scratch
                        </Button>
                    </div>
                    {/* Describe-it row: the AI path sits above the recipes because a
              wish that fits no recipe is exactly when someone opens this. */}
                    <div className="flex items-center gap-2">
                        <input
                            className="flex-1 rounded-xl px-3 py-2 text-sm focus:outline-none"
                            onChange={(e) => setComposeText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    handleCompose();
                                }
                            }}
                            placeholder='Or describe it: "if RPDB dies and has no backup, alert me loudly"'
                            style={{
                                background: "var(--color-surface-hover)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            value={composeText}
                        />
                        <Button
                            isLoading={isComposing}
                            onClick={handleCompose}
                            size="sm"
                            variant="secondary"
                        >
                            Draft it
                        </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {AUTOMATION_RECIPES.filter((r) =>
                            registry?.triggers.some((t) => t.type === r.triggerType)
                        ).map((r) => (
                            <button
                                className="nav-item-hover-pill rounded-xl p-2.5 text-left transition-colors"
                                key={r.id}
                                onClick={() => {
                                    setPrefill({
                                        actions: r.actions,
                                        conditions: r.conditions,
                                        name: r.name,
                                        triggerType: r.triggerType,
                                    });
                                    setEditingRule("new");
                                    setShowChooser(false);
                                }}
                                style={{ background: "var(--color-surface-hover)" }}
                                title={r.description}
                                type="button"
                            >
                                <span className="block font-medium text-default text-sm leading-snug">
                                    {r.title}
                                </span>
                                <span
                                    className="mt-0.5 block text-muted text-xs leading-snug"
                                    style={{
                                        display: "-webkit-box",
                                        overflow: "hidden",
                                        WebkitBoxOrient: "vertical",
                                        WebkitLineClamp: 2,
                                    }}
                                >
                                    {r.description}
                                </span>
                                {r.needs && (
                                    <span
                                        className="mt-0.5 block text-[11px]"
                                        style={{ color: "var(--color-warning)" }}
                                    >
                                        {r.needs}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </Modal>

            {loading ? (
                <Card padding="lg">
                    <p className="text-muted text-sm">Loading...</p>
                </Card>
            ) : rules.length === 0 ? (
                <Card padding="lg">
                    {/* No duplicate recipe grid here - the New Rule chooser is THE
              recipe surface, and rendering the same grid in the empty state
              put the identical list on screen twice, stacked, the moment
              someone clicked New rule. */}
                    <div className="py-8 text-center">
                        <BoltIcon className="mx-auto mb-3 h-10 w-10 text-subtle" />
                        <p className="mb-1 font-medium text-default">No automation rules yet</p>
                        <p className="mx-auto mb-4 max-w-md text-muted text-sm">
                            Each rule is one sentence: when something happens, do something about
                            it. The ready-made recipes cover the ones people set up first.
                        </p>
                        <div className="flex items-center justify-center gap-2">
                            <Button
                                onClick={() => setShowChooser(true)}
                                size="sm"
                                variant="primary"
                            >
                                Browse recipes
                            </Button>
                            <Button
                                leftIcon={<PlusIcon className="h-4 w-4" />}
                                onClick={() => setEditingRule("new")}
                                size="sm"
                                variant="secondary"
                            >
                                Start from scratch
                            </Button>
                        </div>
                    </div>
                </Card>
            ) : (
                <div className="space-y-3">
                    {rules.map((rule) => (
                        <Card key={rule.id} padding="lg">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="flex min-w-0 items-start gap-3">
                                    <div
                                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${rule.enabled ? "bg-primary-muted" : "bg-surface-hover"}`}
                                    >
                                        <BoltIcon
                                            className={`h-5 w-5 ${rule.enabled ? "text-primary" : "text-subtle"}`}
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-default">
                                            {rule.name}
                                        </p>
                                        {registry && (
                                            <RuleSentence
                                                actions={rule.actions}
                                                conditions={rule.conditions}
                                                registry={registry}
                                                triggerType={rule.triggerType}
                                            />
                                        )}
                                        <p className="mt-1 text-subtle text-xs">
                                            {rule.lastRunAt ? (
                                                <>
                                                    Last fired{" "}
                                                    {new Date(rule.lastRunAt).toLocaleString()} ·{" "}
                                                    {rule.runCount} total
                                                </>
                                            ) : (
                                                "Never fired yet"
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <Button
                                        isLoading={testingId === rule.id}
                                        leftIcon={<PlayIcon className="h-4 w-4" />}
                                        onClick={() => handleTest(rule)}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Test
                                    </Button>
                                    <Button
                                        leftIcon={<PencilIcon className="h-4 w-4" />}
                                        onClick={() => setEditingRule(rule)}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Edit
                                    </Button>
                                    <button
                                        className="rounded-lg p-2 text-muted transition-colors hover:bg-error-muted hover:text-error"
                                        onClick={() => setDeleteTarget(rule)}
                                        title="Delete rule"
                                        type="button"
                                    >
                                        <TrashIcon className="h-4 w-4" />
                                    </button>
                                    <ToggleSwitch
                                        checked={rule.enabled}
                                        onChange={() => handleToggleEnabled(rule, !rule.enabled)}
                                        title={`Toggle ${rule.name}`}
                                    />
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {editingRule && registry && (
                <RuleEditorModal
                    onClose={() => {
                        setEditingRule(null);
                        setPrefill(null);
                    }}
                    onSaved={(saved) => {
                        setRules((prev) => {
                            const exists = prev.some((r) => r.id === saved.id);
                            return exists
                                ? prev.map((r) => (r.id === saved.id ? saved : r))
                                : [saved, ...prev];
                        });
                        setEditingRule(null);
                    }}
                    prefill={editingRule === "new" ? prefill : null}
                    registry={registry}
                    rule={editingRule === "new" ? null : editingRule}
                />
            )}

            <ConfirmModal
                confirmText="Delete Rule"
                description={`Delete "${deleteTarget?.name}"? This can't be undone.`}
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete Rule"
                variant="danger"
            />
        </div>
    );
}

// ---- Rule editor -----------------------------------------------------------

function RuleEditorModal({
    registry,
    rule,
    prefill,
    onClose,
    onSaved,
}: {
    registry: AutomationRegistry;
    rule: AutomationRule | null;
    /** New-rule defaults handed over by another page - see AutomationPanel. */
    prefill?: {
        name?: string;
        triggerType?: string;
        conditions?: AutomationCondition[];
        actions?: AutomationActionConfig[];
    } | null;
    onClose: () => void;
    onSaved: (rule: AutomationRule) => void;
}) {
    const groupLabelId1 = useId();
    const repeatedFieldId1 = useId();
    const fieldId1 = useId();
    const [name, setName] = useState(rule?.name || prefill?.name || "");
    const [triggerType, setTriggerType] = useState(
        rule?.triggerType || prefill?.triggerType || registry.triggers[0]?.type || ""
    );
    const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
        rule?.triggerConfig || {}
    );
    const [conditions, setConditions] = useState<AutomationCondition[]>(
        rule?.conditions || prefill?.conditions || []
    );
    const [actions, setActions] = useState<AutomationActionConfig[]>(
        rule?.actions ||
            prefill?.actions ||
            (registry.actions[0] ? [{ config: {}, type: registry.actions[0].type }] : [])
    );
    const [saving, setSaving] = useState(false);

    const trigger = registry.triggers.find((t) => t.type === triggerType);

    // Changing the trigger invalidates any condition whose field belonged to the
    // old one - silently keeping a stale field around would save a rule that
    // fails validation the moment it's re-opened. Same for triggerConfig - a
    // leftover hour/minute from a previous time.daily selection has no meaning
    // once the trigger's changed to something else.
    const handleTriggerChange = (nextType: string) => {
        setTriggerType(nextType);
        setConditions([]);
        setTriggerConfig({});
    };

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error("Give this rule a name");
            return;
        }
        if (actions.length === 0) {
            toast.error("Add at least one action");
            return;
        }
        for (const field of trigger?.triggerConfigFields || []) {
            if (
                field.required &&
                (triggerConfig[field.name] === undefined || triggerConfig[field.name] === "")
            ) {
                toast.error(`"${trigger?.label}" needs ${field.label}`);
                return;
            }
        }
        setSaving(true);
        try {
            const payload = {
                actions,
                conditions,
                enabled: rule?.enabled ?? true,
                name: name.trim(),
                triggerConfig,
                triggerType,
            };
            const saved = rule
                ? await api.updateAutomationRule(rule.id, payload)
                : await api.createAutomationRule(payload);
            toast.success(rule ? "Rule updated" : "Rule created");
            onSaved(saved);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to save rule"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen onClose={onClose} size="lg" title={rule ? "Edit Rule" : "New Rule"}>
            <div className="space-y-5">
                <div>
                    <label
                        className="mb-2 block font-medium text-muted text-sm"
                        htmlFor={`${fieldId1}-1`}
                    >
                        Name
                    </label>
                    <input
                        className="w-full rounded-xl px-4 py-3 focus:outline-none"
                        id={`${fieldId1}-1`}
                        onChange={(e) => setName(e.target.value)}
                        placeholder='e.g. "Notify me when a vault credential expires"'
                        style={{
                            background: "var(--color-surface-hover)",
                            border: "1px solid var(--color-surface-border)",
                            color: "var(--color-text)",
                        }}
                        value={name}
                    />
                </div>

                {/* The rule read back as one sentence, live - so what the three
            sections below mean is never a mystery: this line is the rule. */}
                <div
                    className="rounded-xl p-3"
                    style={{
                        background: "var(--color-surface-hover)",
                        border: "1px solid var(--color-surface-border)",
                    }}
                >
                    <p
                        className="mb-1 font-semibold text-[10px] uppercase tracking-wider"
                        style={{ color: "var(--color-text-subtle)" }}
                    >
                        This rule, in plain words
                    </p>
                    <RuleSentence
                        actions={actions}
                        conditions={conditions}
                        registry={registry}
                        triggerType={triggerType}
                    />
                </div>

                <div>
                    <label
                        className="mb-2 block font-medium text-muted text-sm"
                        htmlFor={`${fieldId1}-2`}
                    >
                        When
                    </label>
                    <select
                        className="w-full rounded-xl px-4 py-3 focus:outline-none"
                        id={`${fieldId1}-2`}
                        onChange={(e) => handleTriggerChange(e.target.value)}
                        style={{
                            background: "var(--color-surface-hover)",
                            border: "1px solid var(--color-surface-border)",
                            color: "var(--color-text)",
                        }}
                        value={triggerType}
                    >
                        {registry.triggers.map((t) => (
                            <option key={t.type} value={t.type}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                    {trigger && <p className="mt-1.5 text-muted text-xs">{trigger.description}</p>}
                </div>

                {/* A trigger's own settings (time.daily's schedule, user.inactive's
            number of days) - not a condition on an event's payload, so they
            get their own small form here rather than living in
            ConditionBuilder below. */}
                {trigger?.triggerConfigFields && trigger.triggerConfigFields.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex gap-3">
                            {trigger.triggerConfigFields
                                .filter((f) => f.type !== "weekdays")
                                .map((field) => (
                                    <div className="flex-1" key={field.name}>
                                        <label
                                            className="mb-1.5 block font-medium text-muted text-xs"
                                            htmlFor={`${repeatedFieldId1}-1-${field.name}`}
                                        >
                                            {field.label}
                                        </label>
                                        <input
                                            className="w-full rounded-xl px-4 py-2.5 focus:outline-none"
                                            id={`${repeatedFieldId1}-1-${field.name}`}
                                            onChange={(e) =>
                                                setTriggerConfig({
                                                    ...triggerConfig,
                                                    [field.name]:
                                                        e.target.value === ""
                                                            ? undefined
                                                            : Number(e.target.value),
                                                })
                                            }
                                            placeholder={field.label}
                                            style={{
                                                background: "var(--color-surface-hover)",
                                                border: "1px solid var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            type="number"
                                            value={
                                                typeof triggerConfig[field.name] === "number"
                                                    ? (triggerConfig[field.name] as number)
                                                    : ""
                                            }
                                        />
                                    </div>
                                ))}
                        </div>
                        {/* Day picker. Nothing selected = every day, which is both the
                sensible default and what rules saved before this existed
                have stored, so an untouched rule keeps its old behaviour. */}
                        {trigger.triggerConfigFields
                            .filter((f) => f.type === "weekdays")
                            .map((field) => {
                                const selected: number[] = Array.isArray(triggerConfig[field.name])
                                    ? (triggerConfig[field.name] as number[])
                                    : [];
                                const toggle = (day: number) => {
                                    const next = selected.includes(day)
                                        ? selected.filter((d) => d !== day)
                                        : [...selected, day].sort((a, b) => a - b);
                                    setTriggerConfig({ ...triggerConfig, [field.name]: next });
                                };
                                return (
                                    <fieldset
                                        aria-labelledby={`${groupLabelId1}-1-${field.name}`}
                                        className="mx-0 min-w-0 border-0 p-0"
                                        key={field.name}
                                    >
                                        <p
                                            className="mb-1.5 block font-medium text-muted text-xs"
                                            id={`${groupLabelId1}-1-${field.name}`}
                                        >
                                            {field.label}
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {WEEKDAY_LABELS.map((label, day) => {
                                                const on = selected.includes(day);
                                                return (
                                                    <button
                                                        aria-pressed={on}
                                                        className={`rounded-lg px-3 py-1.5 font-semibold text-xs transition-colors ${on ? "chip-solid-on" : "chip-solid-off-hover"}`}
                                                        key={day}
                                                        onClick={() => toggle(day)}
                                                        type="button"
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <p className="mt-1.5 text-subtle text-xs">
                                            {selected.length === 0
                                                ? "Runs every day."
                                                : "Runs on " +
                                                  selected
                                                      .map((d) => WEEKDAY_LABELS[d])
                                                      .join(", ") +
                                                  " only."}
                                        </p>
                                    </fieldset>
                                );
                            })}
                    </div>
                )}

                {trigger && (
                    <ConditionBuilder
                        conditions={conditions}
                        onChange={setConditions}
                        operators={registry.operators}
                        trigger={trigger}
                    />
                )}

                <ActionBuilder actions={actions} onChange={setActions} registry={registry} />

                <div className="flex justify-end gap-3 pt-2">
                    <Button onClick={onClose} variant="secondary">
                        Cancel
                    </Button>
                    <Button isLoading={saving} onClick={handleSave}>
                        {rule ? "Save Changes" : "Create Rule"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function ConditionBuilder({
    trigger,
    operators,
    conditions,
    onChange,
}: {
    trigger: AutomationRegistry["triggers"][number];
    operators: AutomationRegistry["operators"];
    conditions: AutomationCondition[];
    onChange: (next: AutomationCondition[]) => void;
}) {
    const groupLabelId2 = useId();
    const addCondition = () => {
        const field = trigger.fields[0];
        if (!field) {
            return;
        }
        onChange([...conditions, { field: field.name, op: "eq", value: "" }]);
    };
    const updateCondition = (i: number, patch: Partial<AutomationCondition>) => {
        onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    };
    const removeCondition = (i: number) => {
        onChange(conditions.filter((_, idx) => idx !== i));
    };

    return (
        <div>
            <fieldset
                aria-labelledby={`${groupLabelId2}-2`}
                className="mx-0 mb-2 flex min-w-0 items-center justify-between border-0 p-0"
            >
                <p className="font-medium text-muted text-sm" id={`${groupLabelId2}-2`}>
                    Only when (optional - leave empty and it runs every time)
                </p>
                <Button
                    leftIcon={<PlusIcon className="h-3.5 w-3.5" />}
                    onClick={addCondition}
                    size="sm"
                    variant="ghost"
                >
                    Add condition
                </Button>
            </fieldset>
            {conditions.length === 0 ? (
                <p className="text-subtle text-xs">
                    No conditions - this rule runs every time the trigger fires.
                </p>
            ) : (
                <div className="space-y-2">
                    {conditions.map((c, i) => {
                        const operator = operators.find((o) => o.op === c.op);
                        return (
                            <div
                                className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
                                key={i}
                            >
                                <select
                                    className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                                    onChange={(e) => updateCondition(i, { field: e.target.value })}
                                    style={{
                                        background: "var(--color-surface-hover)",
                                        border: "1px solid var(--color-surface-border)",
                                        color: "var(--color-text)",
                                    }}
                                    value={c.field}
                                >
                                    {trigger.fields.map((f) => (
                                        <option key={f.name} value={f.name}>
                                            {f.label}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className="shrink-0 rounded-lg px-3 py-2 text-sm focus:outline-none"
                                    onChange={(e) => updateCondition(i, { op: e.target.value })}
                                    style={{
                                        background: "var(--color-surface-hover)",
                                        border: "1px solid var(--color-surface-border)",
                                        color: "var(--color-text)",
                                    }}
                                    value={c.op}
                                >
                                    {operators.map((o) => (
                                        <option key={o.op} value={o.op}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                                {!operator?.unary && (
                                    <input
                                        className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                                        onChange={(e) =>
                                            updateCondition(i, { value: e.target.value })
                                        }
                                        placeholder="value"
                                        style={{
                                            background: "var(--color-surface-hover)",
                                            border: "1px solid var(--color-surface-border)",
                                            color: "var(--color-text)",
                                        }}
                                        value={String(c.value ?? "")}
                                    />
                                )}
                                <button
                                    aria-label="Remove this condition"
                                    className="ml-auto shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-error-muted hover:text-error sm:ml-0"
                                    onClick={() => removeCondition(i)}
                                    title="Remove this condition"
                                    type="button"
                                >
                                    <TrashIcon className="h-4 w-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ActionBuilder({
    registry,
    actions,
    onChange,
}: {
    registry: AutomationRegistry;
    actions: AutomationActionConfig[];
    onChange: (next: AutomationActionConfig[]) => void;
}) {
    const accessibleFieldId1 = useId();
    const addAction = () => {
        const first = registry.actions[0];
        if (!first) {
            return;
        }
        onChange([...actions, { config: {}, type: first.type }]);
    };
    const updateAction = (i: number, patch: Partial<AutomationActionConfig>) => {
        onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    };
    const removeAction = (i: number) => {
        onChange(actions.filter((_, idx) => idx !== i));
    };

    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <label
                    className="font-medium text-muted text-sm"
                    htmlFor={`${accessibleFieldId1}-4`}
                >
                    Then do this
                </label>
                <Button
                    leftIcon={<PlusIcon className="h-3.5 w-3.5" />}
                    onClick={addAction}
                    size="sm"
                    variant="ghost"
                >
                    Add action
                </Button>
            </div>
            <div className="space-y-3">
                {actions.map((action, i) => {
                    const def = registry.actions.find((a) => a.type === action.type);
                    return (
                        <div className="space-y-2 rounded-xl bg-surface-hover p-3" key={i}>
                            <div className="flex items-center gap-2">
                                <select
                                    className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                                    id={`${accessibleFieldId1}-4`}
                                    onChange={(e) =>
                                        updateAction(i, { config: {}, type: e.target.value })
                                    }
                                    style={{
                                        background: "var(--color-surface)",
                                        border: "1px solid var(--color-surface-border)",
                                        color: "var(--color-text)",
                                    }}
                                    value={action.type}
                                >
                                    {registry.actions.map((a) => (
                                        <option key={a.type} value={a.type}>
                                            {a.label}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-error-muted hover:text-error"
                                    onClick={() => removeAction(i)}
                                    type="button"
                                >
                                    <TrashIcon className="h-4 w-4" />
                                </button>
                            </div>
                            {def?.description && (
                                <p className="text-muted text-xs">{def.description}</p>
                            )}
                            {def?.configFields.map((field) => (
                                <ActionConfigField
                                    field={field}
                                    key={field.name}
                                    onChange={(v) =>
                                        updateAction(i, {
                                            config: { ...action.config, [field.name]: v },
                                        })
                                    }
                                    value={action.config[field.name] || ""}
                                />
                            ))}
                        </div>
                    );
                })}
                {actions.length === 0 && (
                    <p className="text-subtle text-xs">No actions yet - add at least one.</p>
                )}
            </div>
        </div>
    );
}

function ActionConfigField({
    field,
    value,
    onChange,
}: {
    field: AutomationRegistry["actions"][number]["configFields"][number];
    value: string;
    onChange: (v: string) => void;
}) {
    const [options, setOptions] = useState<Array<{ id: string; name: string }>>([]);
    const [loadingOptions, setLoadingOptions] = useState(
        field.type === "addon" || field.type === "group" || field.type === "user"
    );

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                if (field.type === "addon") {
                    const addons = await api.getAddons();
                    if (!cancelled) {
                        setOptions(addons.map((a) => ({ id: a.id, name: a.name })));
                    }
                } else if (field.type === "group") {
                    const groups = await api.getGroups();
                    if (!cancelled) {
                        setOptions(groups.map((g) => ({ id: g.id, name: g.name })));
                    }
                } else if (field.type === "user") {
                    const users = await api.getUsers();
                    if (!cancelled) {
                        setOptions(
                            users.map((u) => ({
                                id: u.id,
                                name: u.username || u.name || u.email || "Unnamed user",
                            }))
                        );
                    }
                }
            } catch {
                /* picker just shows empty - the text-level validation error on save still catches a missing required pick */
            } finally {
                if (!cancelled) {
                    setLoadingOptions(false);
                }
            }
        }
        if (field.type === "addon" || field.type === "group" || field.type === "user") {
            load();
        }
        return () => {
            cancelled = true;
        };
    }, [field.type]);

    const inputStyle = {
        background: "var(--color-surface)",
        border: "1px solid var(--color-surface-border)",
        color: "var(--color-text)",
    };

    if (field.type === "addon" || field.type === "group" || field.type === "user") {
        return (
            <div>
                <select
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    disabled={loadingOptions}
                    onChange={(e) => onChange(e.target.value)}
                    style={inputStyle}
                    value={value}
                >
                    <option value="">
                        {loadingOptions ? "Loading..." : `Select ${field.label.toLowerCase()}...`}
                    </option>
                    {options.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.name}
                        </option>
                    ))}
                </select>
                {field.hint && <p className="mt-1 text-subtle text-xs">{field.hint}</p>}
            </div>
        );
    }

    // Fixed set of choices defined by the action itself (e.g. the sync action's
    // "who to sync"), as opposed to the addon/group/user pickers above which
    // load their options from the account's own data.
    if (field.type === "select" && Array.isArray(field.options)) {
        return (
            <div>
                <select
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    onChange={(e) => onChange(e.target.value)}
                    style={inputStyle}
                    value={value}
                >
                    <option value="">Select...</option>
                    {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                {field.hint && <p className="mt-1 text-subtle text-xs">{field.hint}</p>}
            </div>
        );
    }

    if (field.type === "text") {
        return (
            <div>
                <textarea
                    className="w-full resize-none rounded-lg px-3 py-2 text-sm focus:outline-none"
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={field.label}
                    rows={2}
                    style={inputStyle}
                    value={value}
                />
                {field.hint && <p className="mt-1 text-subtle text-xs">{field.hint}</p>}
            </div>
        );
    }

    return (
        <div>
            <input
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                onChange={(e) => onChange(e.target.value)}
                placeholder={field.label}
                style={inputStyle}
                value={value}
            />
            {field.hint && <p className="mt-1 text-subtle text-xs">{field.hint}</p>}
        </div>
    );
}
