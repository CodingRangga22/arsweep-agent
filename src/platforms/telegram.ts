import TelegramBot from "node-telegram-bot-api";
import { handleMessage } from "../router";
import { scanWallet } from "../agent/tools/scanWallet";
import { sweepDust } from "../agent/tools/sweepDust";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: true });
const userWallets = new Map<number, string>();
const pendingSweep = new Map<number, string>(); // userId -> walletAddress

function cleanText(text: string): string {
  return text
    .replace(/<function[^>]*>[\s\S]*?<\/function>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function shortAddr(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

// ─── /start ──────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🚀 Buka Arsweep App", web_app: { url: "https://arsweep.fun?twa=1" } },
      ],
      [
        { text: "🔍 Scan Wallet", callback_data: "action_scan" },
        { text: "🧹 Clean Wallet", callback_data: "action_clean" },
      ],
      [
        { text: "🛡 Cek Scam", callback_data: "action_scam" },
        { text: "📊 Portfolio", callback_data: "action_portfolio" },
      ],
      [
        { text: "❓ Bantuan", callback_data: "action_help" },
      ],
    ],
  };

  bot.sendMessage(
    msg.chat.id,
    `👋 *Halo! Saya Arsy*, AI Wallet Manager untuk Solana.\n\nSaya bisa membantu kamu:\n🔍 Scan wallet untuk cek kondisi\n🧹 Bersihkan dust & akun kosong\n🛡 Deteksi token scam\n📊 Lihat statistik portfolio\n\nPilih menu di bawah atau ketik pesan langsung:`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// ─── /clear ───────────────────────────────────────────────────────────────────
bot.onText(/\/clear/, async (msg) => {
  const { clearHistory } = await import("../agent/memory");
  await clearHistory(`telegram:${msg.from!.id}`);
  userWallets.delete(msg.from!.id);
  pendingSweep.delete(msg.from!.id);
  bot.sendMessage(msg.chat.id, "🗑 Riwayat percakapan dihapus.");
});

// ─── Callback Query (button clicks) ──────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const chatId = query.message!.chat.id;
  const data   = query.data ?? "";

  await bot.answerCallbackQuery(query.id);

  const wallet = userWallets.get(userId);

  // ── Menu actions ────────────────────────────────────────────────────────────
  if (data === "action_scan" || data === "action_clean" ||
      data === "action_scam" || data === "action_portfolio") {

    if (!wallet) {
      const label = data === "action_scan" ? "scan" :
                    data === "action_clean" ? "bersihkan" :
                    data === "action_scam" ? "cek keamanan" : "lihat portfolio";
      bot.sendMessage(chatId,
        `📋 *Masukkan wallet address kamu* untuk ${label}:\n\nContoh:\n\`9wVfWxbW...LB7jv\``,
        { parse_mode: "Markdown" }
      );
      // Store pending action
      userWallets.set(userId, `pending:${data}`);
      return;
    }

    if (data === "action_scan")      await doScan(chatId, userId, wallet);
    if (data === "action_clean")     await doClean(chatId, userId, wallet);
    if (data === "action_scam")      await doScam(chatId, userId, wallet);
    if (data === "action_portfolio") await doPortfolio(chatId, userId, wallet);
    return;
  }

  // ── Sweep confirmation ───────────────────────────────────────────────────────
  if (data === "confirm_sweep") {
    const sweepWallet = pendingSweep.get(userId);
    if (!sweepWallet) {
      bot.sendMessage(chatId, "⚠️ Session expired. Silakan scan ulang wallet kamu.");
      return;
    }
    await bot.sendMessage(chatId, "⏳ Memproses sweep...");
    try {
      const result = JSON.parse(await sweepDust(sweepWallet, "reclaim_only"));
      if (result.status === "pending_signature") {
        bot.sendMessage(chatId,
          `✅ *Transaksi siap!*\n\n` +
          `Akun yang akan ditutup: *${result.accounts_to_close}*\n` +
          `SOL yang akan direcovery: *${result.estimated_sol_recovery} SOL*\n\n` +
          `👆 Tanda tangani transaksi di:\n${result.action_url}`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[
                { text: "✍️ Sign di Arsweep", url: result.action_url },
              ]]
            }
          }
        );
      } else {
        bot.sendMessage(chatId, `ℹ️ ${result.message ?? "Tidak ada akun kosong."}`);
      }
    } catch {
      bot.sendMessage(chatId, "⚠️ Gagal memproses sweep. Coba lagi.");
    }
    pendingSweep.delete(userId);
    return;
  }

  if (data === "cancel_sweep") {
    pendingSweep.delete(userId);
    bot.sendMessage(chatId, "❌ Sweep dibatalkan.");
    return;
  }

  // ── Change wallet ────────────────────────────────────────────────────────────
  if (data === "change_wallet") {
    userWallets.delete(userId);
    bot.sendMessage(chatId,
      "📋 Masukkan wallet address baru:",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // ── Main menu ────────────────────────────────────────────────────────────────
  if (data === "main_menu") {
    const keyboard = {
      inline_keyboard: [
        [
          { text: "🔍 Scan Wallet", callback_data: "action_scan" },
          { text: "🧹 Clean Wallet", callback_data: "action_clean" },
        ],
        [
          { text: "🛡 Cek Scam", callback_data: "action_scam" },
          { text: "📊 Portfolio", callback_data: "action_portfolio" },
        ],
      ],
    };
    bot.sendMessage(chatId, "🏠 *Menu Utama*", { parse_mode: "Markdown", reply_markup: keyboard });
    return;
  }

  if (data === "action_help") {
    bot.sendMessage(chatId,
      `*Panduan Arsy*\n\n` +
      `🔍 *Scan* — Cek semua token & akun kosong di wallet\n` +
      `🧹 *Clean* — Tutup akun kosong & recover SOL\n` +
      `🛡 *Scam Check* — Deteksi token berbahaya\n` +
      `📊 *Portfolio* — Lihat statistik sweep kamu\n\n` +
      `💡 *Tips:*\n` +
      `• Setiap akun kosong = ~0.002 SOL yang bisa direcovery\n` +
      `• Token dengan balance perlu di-swap manual via Jupiter\n` +
      `• Gunakan /clear untuk reset sesi`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "🏠 Menu Utama", callback_data: "main_menu" }
          ]]
        }
      }
    );
  }
});

