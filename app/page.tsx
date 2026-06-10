"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, GitCompare, Loader2, Upload, X } from "lucide-react";

type Side = "a" | "b";

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
      const form = new FormData();
      form.set("doc_a", files.a);
      form.set("doc_b", files.b);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");

      // Fire the processing pipeline without awaiting — the comparison page
      // polls status, so navigation shouldn't wait for the parse to finish.
      void fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comparison_id: body.comparison_id }),
      });

      router.push(`/c/${body.comparison_id}`);
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

      <main className="flex-1 flex items-center justify-center px-6">
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
        </div>
      </main>

      <footer className="border-t border-stone-200 bg-white px-6 py-2 text-xs text-stone-500 font-mono text-center">
        v0.1.0-beta
      </footer>
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
