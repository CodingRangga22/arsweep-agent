"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConversationHistory = getConversationHistory;
exports.saveMessage = saveMessage;
exports.clearHistory = clearHistory;
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const MAX_HISTORY = 20;
async function getConversationHistory(userId) {
    const { data, error } = await supabase
        .from("agent_conversations")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(MAX_HISTORY);
    if (error || !data)
        return [];
    return data.map((row) => ({
        role: row.role,
        content: row.content,
    }));
}
async function saveMessage(userId, role, content) {
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
async function clearHistory(userId) {
    await supabase.from("agent_conversations").delete().eq("user_id", userId);
}
