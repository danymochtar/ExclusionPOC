import { AlertTriangle, CheckCircle2, Eye, OctagonAlert } from "lucide-react";

import type { MatchStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  MatchStatus,
  { label: string; className: string; Icon: typeof OctagonAlert }
> = {
  excluded: {
    label: "Exclusion found — verify",
    className: "border-red-200 bg-red-100 text-red-800",
    Icon: OctagonAlert,
  },
  likely: {
    label: "Possible exclusion",
    className: "border-amber-200 bg-amber-100 text-amber-800",
    Icon: AlertTriangle,
  },
  review: {
    label: "Needs human review",
    className: "border-blue-200 bg-blue-100 text-blue-800",
    Icon: Eye,
  },
  not_excluded: {
    label: "No exclusion found",
    className: "border-emerald-200 bg-emerald-100 text-emerald-800",
    Icon: CheckCircle2,
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: MatchStatus;
  className?: string;
}) {
  const { label, className: colors, Icon } = STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn(colors, className)}>
      <Icon className="size-3.5" />
      {label}
    </Badge>
  );
}