// ─── Scan Action ──────────────────────────────────────────────────────────────
async function doScan(chatId: number, userId: number, wallet: string) {
  const msg = await bot.sendMessage(chatId, "🔍 Sedang scan wallet...");
  try {
    const raw    = await scanWallet(wallet);
    const data   = JSON.parse(raw);

    if (data.status === "error") {
      bot.editMessageText(`❌ Gagal scan: ${data.message}`, { chat_id: chatId, message_id: msg.message_id });
      return;
    }

    const s = data.summary;
    const tokens: any[] = data.tokens_with_balance ?? [];
    const zeros: any[]  = data.zero_balance_accounts ?? [];

    let text = `📊 *Hasil Scan Wallet*\n\`${shortAddr(wallet)}\`\n\n`;
    text += `💰 SOL: *${s.sol_balance} SOL* (~$${s.sol_balance_usd})\n\n`;

    if (tokens.length > 0) {
      text += `🪙 *Token (${tokens.length}):*\n`;
      for (const t of tokens.slice(0, 8)) {
        const sym = t.symbol && t.symbol !== "UNKNOWN" ? t.symbol : t.mint_short;
        const amt = Number(t.ui_amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
        text += `• ${sym}: ${amt}\n`;
      }
      text += "\n";
    }

    if (zeros.length > 0) {
      text += `🗑 *Akun Kosong: ${zeros.length}*\n`;
      text += `💸 Bisa direcovery: *${s.recoverable_rent_sol} SOL* (~$${s.recoverable_rent_usd})\n`;
    } else {
      text += `✅ Tidak ada akun kosong\n`;
    }

    const buttons: any[][] = [];

    if (zeros.length > 0) {
      buttons.push([{ text: `🧹 Clean ${zeros.length} Akun Kosong`, callback_data: "action_clean" }]);
    }

    if (tokens.length > 0) {
      buttons.push([{ text: "🔄 Swap Token di Arsweep", web_app: { url: "https://arsweep.fun" } }]);
    }

    buttons.push([
      { text: "🛡 Cek Scam", callback_data: "action_scam" },
      { text: "🔄 Scan Ulang", callback_data: "action_scan" },
    ]);
    buttons.push([{ text: "🔁 Ganti Wallet", callback_data: "change_wallet" }]);

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });

  } catch (err) {
    bot.editMessageText("⚠️ Gagal scan wallet.", { chat_id: chatId, message_id: msg.message_id });
  }
}

