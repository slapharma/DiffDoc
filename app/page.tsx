"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, FileText, Loader2, Upload, X } from "lucide-react";

type Side = "a" | "b";

import { BuildStamp } from "@/components/build-stamp";
import { Wordmark } from "@/components/wordmark";

type RecentComparison = {
  id: string;
  title: string | null;
  doc_a_name: string | null;
  doc_b_name: string | null;
  similarity_score: number | null;
  status: string;
  created_at: string;
};

export default function Home() {
  const router = useRouter();
  const [files, setFiles] = useState<{ a: File | null; b: File | null }>({
    a: null,
    b: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCompare = files.a && files.b && !busy;

  async function compare() {
    if (!files.a || !files.b) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Ask the API for signed Storage upload URLs (files don't pass
      //    through Vercel — its 4.5 MB body limit would reject large docs).
      const init = await postJson("/api/upload/init", {
        doc_a: { name: files.a.name, size: files.a.size },
        doc_b: { name: files.b.name, size: files.b.size },
      });

      // 2. Upload both files straight to Supabase Storage.
      const { getBrowserClient } = await import("@/lib/supabase/client");
      const storage = getBrowserClient().storage.from("documents");
      const [upA, upB] = await Promise.all([
        storage.uploadToSignedUrl(init.doc_a.path, init.doc_a.token, files.a),
        storage.uploadToSignedUrl(init.doc_b.path, init.doc_b.token, files.b),
      ]);
      const upError = upA.error ?? upB.error;
      if (upError) throw new Error(`Upload failed: ${upError.message}`);

      // 3. Server validates the real bytes and creates the comparison.
      const done = await postJson("/api/upload/complete", {
        comparison_id: init.comparison_id,
        doc_a_name: files.a.name,
        doc_b_name: files.b.name,
      });

      // Fire the processing pipeline without awaiting — the comparison page
      // polls status and self-heals if this trigger is lost.
      void fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comparison_id: done.comparison_id }),
      });

      router.push(`/c/${done.comparison_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink font-sans flex flex-col">
      <header className="border-b border-line px-8 py-4">
        <Wordmark />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold font-display mb-3">
              Compare two documents<span className="text-leaf">.</span>
            </h1>
            <p className="text-ink-soft text-sm font-serif">
              Upload two versions — .docx or .pdf, up to 25 MB each. DiffDoc reads both,
              measures similarity, and marks up exactly what changed.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-5 mb-6">
            <FileSlot
              side="a"
              label="Primary"
              hint="your reference document"
              file={files.a}
              disabled={busy}
              onSelect={(f) => setFiles((prev) => ({ ...prev, a: f }))}
            />
            <FileSlot
              side="b"
              label="Comparator"
              hint="the document to compare"
              file={files.b}
              disabled={busy}
              onSelect={(f) => setFiles((prev) => ({ ...prev, b: f }))}
            />
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-flag-wash border border-flag/30 rounded-md text-sm text-flag">
              {error}
            </div>
          )}

          <div className="flex justify-center">
            <button
              onClick={compare}
              disabled={!canCompare}
              className="px-7 py-3 bg-leaf text-white rounded-full font-medium text-sm flex items-center gap-2 hover:bg-leaf-deep disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
                </>
              ) : (
                <>Compare documents</>
              )}
            </button>
          </div>

          <RecentComparisons />
        </div>
      </main>

      <footer className="border-t border-line px-6 py-2.5 text-xs text-ink-faint font-mono text-center">
        <BuildStamp />
      </footer>
    </div>
  );
}

/**
 * POST JSON and parse the response defensively — platform-level errors
 * (e.g. proxy limits) return plain text, which must surface as a readable
 * message rather than a JSON parse error.
 */
async function postJson(
  url: string,
  payload: unknown,
): Promise<Record<string, any>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: Record<string, any> | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON — fall through to the status-based error below
  }
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!body) throw new Error("Unexpected non-JSON response from the server.");
  return body;
}

function RecentComparisons() {
  const [items, setItems] = useState<RecentComparison[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/comparisons", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setItems(body.comparisons);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div className="mt-14">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-faint flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" /> Recent comparisons
        </h2>
        <a href="/tasks" className="text-[11px] font-mono uppercase tracking-[0.12em] text-leaf-deep hover:text-leaf cursor-pointer">
          My Tasks →
        </a>
      </div>
      <div className="border-t border-line">
        {items.map((item) => (
          <a
            key={item.id}
            href={`/c/${item.id}`}
            className="flex items-center gap-3 px-2 py-3 border-b border-line hover:bg-paper-deep transition-colors group"
          >
            <FileText className="w-4 h-4 text-ink-faint group-hover:text-leaf flex-shrink-0 transition-colors" />
            <span className="flex-1 min-w-0 text-sm font-serif text-ink truncate">
              {item.title ?? (
                <>
                  {item.doc_a_name ?? "Primary"}{" "}
                  <span className="text-ink-faint">vs</span>{" "}
                  {item.doc_b_name ?? "Comparator"}
                </>
              )}
            </span>
            {item.status === "complete" && item.similarity_score != null ? (
              <span className="font-mono text-xs text-leaf-deep font-bold">
                {item.similarity_score}%
              </span>
            ) : (
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                  item.status === "failed"
                    ? "bg-flag-wash text-flag"
                    : "bg-paper-deep text-ink-soft"
                }`}
              >
                {item.status}
              </span>
            )}
            <span className="text-xs text-ink-faint font-mono w-20 text-right">
              {new Date(item.created_at).toLocaleDateString()}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function FileSlot({
  side,
  label,
  hint,
  file,
  disabled,
  onSelect,
}: {
  side: Side;
  label: string;
  hint: string;
  file: File | null;
  disabled: boolean;
  onSelect: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const dropped = e.dataTransfer.files[0];
        if (dropped) onSelect(dropped);
      }}
      className={`rounded-lg p-6 bg-white border transition-all ${
        dragging
          ? "border-leaf ring-2 ring-leaf-ring"
          : file
            ? "border-ink/60"
            : "border-line border-dashed"
      } ${file ? "-rotate-[0.4deg]" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.pdf"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
      />
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-leaf-deep">
          {label}
        </span>
        <span className="text-xs text-ink-faint font-serif italic">{hint}</span>
      </div>
      {file ? (
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-ink flex-shrink-0" strokeWidth={1.25} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink truncate">{file.name}</div>
            <div className="text-xs text-ink-faint font-mono">
              {(file.size / 1024).toFixed(0)} KB
            </div>
          </div>
          <button
            onClick={() => onSelect(null)}
            disabled={disabled}
            aria-label={`Remove document ${side.toUpperCase()}`}
            className="p-1 text-ink-faint hover:text-flag rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full flex flex-col items-center gap-2 py-4 text-ink-soft hover:text-ink"
        >
          <Upload className="w-6 h-6" strokeWidth={1.25} />
          <span className="text-sm font-serif">
            Drop a file here or <span className="underline decoration-leaf decoration-2 underline-offset-2">browse</span>
          </span>
          <span className="text-xs text-ink-faint font-mono">.docx / .pdf</span>
        </button>
      )}
    </div>
  );
}
