"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ComparisonView, type ComparisonData } from "@/components/comparison-view";

type Status = "loading" | "pending" | "processing" | "complete" | "failed" | "missing";

const POLL_MS = 1500;

export default function ComparisonPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<ComparisonData | null>(null);
  const processTriggered = useRef(false);

  const fetchComparison = useCallback(async (): Promise<Status> => {
    const res = await fetch(`/api/comparisons/${params.id}`, { cache: "no-store" });
    if (res.status === 404 || res.status === 400) return "missing";
    if (!res.ok) return "failed";
    const body = await res.json();
    const s: Status = body.comparison.status;
    if (s === "pending" && !processTriggered.current) {
      // Self-healing: if the upload page's fire-and-forget trigger was lost,
      // (re)start processing from here. The process route only accepts
      // pending comparisons, so a duplicate trigger is harmless.
      processTriggered.current = true;
      void fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comparison_id: params.id }),
      });
    }
    if (s === "complete" && body.parsed) {
      setData({ comparison: body.comparison, parsed: body.parsed });
    }
    return s;
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const s = await fetchComparison();
        if (cancelled) return;
        setStatus(s);
        if (s === "pending" || s === "processing") {
          timer = setTimeout(tick, POLL_MS);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchComparison]);

  if (status === "complete" && data) return <ComparisonView data={data} />;

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center font-sans">
      <div className="text-center max-w-sm px-6">
        {status === "failed" || status === "missing" ? (
          <>
            <AlertTriangle className="w-8 h-8 text-flag mx-auto mb-3" />
            <h1 className="font-display font-bold text-lg text-ink mb-2">
              {status === "missing" ? "Comparison not found" : "Processing failed"}
            </h1>
            <p className="text-sm font-serif text-ink-soft mb-5">
              {status === "missing"
                ? "This comparison doesn't exist or the link is wrong."
                : "Something went wrong while parsing or diffing the documents."}
            </p>
            <a
              href="/"
              className="inline-block px-5 py-2 text-sm font-medium bg-ink text-paper rounded-lg hover:bg-ink/85"
            >
              Start a new comparison
            </a>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 text-leaf mx-auto mb-3 animate-spin" />
            <h1 className="font-display font-bold text-lg text-ink mb-1">
              {status === "processing" ? "Comparing documents…" : "Preparing comparison…"}
            </h1>
            <p className="text-sm font-serif italic text-ink-soft">
              Reading both files and marking up the differences. Usually takes a few seconds.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
