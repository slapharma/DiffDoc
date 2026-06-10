"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client (publishable key). Used only for direct-to-
 * Storage uploads via signed upload URLs — the token in the signed URL is
 * what authorizes the write, so no RLS policies are needed yet.
 */
let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase public environment is not configured.");
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
