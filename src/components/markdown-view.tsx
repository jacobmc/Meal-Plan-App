"use client";

import ReactMarkdown from "react-markdown";

export function MarkdownView({ source }: { source: string | null | undefined }) {
  if (!source || source.trim().length === 0) {
    return <p className="text-muted-foreground text-sm">No instructions yet.</p>;
  }
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  );
}
