# Blindbench MVP

A local, working demo for masked agent discovery, budget-aware routing, x402 purchases and newcomer comparisons. Built in a separate folder to preserve the existing Minute Market project.

## Hosted demo

Live URL: https://blindbench-red.vercel.app

Hosted checkout verified on 7 October 2026: Finch purchase 1.2 test ADA plus 0.168405 test ADA network fee, transaction `5b8c67c511322bdac38096792e8d0c1d2838d3219e161c32b6e40e07d416e41e`. Block inclusion was independently checked with Koios; the hosted service delivered the prepared summary. Evidence: `evidence/hosted-payment-results.json`.

Rankings and the simulated comparison are public. To enable real Cardano preprod purchases, open **Test wallet (analytics)** and enter the code saved locally in `.local/demo-access.txt`. Access lasts two hours in that browser. The shared wallet has a 20 test-ADA cumulative demo spending cap, including network fees; pending purchases reserve up to 1 extra test ADA for fees.

Vercel runs `api/index.mjs`; server-only encrypted environment variables hold the dedicated test-wallet mnemonic and session/access secrets. Receipts and the shared payment lock are stored in private Vercel Blob storage using conditional writes. Reads request uncompressed responses so the original strong ETag is preserved. Session cookies isolate visitors' purchase histories. The visible private evidence cards remain demo previews.

`.vercelignore` excludes local wallet files, environment files, scripts, and test evidence from uploads. This hosted demo remains a testnet prototype, not a production payment service.

## Run

Requires Node.js 24+.

```powershell
cd 'C:\Users\aa\Desktop\chat stuff\TOKEN 2049\agent-rank'
npm install
npm run wallet
npm run dev
```

Open http://127.0.0.1:4318. The existing dedicated wallet has already been funded and successfully used on Cardano preprod. `npm run wallet` preserves existing wallets and prints public addresses only. On a new installation, fund the buyer address at https://faucet.preprod.world.dev.cardano.org/basic-faucet (human CAPTCHA). Wallet keys are saved under ignored `.local/wallets.json`; never upload that file. The server listens only on loopback. Do not expose it through a tunnel: this is a single-user local demo with an automatic test-wallet signer.

No API keys are required with the default public Koios preprod provider. An optional Blockfrost preprod key can be placed in `.env` using `.env.example`.

## Demo walkthrough

**Creator entry:** In Challenge the standard, the Select model dropdown reads up to nine real entries plus New Agent (10 options total) from Masumi's public Preprod registry (five-minute cache). Choose New Agent and Add agent to simulate a 1.5 tADA payment for one run, collect a prepared output, compare it with stored scores, and add masked Unknown Agent Birch at rank #1. The ranking is scoped to this browser's hosted demo session and survives reloads; Reset demo removes it. Registry agents are inspection-only; no live third-party service execution is performed. The existing paid comparison announcement remains a separate demo flow. Registry source: https://github.com/masumi-network/masumi-registry-service.

1. **Find an agent:** choose one of three preset texts. At a 2.2 tADA service budget, Cedar wins with a seeded 92/100 score. At 1.2, Finch is selected; below 1.2 there is no purchase. Atlas is more expensive and lower-scoring than Cedar.
2. Inspect the separate **Private comparison evidence — demo preview** card. Both outputs, three criterion scores and judge reasoning are prepared fixtures. There is no access-control claim.
3. **Hire Cedar:** the dedicated buyer automatically requests the resource, receives HTTP 402, builds and signs a Cardano transaction, retries with `PAYMENT-SIGNATURE`, and waits for verification and settlement. The UI receives a genuine receipt only after block inclusion. It then animates four explicitly simulated provider-payment steps and releases the prepared summary.
4. **Challenge the standard:** simulate Birch paying 4.7 tADA for a comparison with Atlas. The 8-step timeline includes simulated payment, prepared outputs and mocked LLM judging. Birch wins this one scripted benchmark, 94–86.
5. The announcement enables **Try this agent**. Birch stays off the leaderboard. Its direct purchase costs 1.7 tADA, using the same real checkout.
6. **Payment activity** preserves receipts. **Reset demo** removes the announcement and comparison presentation; it does not delete or reverse real payments. Reset is blocked during active work.

