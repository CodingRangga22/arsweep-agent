"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callWithX402Payment = callWithX402Payment;
const fetch_1 = require("@x402/fetch");
const client_1 = require("@x402/svm/exact/client");
const kit_1 = require("@solana/kit");
const base_1 = require("@scure/base");
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
function requireEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing required env var: ${name}`);
    return v;
}
/**
 * Backend payment agent:
 * - Uses SVM private key stored in server env (NOT in frontend)
 * - Pays via x402 and calls a protected endpoint
 */
async function callWithX402Payment(url, init) {
    const svmPrivateKey = requireEnv("SVM_PRIVATE_KEY"); // base58 private key bytes (PayAI docs)
    const signer = await (0, kit_1.createKeyPairSignerFromBytes)(base_1.base58.decode(svmPrivateKey));
    const client = new fetch_1.x402Client();
    (0, client_1.registerExactSvmScheme)(client, { signer, networks: [SOLANA_MAINNET_CAIP2] });
    const fetchWithPayment = (0, fetch_1.wrapFetchWithPayment)(fetch, client);
    return fetchWithPayment(url, init);
}
