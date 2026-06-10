"use client";

import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";

import type { ExclusionClause } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryPill } from "@/components/category-pill";
import { cn } from "@/lib/utils";

export function ClauseCard({ clause }: { clause: ExclusionClause }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="p-4 pb-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {clause.number}
            </p>
            <CardTitle className="mt-0.5 text-sm">{clause.title}</CardTitle>
          </div>
          <CategoryPill category={clause.category} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 p-4">
        <div className="flex flex-wrap gap-1">
          {clause.triggerConcepts.map((concept) => (
            <Badge
              key={concept}
              variant="secondary"
              className="rounded-md font-normal text-muted-foreground"
            >
              {concept}
            </Badge>
          ))}
        </div>
        {clause.exceptions.length > 0 && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-medium">
                Exception — may still be covered:{" "}
              </span>
              {clause.exceptions.join("; ")}
            </span>
          </div>
        )}
        {clause.category === "temporal" && (
          <p className="text-xs italic text-muted-foreground">
            Depends on dates (waiting period / pre-existing) — needs the
            member&apos;s policy dates to confirm.
          </p>
        )}
        {clause.rawText && (
          <div>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", open && "rotate-180")}
              />
              {open ? "Hide original policy wording" : "Show original policy wording"}
            </button>
            {open && (
              <p className="mt-1.5 rounded-md bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground">
                {clause.rawText}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
