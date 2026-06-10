import type { ExclusionCategory } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CATEGORY_CONFIG: Record<
  ExclusionCategory,
  { label: string; className: string }
> = {
  diagnosis: {
    label: "Diagnosis",
    className: "border-violet-200 bg-violet-100 text-violet-800",
  },
  temporal: {
    label: "Temporal",
    className: "border-sky-200 bg-sky-100 text-sky-800",
  },
  circumstantial: {
    label: "Circumstantial",
    className: "border-orange-200 bg-orange-100 text-orange-800",
  },
  other: {
    label: "Other",
    className: "border-gray-200 bg-gray-100 text-gray-700",
  },
};

export function CategoryPill({
  category,
  className,
}: {
  category: ExclusionCategory;
  className?: string;
}) {
  const { label, className: colors } = CATEGORY_CONFIG[category];
  return (
    <Badge variant="outline" className={cn(colors, className)}>
      {label}
    </Badge>
  );
}
