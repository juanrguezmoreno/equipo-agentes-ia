import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";

export async function getAuthenticatedUser(): Promise<{
  user: User | null;
  error: (Error & { status?: number }) | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return { user: data.user, error };
}
