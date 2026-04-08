import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

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

  // Match the @x402/fetch docs: register a Solana exact scheme for all Solana CAIP-2 networks.
  // This ensures the client can select the right scheme from PAYMENT-REQUIRED.accepts.
  const client = new x402Client().register("solana:*" as any, new ExactSvmScheme(signer as any) as any);

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  return fetchWithPayment(url, init);
}

