import { createClient } from "@supabase/supabase-js";

// These two values come from your Supabase project (Settings → API).
// They're injected at build time from the .env file — see SETUP guide.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(url, key);

// Every game shares one row keyed by a "game code" so multiple friend
// groups can run separate games on the same deployed app.
const TABLE = "games";

export async function loadGame(code) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("state")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  return data ? data.state : null;
}

export async function saveGame(code, state) {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ code, state, updated_at: new Date().toISOString() }, { onConflict: "code" });
  if (error) throw error;
}

// Realtime: fire `onChange(state)` whenever anyone updates this game's row.
export function subscribeGame(code, onChange) {
  const channel = supabase
    .channel(`game-${code}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `code=eq.${code}` },
      (payload) => { if (payload.new?.state) onChange(payload.new.state); }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
