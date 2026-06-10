"use client";

import { useState } from "react";
import { CheckCheck, MessageCircleQuestion, Undo2, UserRoundPen } from "lucide-react";

import type { AssessorAction, AssessorDecision } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const ACTION_CONFIG: Record<
  AssessorAction,
  { label: string; chip: string; chipClass: string; Icon: typeof CheckCheck; needsReason: boolean }
> = {
  confirm: {
    label: "Confirm exclusion",
    chip: "Exclusion confirmed by assessor",
    chipClass: "border-red-200 bg-red-50 text-red-800",
    Icon: CheckCheck,
    needsReason: false,
  },
  override: {
    label: "Override",
    chip: "Overridden by assessor",
    chipClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Icon: UserRoundPen,
    needsReason: true,
  },
  info: {
    label: "Request info",
    chip: "More information requested",
    chipClass: "border-blue-200 bg-blue-50 text-blue-800",
    Icon: MessageCircleQuestion,
    needsReason: true,
  },
};

export function AssessorDecisionBar({
  decision,
  onDecide,
}: {
  decision?: AssessorDecision;
  onDecide: (decision: AssessorDecision | undefined) => void;
}) {
  const [pendingAction, setPendingAction] = useState<AssessorAction | null>(null);
  const [reason, setReason] = useState("");

  if (decision) {
    const { chip, chipClass, Icon } = ACTION_CONFIG[decision.action];
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <Badge variant="outline" className={chipClass}>
          <Icon className="size-3.5" />
          {chip}
        </Badge>
        {decision.reason && (
          <span className="text-xs text-muted-foreground">
            “{decision.reason}”
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={() => onDecide(undefined)}
        >
          <Undo2 />
          Undo
        </Button>
      </div>
    );
  }

  if (pendingAction) {
    const { label } = ACTION_CONFIG[pendingAction];
    return (
      <form
        className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          onDecide({
            action: pendingAction,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          });
          setPendingAction(null);
          setReason("");
        }}
      >
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            pendingAction === "info"
              ? "What do you need to know? (e.g. was the injury accidental?)"
              : "Reason (optional)"
          }
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" className="h-8 text-xs">
          {label}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setPendingAction(null);
            setReason("");
          }}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      <span className="text-xs text-muted-foreground">Your call:</span>
      {(Object.keys(ACTION_CONFIG) as AssessorAction[]).map((action) => {
        const { label, Icon, needsReason } = ACTION_CONFIG[action];
        return (
          <Button
            key={action}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              needsReason ? setPendingAction(action) : onDecide({ action })
            }
          >
            <Icon className="size-3.5" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