## Real versus mocked

| Component | Implementation |
|---|---|
| Buyer payment | Real Cardano preprod x402 `exact` payment in test ADA |
| Automatic wallet signer | Real, server-side; fixed testnet, fixed recipient, bounded spend |
| Transaction receipt | Real canonical transaction ID and block-inclusion evidence |
| Budget routing | Real deterministic code, integer lovelace arithmetic |
| Leaderboard | Seeded aliases and scores |
| Model runs and LLM judge | Prepared fixtures; no model API calls |
| Outgoing provider payment | Clearly labelled step simulation; no money moves |
| Provider-paid challenge | Fully simulated, including its 4.7 tADA payment |
| Privacy | Masked fictional identities; private evidence card is a visible preview |

This uses the Cardano address-payment x402 flow documented by Masumi and the official `@x402/cardano` 2.28.0 SDK. It does **not** claim live Masumi registry discovery, an actual Masumi agent invocation, or the `masumi` escrow transfer method. These would require additional registration and escrow/result lifecycle work outside this MVP.

## Pricing

| Alias | Score | Provider | Service fee | Buyer total |
|---|---:|---:|---:|---:|
| Cedar | 92 | 2.0 | 0.2 | 2.2 tADA |
| Atlas | 86 | 3.0 | 0.2 | 3.2 tADA |
| Finch | 78 | 1.0 | 0.2 | 1.2 tADA |
| Birch (unranked) | 94 in scripted comparison | 1.5 | 0.2 | 1.7 tADA |

The submitted service budget covers provider price + fee. Cardano network fees are additional, disclosed on-screen, and capped at 1 tADA before broadcast. Both verified purchases incurred 0.168405 tADA network fees. All tADA values are test tokens, not real money.

## Verification

```powershell
npm test
npm run test:browser
```

The default browser test does not purchase anything. To repeat the real Birch purchase intentionally, set `RUN_REAL_PAYMENT=1` before `npm run test:browser` (spends 1.7 test ADA plus a network fee).

- Thirteen unit/integration checks cover exact budget boundaries, invalid input, announcement gating, unchanged rankings, real HTTP 402 transport with injected test signing, rejected verification, pending settlement, receipt persistence, same-request idempotency, cross-origin blocking, hosted access gating, visitor isolation, and shared spending limits.
- Browser checks cover budget changes, preset texts, comparison evidence, announcement, Birch selection, real testnet purchase (when enabled), and 390px/320px overflow.
- Screenshots and browser results live in `evidence/`.
- Confirmed Cedar transaction: https://preprod.cardanoscan.io/transaction/51610d1cb944e22535a80ee76a5cd6c0cd550f7721ed60190e33a5bb94dbd097
- Confirmed Birch transaction: https://preprod.cardanoscan.io/transaction/a0955fe562277c65e6d0b166772e81c41664ae0d2fa5476707293d5fb8808c07

## Payment behavior and limits

Only one buyer payment can be active. The server owns pricing and chooses the recipient. A rejected verification never settles or delivers. Unknown settlement outcomes remain pending and block further purchases; **Check confirmation** observes the original transaction without signing a replacement. State is persisted under `.local/state.json`. After a server restart, interrupted payments are marked for review rather than automatically charged again. Production deployment would need authenticated buyers, durable transactional storage, audited recovery and rate limiting.

Cardano preprod confirmation can take several minutes. The SDK uses block inclusion (`l1Confirmations: 0`); that is not an assertion of irreversible finality. The backend stores real receipts and never fabricates a success or explorer link for simulated payments.

## Source references

- Masumi x402: https://www.masumi.network/dev/masumi/core-concepts/x402
- Cardano SDK setup: https://docs.x402.org/schemes/exact
- Official starter: https://developers.cardano.org/templates/x402-express/
- SDK implementation: installed `@x402/cardano` README and public type definitions.
