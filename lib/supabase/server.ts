import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service-role key.
 *
 * This bypasses Row Level Security, so it must only ever run in trusted server
 * contexts — API routes and the Railway worker — and never reach the browser.
 * Phase 1 has no auth yet, so all database and Storage access goes through here.
 */
let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next.js caches fetch() GETs inside route handlers by default, which
    // makes supabase-js replay stale DB reads and storage downloads (the UI
    // then polls a frozen "processing" status forever). Always bypass it.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}

/** Private bucket holding both originals and export bundles. */
export const DOCUMENTS_BUCKET = "documents";
