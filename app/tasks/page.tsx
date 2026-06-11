"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Plus } from "lucide-react";
import { BuildStamp } from "@/components/build-stamp";
import { Wordmark } from "@/components/wordmark";

type Task = {
  id: string;
  title: string | null;
  doc_a_name: string | null;
  doc_b_name: string | null;
  similarity_score: number | null;
  status: string;
  created_at: string;
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/comparisons", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => {
        if (!cancelled) setTasks(body.comparisons);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const complete = tasks?.filter((t) => t.status === "complete") ?? [];
  const inFlight = tasks?.filter((t) => t.status === "pending" || t.status === "processing") ?? [];
  const failed = tasks?.filter((t) => t.status === "failed") ?? [];
  const avgSimilarity =
    complete.length > 0
      ? Math.round(
          (complete.reduce((sum, t) => sum + (t.similarity_score ?? 0), 0) / complete.length) * 10,
        ) / 10
      : null;

  return (
    <div className="min-h-screen bg-paper text-ink font-sans flex flex-col">
      <header className="border-b border-line px-8 py-4 flex items-center justify-between">
        <Wordmark />
        <a
          href="/"
          className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-[0.12em] rounded-full bg-leaf text-white hover:bg-leaf-deep transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New comparison
        </a>
      </header>

      <main className="flex-1 px-8 py-10">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold font-display mb-1">
            My Tasks<span className="text-leaf">.</span>
          </h1>
          <p className="text-sm font-serif italic text-ink-soft mb-8">
            Every comparison you&apos;ve run, in one place.
          </p>

          {tasks === null && !error && (
            <div className="flex items-center gap-2 text-ink-soft text-sm font-serif italic">
              <Loader2 className="w-4 h-4 animate-spin text-leaf" /> Loading tasks…
            </div>
          )}
          {error && (
            <p className="text-sm text-flag bg-flag-wash border border-flag/30 rounded-md px-4 py-3">
              Couldn&apos;t load tasks — refresh to try again.
            </p>
          )}

          {tasks && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
                <Stat label="Tasks" value={String(tasks.length)} />
                <Stat label="Complete" value={String(complete.length)} accent />
                <Stat label="In progress" value={String(inFlight.length)} />
                <Stat
                  label="Avg similarity"
                  value={avgSimilarity != null ? `${avgSimilarity}%` : "—"}
                />
              </div>

              {tasks.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-line rounded-xl">
                  <FileText className="w-8 h-8 text-ink-faint mx-auto mb-3" strokeWidth={1.25} />
                  <p className="font-serif text-ink-soft mb-4">No comparisons yet.</p>
                  <a
                    href="/"
                    className="inline-block px-5 py-2 text-sm font-medium bg-leaf text-white rounded-full hover:bg-leaf-deep cursor-pointer"
                  >
                    Run your first comparison
                  </a>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {tasks.map((task) => (
                    <a
                      key={task.id}
                      href={`/c/${task.id}`}
                      className="group bg-white border border-line rounded-xl p-5 hover:border-ink/40 hover:shadow-sm transition-all cursor-pointer flex flex-col gap-3"
                    >
                      <div className="min-w-0">
                        <h2 className="font-display font-bold text-ink truncate group-hover:text-leaf-deep transition-colors">
                          {task.title ?? `${task.doc_a_name ?? "Primary"} vs ${task.doc_b_name ?? "Comparator"}`}
                        </h2>
                        <p className="text-xs text-ink-faint font-serif italic truncate mt-0.5">
                          {task.doc_a_name ?? "Primary"} · {task.doc_b_name ?? "Comparator"}
                        </p>
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        {task.status === "complete" && task.similarity_score != null ? (
                          <span className="font-mono text-sm font-bold text-leaf-deep">
                            {task.similarity_score}%{" "}
                            <span className="font-normal text-ink-faint text-[11px]">similar</span>
                          </span>
                        ) : (
                          <span
                            className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                              task.status === "failed"
                                ? "bg-flag-wash text-flag"
                                : "bg-paper-deep text-ink-soft"
                            }`}
                          >
                            {task.status}
                          </span>
                        )}
                        <span className="text-[11px] text-ink-faint font-mono">
                          {new Date(task.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </a>
                  ))}
                </div>
              )}

              {failed.length > 0 && (
                <p className="mt-6 text-xs text-ink-faint font-serif italic">
                  {failed.length} failed {failed.length === 1 ? "task" : "tasks"} shown above — open
                  one to retry with new files.
                </p>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-line px-6 py-2.5 text-xs text-ink-faint font-mono text-center">
        <BuildStamp />
      </footer>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white border border-line rounded-xl p-4">
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
        {label}
      </div>
      <div
        className={`text-2xl font-bold font-mono mt-1 ${accent ? "text-leaf-deep" : "text-ink"}`}
      >
        {value}
      </div>
    </div>
  );
}
