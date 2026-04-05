import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const MAX_HISTORY = 20;

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export async function getConversationHistory(userId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY);

  if (error || !data) return [];
  return data.map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content,
  }));
}

export async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await supabase.from("agent_conversations").insert({
    user_id: userId,
    role,
    content,
    created_at: new Date().toISOString(),
  });

  const { data: rows } = await supabase
    .from("agent_conversations")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(MAX_HISTORY, 999);

  if (rows && rows.length > 0) {
    await supabase.from("agent_conversations").delete().in("id", rows.map((r) => r.id));
  }
}

export async function clearHistory(userId: string): Promise<void> {
  await supabase.from("agent_conversations").delete().eq("user_id", userId);
}
