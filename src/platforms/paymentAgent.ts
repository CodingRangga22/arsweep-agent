import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Backend payment agent:
 * - Uses SVM private key stored in server env (NOT in frontend)
 * - Pays via x402 and calls a protected endpoint
 */
export async function callWithX402Payment(url: string, init?: RequestInit): Promise<Response> {
  const svmPrivateKey = requireEnv("SVM_PRIVATE_KEY"); // base58 private key bytes (PayAI docs)
  const signer = await createKeyPairSignerFromBytes(base58.decode(svmPrivateKey));

  const client = new x402Client();
  registerExactSvmScheme(client, { signer, networks: [SOLANA_MAINNET_CAIP2] as any });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  return fetchWithPayment(url, init);
}

