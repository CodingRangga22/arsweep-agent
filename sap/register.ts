/**
 * Register "Arsweep Hygiene Agent" on Synapse SAP.
 * Uses only public package exports (no deep /core paths).
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { createSapClient } from "@oobe-protocol-labs/synapse-sap-sdk";
import { getAgentPDA, getAgentStatsPDA, getGlobalPDA } from "@oobe-protocol-labs/synapse-sap-sdk/pdas";
import { TokenType, SettlementMode } from "@oobe-protocol-labs/synapse-sap-sdk/types";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = process.env.SAP_MANIFEST_PATH ?? path.join(__dirname, "agent.manifest.json");

type ManifestCapability = {
  id: string;
  protocolId: string;
  version: string;
  description: string | null;
};

type ManifestPricing = {
  tierId: string;
  pricePerCall: number;
  rateLimit: number;
  tokenType: string;
  settlementMode: string;
};

type ArsweepSapManifest = {
  name: string;
  description: string;
  slug?: string;
  x402Endpoint: string;
  apiBaseUrl?: string;
  protocols: string[];
  capabilities: ManifestCapability[];
  pricing: ManifestPricing[];
};

function loadManifest(): ArsweepSapManifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as ArsweepSapManifest;
}

function resolveRpcUrl(): string {
  const direct = process.env.SAP_RPC_URL?.trim();
  if (direct) return direct;

  const helius =
    process.env.HELIUS_RPC_URL?.trim() ||
    process.env.VITE_HELIUS_RPC_URL?.trim();
  if (helius) return helius;

  const oobeKey = process.env.OOBE_RPC_API_KEY?.trim();
  if (oobeKey) {
    return `https://us-1-mainnet.oobeprotocol.ai/rpc?api_key=${encodeURIComponent(oobeKey)}`;
  }

  return "https://api.mainnet-beta.solana.com";
}

function loadKeypair(): Keypair {
  const keypairPath = process.env.SAP_AGENT_KEYPAIR_PATH?.trim();
  if (!keypairPath) {
    throw new Error("Set SAP_AGENT_KEYPAIR_PATH (e.g. sap/keys/arsweep-agent.json).");
  }
  const resolved = path.isAbsolute(keypairPath) ? keypairPath : path.join(process.cwd(), keypairPath);
  const secret = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function anchorWallet(keypair: Keypair) {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: { partialSign: (kp: Keypair) => void }) => {
      tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async (txs: Array<{ partialSign: (kp: Keypair) => void }>) => {
      for (const tx of txs) tx.partialSign(keypair);
      return txs;
    },
  };
}

function mapTokenType(t: string) {
  if (t === "usdc") return TokenType.Usdc;
  if (t === "spl") return TokenType.Spl;
  return TokenType.Sol;
}

function mapSettlementMode(m: string) {
  switch (m) {
    case "instant":
      return SettlementMode.Instant;
    case "escrow":
      return SettlementMode.Escrow;
    case "batched":
      return SettlementMode.Batched;
    default:
      return SettlementMode.X402;
  }
}

/** Short on-chain text — full details live in agent.manifest.json (agent URI). */
const ONCHAIN_DESCRIPTION =
  "Arsweep: Solana wallet dust sweeper & AI analyst. Full manifest at agent URI.";