// ─── Clean Action ─────────────────────────────────────────────────────────────
async function doClean(chatId: number, userId: number, wallet: string) {
  const msg = await bot.sendMessage(chatId, "🔍 Menganalisa wallet...");
  try {
    const raw  = await scanWallet(wallet);
    const data = JSON.parse(raw);
    const s    = data.summary;
    const zeros: any[] = data.zero_balance_accounts ?? [];

    if (zeros.length === 0) {
      bot.editMessageText(
        `✅ *Wallet sudah bersih!*\n\nTidak ada akun kosong yang perlu ditutup.\nSOL Balance: *${s.sol_balance} SOL*`,
        { chat_id: chatId, message_id: msg.message_id, parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[{ text: "🏠 Menu", callback_data: "main_menu" }]] }
        }
      );
      return;
    }

    pendingSweep.set(userId, wallet);

    bot.editMessageText(
      `🧹 *Konfirmasi Sweep*\n\n` +
      `Wallet: \`${shortAddr(wallet)}\`\n\n` +
      `📋 Yang akan dilakukan:\n` +
      `• Tutup *${zeros.length} akun kosong*\n` +
      `• Recover *${s.recoverable_rent_sol} SOL* (~$${s.recoverable_rent_usd})\n\n` +
      `⚠️ Transaksi perlu ditandatangani di Arsweep.`,
      {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Sweep di Arsweep", web_app: { url: `https://arsweep.fun?wallet=${wallet}&action=sweep&twa=1` } },
            ],
            [
              { text: "❌ Batal", callback_data: "cancel_sweep" },
            ],
          ],
        },
      }
    );
  } catch {
    bot.editMessageText("⚠️ Gagal menganalisa wallet.", { chat_id: chatId, message_id: msg.message_id });
  }
}

// ─── Scam Check Action ────────────────────────────────────────────────────────
async function doScam(chatId: number, userId: number, wallet: string) {
  const msg = await bot.sendMessage(chatId, "🛡 Menganalisa keamanan token...\nIni mungkin memakan waktu 10-20 detik.");
  try {
    const { checkScam } = await import("../agent/tools/checkScam");
    const raw  = await checkScam(wallet);
    const data = JSON.parse(raw);

    if (data.status === "error") {
      bot.editMessageText(`❌ Gagal analisa: ${data.message}`, { chat_id: chatId, message_id: msg.message_id });
      return;
    }

    const s          = data.summary ?? {};
    const dangerous  = data.dangerous_tokens  ?? [];
    const suspicious = data.suspicious_tokens ?? [];
    const caution    = data.caution_tokens    ?? [];
    const safe       = data.safe_tokens       ?? [];

    let text = `🛡 *Security Check*\n\`${shortAddr(wallet)}\`\n\n`;
    text += `📊 *${s.total_analyzed ?? 0} token dianalisa*\n`;
    text += `🚨 Berbahaya: ${s.dangerous ?? 0}  `;
    text += `⚠️ Mencurigakan: ${s.suspicious ?? 0}  `;
    text += `✅ Aman: ${s.safe ?? 0}\n`;

    if (dangerous.length > 0) {
      text += `\n━━━━━━━━━━━━━━━━\n`;
      text += `🚨 *BERBAHAYA*\n`;
      for (const t of dangerous) {
        const nm = t.symbol ? `*${t.symbol}*` : `\`${t.mint?.slice(0,8)}...\``;
        text += `\n${nm} (skor: ${t.risk_score}/100)\n`;
        for (const sig of (t.signals ?? []).slice(0, 2)) {
          text += `  ⚠️ ${sig.signal}\n`;
          text += `  _${sig.reason}_\n`;
        }
      }
    }

    if (suspicious.length > 0) {
      text += `\n━━━━━━━━━━━━━━━━\n`;
      text += `⚠️ *MENCURIGAKAN*\n`;
      for (const t of suspicious) {
        const nm = t.symbol ? `*${t.symbol}*` : `\`${t.mint?.slice(0,8)}...\``;
        text += `\n${nm} (skor: ${t.risk_score}/100)\n`;
        for (const sig of (t.signals ?? []).slice(0, 2)) {
          text += `  • ${sig.signal}\n`;
          text += `  _${sig.reason}_\n`;
        }
      }
    }

    if (caution.length > 0) {
      text += `\n━━━━━━━━━━━━━━━━\n`;
      text += `🔶 *PERLU PERHATIAN (${caution.length})*\n`;
      for (const t of caution) {
        const nm = t.symbol || t.mint?.slice(0,8) + "...";
        text += `• ${nm}: ${t.signals?.[0]?.signal ?? ""}\n`;
      }
    }

    if (dangerous.length === 0 && suspicious.length === 0 && caution.length === 0) {
      text += `\n✅ *Semua token terlihat aman!*\nTidak ditemukan tanda-tanda scam atau token berbahaya.`;
    }

    const buttons: any[][] = [];
    if (dangerous.length > 0 || suspicious.length > 0) {
      buttons.push([{ text: "🧹 Bersihkan Token Berbahaya", callback_data: "action_clean" }]);
    }
    buttons.push([
      { text: "🔄 Cek Ulang", callback_data: "action_scam" },
      { text: "🏠 Menu", callback_data: "main_menu" },
    ]);

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (err) {
    console.error("[Scam]", err);
    bot.editMessageText("⚠️ Gagal cek keamanan. Coba lagi.", { chat_id: chatId, message_id: msg.message_id });
  }
}

// ─── Portfolio Action ─────────────────────────────────────────────────────────
async function doPortfolio(chatId: number, userId: number, wallet: string) {
  const msg = await bot.sendMessage(chatId, "📊 Mengambil data portfolio...");
  try {
    const { getPortfolio } = await import("../agent/tools/getPortfolio");
    const raw  = await getPortfolio(wallet);
    const data = JSON.parse(raw);

    let text = `📊 *Portfolio*\n\`${shortAddr(wallet)}\`\n\n`;
    text += `💰 SOL: *${data.sol_balance} SOL*\n\n`;

    if (data.arsweep_stats && !data.arsweep_stats.message) {
      const st = data.arsweep_stats;
      const sweeps  = st.total_sweeps          ?? 0;
      const solRec  = st.total_sol_recovered   ?? "0.0000";
      const tokSwp  = st.total_tokens_swept    ?? 0;
      const accCls  = st.total_accounts_closed ?? 0;
      text += `🧹 *Riwayat Sweep:*\n`;
      text += `• Total sweep: *${sweeps}x*\n`;
      text += `• SOL direcovery: *${solRec} SOL*\n`;
      text += `• Token disweep: *${tokSwp}*\n`;
      text += `• Akun ditutup: *${accCls}*\n\n`;
    } else {
      text += `🧹 Belum ada riwayat sweep\n\n`;
    }

    if (data.leaderboard) {
      text += `🏆 Rank Leaderboard: *#${data.leaderboard.rank}*\n\n`;
    }

    if (data.referral) {
      text += `👥 *Referral:*\n`;
      text += `• Kode: \`${data.referral.code}\`\n`;
      text += `• Total referral: *${data.referral.total_referrals}*\n`;
    }

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧹 Clean Wallet", callback_data: "action_clean" }],
          [{ text: "🏠 Menu", callback_data: "main_menu" }],
        ]
      },
    });
  } catch {
    bot.editMessageText("⚠️ Gagal ambil portfolio.", { chat_id: chatId, message_id: msg.message_id });
  }
}

