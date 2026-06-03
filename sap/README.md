# Arsweep Hygiene Agent — Synapse SAP

On-chain identity for [Synapse Agent Protocol (SAP)](https://explorer.oobeprotocol.ai/docs) on Solana (OOBE Protocol).

## Manifest

`agent.manifest.json` declares:

| Capability | Implementation |
|------------|----------------|
| `wallet:scan_dust` | Frontend `tokenAccounts` + Helius DAS |
| `spl:close_empty` | `executeSweepNative` (user-signed) |
| `jupiter:swap_dust` | Jupiter swap v1 |
| `ai:wallet_analyze` | `POST /v1/x402/analyze` |
| `ai:rugcheck` | `POST /v1/x402/rugcheck` + Syra |
| `x402:micropay` | Pay AI + `/.well-known/x402.json` |

## Prerequisites

1. **Agent wallet** — dedicated keypair (not your treasury). Fund with ~0.05 SOL on mainnet.
2. **RPC** — Helius, or [OOBE RPC](https://explorer.oobeprotocol.ai/docs) with `OOBE_RPC_API_KEY`.
3. **Dependencies** — from repo root: `npm install`

## Setup

```bash
# 1. Generate keypair (do not commit)
mkdir -p sap/keys
solana-keygen new -o sap/keys/arsweep-agent.json --no-bip39-passphrase

# 2. Env (add to .env)
SAP_AGENT_KEYPAIR_PATH=sap/keys/arsweep-agent.json
SAP_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
# or: OOBE_RPC_API_KEY=sk_...

# 3. Dry run
npm run sap:register:dry

# 4. Register on-chain
npm run sap:register
```

## CLI alternative (no code)

```bash
npx @oobe-protocol-labs/synapse-sap-cli env init --template mainnet
npx synapse-sap config set rpcUrl "https://us-1-mainnet.oobeprotocol.ai/rpc?api_key=YOUR_KEY"
npx synapse-sap agent register --manifest sap/agent.manifest.json --simulate
npx synapse-sap agent register --manifest sap/agent.manifest.json
```

## Register modes

| Command | What goes on-chain |
|---------|-------------------|
| `npm run sap:register` | **Compact** (default): 6 core capabilities, no pricing tiers — fits 1232-byte tx limit |
| `npm run sap:register:minimal` | 3 capabilities only |
| `npm run sap:register -- --full` | All capabilities + pricing (may fail with "Transaction too large") |

Full capability list and x402 prices remain in `agent.manifest.json` and `GET /v1/sap/manifest`.

## Troubleshooting

- `ERR_PACKAGE_PATH_NOT_EXPORTED` — use `npm run sap:register` from this repo (script uses public SDK exports only).
- `Transaction too large` — use default `sap:register` (not `--full`); pricing is off-chain via x402 discovery.
- `Insufficient funds` — send ~0.05 SOL to the agent wallet pubkey.
- `already in use` — agent PDA exists; use the same wallet or run an update flow via OOBE CLI.

## After registration

- Explorer: https://explorer.oobeprotocol.ai/
- Discovery: `synapse-sap discovery scan --protocol arsweep`
- x402 discovery: https://api.arsweep.fun/.well-known/x402.json

## Program IDs (reference)

| Resource | Address |
|----------|---------|
| SAP Program | `SAPpUhsWLJG1FfkGRcXagEDMrMsWGjbky7AyhGpFETZ` |
| Global Registry | `9odFrYBBZq6UQC6aGyzMPNXWJQn55kMtfigzhLg6S6L5` |
