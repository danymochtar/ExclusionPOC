import { cn } from "@/lib/utils";

/**
 * Confidence shown honestly: low scores render as a visibly sparse,
 * muted bar rather than an authoritative solid one.
 */
export function ConfidenceBar({
  value,
  className,
}: {
  value: number; // 0..1
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone =
    pct >= 75 ? "bg-foreground/80" : pct >= 45 ? "bg-foreground/55" : "bg-foreground/30";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        AI confidence: {pct}%
      </span>
    </div>
  );
}