// ─── Text Messages ────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const userId = msg.from!.id;
  const chatId = msg.chat.id;

  // Check if waiting for wallet address from button press
  const currentWallet = userWallets.get(userId) ?? "";
  if (currentWallet.startsWith("pending:")) {
    const pendingAction = currentWallet.replace("pending:", "");
    const walletMatch = msg.text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (!walletMatch) {
      bot.sendMessage(chatId, "❌ Format wallet address tidak valid. Coba lagi.");
      return;
    }
    const newWallet = walletMatch[0];
    userWallets.set(userId, newWallet);
    bot.sendMessage(chatId, `✅ Wallet disimpan: \`${shortAddr(newWallet)}\``, { parse_mode: "Markdown" });

    if (pendingAction === "action_scan")      await doScan(chatId, userId, newWallet);
    if (pendingAction === "action_clean")     await doClean(chatId, userId, newWallet);
    if (pendingAction === "action_scam")      await doScam(chatId, userId, newWallet);
    if (pendingAction === "action_portfolio") await doPortfolio(chatId, userId, newWallet);
    return;
  }

  // Auto-detect wallet address in message
  const walletMatch = msg.text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (walletMatch?.[0] && !currentWallet) {
    userWallets.set(userId, walletMatch[0]);
  }

  bot.sendChatAction(chatId, "typing");

  try {
    const result = await handleMessage({
      platform: "telegram",
      userId: String(userId),
      message: msg.text,
      walletAddress: userWallets.get(userId),
    });

    const text = cleanText(result.text) || "Ada yang bisa saya bantu?";

    // After AI response, show quick action buttons
    const keyboard = {
      inline_keyboard: [
        [
          { text: "🔍 Scan", callback_data: "action_scan" },
          { text: "🧹 Clean", callback_data: "action_clean" },
          { text: "🛡 Scam", callback_data: "action_scam" },
        ],
        [{ text: "🏠 Menu Utama", callback_data: "main_menu" }],
      ],
    };

    await bot.sendMessage(chatId, text, { reply_markup: keyboard });
  } catch (err) {
    console.error("[Telegram]", err);
    bot.sendMessage(chatId, "⚠️ Terjadi kesalahan. Coba lagi.");
  }
});

export default bot;
console.log("[Telegram] Bot polling started...");
