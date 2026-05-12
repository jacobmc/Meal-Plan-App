"use client";

import { useState } from "react";
import { MarkdownView } from "./markdown-view";

export interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write instructions in Markdown…",
  rows = 12,
  maxLength = 20_000,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex gap-1 rounded-md border bg-muted/30 p-0.5 self-start">
        <button
          type="button"
          onClick={() => setTab("edit")}
          className={
            "rounded px-2 py-1 text-xs " +
            (tab === "edit" ? "bg-background shadow-sm" : "text-muted-foreground")
          }
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setTab("preview")}
          className={
            "rounded px-2 py-1 text-xs " +
            (tab === "preview" ? "bg-background shadow-sm" : "text-muted-foreground")
          }
        >
          Preview
        </button>
      </div>
      {tab === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          className="w-full rounded-md border bg-background p-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <div className="rounded-md border bg-background p-3 min-h-[10rem]">
          <MarkdownView source={value} />
        </div>
      )}
    </div>
  );
}
