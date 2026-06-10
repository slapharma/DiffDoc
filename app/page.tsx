"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, FileText, GitCompare, Loader2, Upload, X } from "lucide-react";

type Side = "a" | "b";

type RecentComparison = {
  id: string;
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
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans flex flex-col">
      <header className="border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-stone-900 rounded-sm flex items-center justify-center">
            <GitCompare className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-mono font-semibold tracking-tight text-base">diffdoc</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold font-serif mb-2">Compare two documents</h1>
            <p className="text-stone-600 text-sm">
              Upload two versions — .docx or .pdf, up to 25 MB each. DiffDoc parses both,
              measures similarity, and shows you exactly what changed.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <FileSlot
              side="a"
              label="Document A"
              hint="Original"
              file={files.a}
              disabled={busy}
              onSelect={(f) => setFiles((prev) => ({ ...prev, a: f }))}
            />
            <FileSlot
              side="b"
              label="Document B"
              hint="Revised"
              file={files.b}
              disabled={busy}
              onSelect={(f) => setFiles((prev) => ({ ...prev, b: f }))}
            />
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="flex justify-center">
            <button
              onClick={compare}
              disabled={!canCompare}
              className="px-6 py-2.5 bg-stone-900 text-white rounded-md font-medium text-sm flex items-center gap-2 hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
                </>
              ) : (
                <>
                  <GitCompare className="w-4 h-4" /> Compare documents
                </>
              )}
            </button>
          </div>

          <RecentComparisons />
        </div>
      </main>

      <footer className="border-t border-stone-200 bg-white px-6 py-2 text-xs text-stone-500 font-mono text-center">
        v0.1.0-beta
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
    <div className="mt-12">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> Recent comparisons
      </h2>
      <div className="bg-white border border-stone-200 rounded-lg divide-y divide-stone-100">
        {items.map((item) => (
          <a
            key={item.id}
            href={`/c/${item.id}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 transition-colors"
          >
            <FileText className="w-4 h-4 text-stone-400 flex-shrink-0" />
            <span className="flex-1 min-w-0 text-sm text-stone-800 truncate">
              {item.doc_a_name ?? "Document A"}{" "}
              <span className="text-stone-400">vs</span>{" "}
              {item.doc_b_name ?? "Document B"}
            </span>
            {item.status === "complete" && item.similarity_score != null ? (
              <span className="font-mono text-xs text-stone-500">
                {item.similarity_score}%
              </span>
            ) : (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  item.status === "failed"
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {item.status}
              </span>
            )}
            <span className="text-xs text-stone-400 font-mono w-20 text-right">
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
      className={`border-2 border-dashed rounded-lg p-6 bg-white transition-colors ${
        dragging ? "border-stone-900 bg-stone-50" : "border-stone-200"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.pdf"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
      />
      <div className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">
        {label} <span className="font-normal normal-case">· {hint}</span>
      </div>
      {file ? (
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-stone-700 flex-shrink-0" strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-stone-900 truncate">{file.name}</div>
            <div className="text-xs text-stone-500 font-mono">
              {(file.size / 1024).toFixed(0)} KB
            </div>
          </div>
          <button
            onClick={() => onSelect(null)}
            disabled={disabled}
            aria-label={`Remove document ${side.toUpperCase()}`}
            className="p-1 text-stone-400 hover:text-stone-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full flex flex-col items-center gap-2 py-4 text-stone-500 hover:text-stone-700"
        >
          <Upload className="w-6 h-6" strokeWidth={1.5} />
          <span className="text-sm">
            Drop a file here or <span className="underline">browse</span>
          </span>
          <span className="text-xs text-stone-400">.docx or .pdf</span>
        </button>
      )}
    </div>
  );
}