/** Core capability IDs for compact register (fits Solana 1232-byte tx limit). */
const CORE_CAPABILITY_IDS = [
  "wallet:scan_dust",
  "spl:close_empty",
  "jupiter:swap_dust",
  "ai:wallet_analyze",
  "ai:rugcheck",
  "x402:micropay",
] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.env.SAP_REGISTER_DRY_RUN === "true";
  const minimal = process.argv.includes("--minimal") || process.env.SAP_REGISTER_MINIMAL === "true";
  const full = process.argv.includes("--full") || process.env.SAP_REGISTER_FULL === "true";
  const manifest = loadManifest();
  const rpcUrl = resolveRpcUrl();
  const keypair = loadKeypair();

  console.log("\n── Arsweep → Synapse SAP registration ──\n");
  console.log("Manifest:", MANIFEST_PATH);
  console.log("Agent wallet:", keypair.publicKey.toBase58());
  console.log("RPC:", rpcUrl.replace(/api_key=[^&]+/, "api_key=***"));
  console.log("Capabilities:", manifest.capabilities.map((c) => c.id).join(", "));
  console.log("Dry run:", dryRun);
  console.log("Minimal:", minimal);
  console.log("Full payload:", full);

  const connection = new Connection(rpcUrl, "confirmed");
  const balanceLamports = await connection.getBalance(keypair.publicKey);
  const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
  console.log("Balance:", balanceSol.toFixed(4), "SOL");

  const minLamports = Math.floor(0.02 * LAMPORTS_PER_SOL);
  if (!dryRun && balanceLamports < minLamports) {
    throw new Error(
      `Agent wallet has insufficient SOL (${balanceSol.toFixed(4)}). ` +
        `Send at least 0.05 SOL to ${keypair.publicKey.toBase58()} on mainnet, then retry.`,
    );
  }

  if (dryRun) {
    console.log("\n[DRY RUN] No transaction sent.");
    if (balanceLamports < minLamports) {
      console.log(`Need ≥0.05 SOL on ${keypair.publicKey.toBase58()}`);
    }
    console.log("Then: npm run sap:register\n");
    return;
  }

  const client = createSapClient(rpcUrl, anchorWallet(keypair));
  const [agentPda] = getAgentPDA(keypair.publicKey);
  const [agentStatsPda] = getAgentStatsPDA(agentPda);
  const [globalPda] = getGlobalPDA();

  // Solana legacy tx max ~1232 bytes — pricing tiers blow the limit; use compact register by default.
  const protocols = full
    ? manifest.protocols.slice(0, 5)
    : ["arsweep", "jupiter", "x402"];

  let capSource: ManifestCapability[];
  if (minimal) {
    capSource = manifest.capabilities.slice(0, 3);
  } else if (full) {
    capSource = manifest.capabilities.slice(0, 10);
  } else {
    const byId = new Map(manifest.capabilities.map((c) => [c.id, c]));
    capSource = CORE_CAPABILITY_IDS.map((id) => byId.get(id)).filter(
      (c): c is ManifestCapability => c != null,
    );
  }

  const capabilities = capSource.map((c) => ({
    id: c.id,
    description: null,
    protocolId: c.protocolId,
    version: c.version,
  }));

  const pricingSource = full && !minimal ? manifest.pricing.slice(0, 5) : [];
  const pricing = pricingSource.map((t) => ({
    tierId: t.tierId,
    pricePerCall: new BN(t.pricePerCall),
    minPricePerCall: null,
    maxPricePerCall: null,
    rateLimit: t.rateLimit,
    maxCallsPerSession: 0,
    burstLimit: null,
    tokenType: mapTokenType(t.tokenType),
    tokenMint: null,
    tokenDecimals: t.tokenType === "usdc" ? 6 : null,
    settlementMode: mapSettlementMode(t.settlementMode),
    minEscrowDeposit: null,
    batchIntervalSec: null,
    volumeCurve: null,
  }));

  const agentId = manifest.slug ? `did:arsweep:${manifest.slug}`.slice(0, 128) : null;
  const agentUri = `${manifest.apiBaseUrl ?? "https://api.arsweep.fun/v1"}/sap/manifest`.slice(0, 256);
  const description = full ? manifest.description.slice(0, 256) : ONCHAIN_DESCRIPTION;
  const x402Endpoint = manifest.x402Endpoint.slice(0, 256);

  const txSignature = await client.methods
    .registerAgent(
      manifest.name.slice(0, 64),
      description,
      capabilities,
      pricing,
      protocols,
      agentId,
      agentUri,
      x402Endpoint,
    )
    .accounts({
      wallet: keypair.publicKey,
      agent: agentPda,
      agentStats: agentStatsPda,
      globalRegistry: globalPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\n✅ Registered on Synapse SAP");
  console.log("Transaction:", txSignature);
  console.log("Agent PDA:", agentPda.toBase58());
  console.log("On-chain capabilities:", capabilities.map((c) => c.id).join(", "));
  if (!full) {
    console.log("(Pricing omitted on-chain — x402 uses /.well-known/x402.json; full manifest at agent URI)");
  }
  console.log("\nVerify: https://explorer.oobeprotocol.ai/\n");
}

main().catch((err) => {
  console.error("\n❌ SAP registration failed:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
