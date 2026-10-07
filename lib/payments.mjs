import { readFile } from 'node:fs/promises';
import { toClientCardanoSigner, toFacilitatorCardanoSigner, decodeCardanoTransaction } from '@x402/cardano';
import { ExactCardanoScheme as ClientScheme } from '@x402/cardano/exact/client';
import { ExactCardanoScheme as FacilitatorScheme } from '@x402/cardano/exact/facilitator';
import { x402Client } from '@x402/core/client';
import { NETWORK } from './catalog.mjs';

export async function createPayments() {
  let wallets;
  if (process.env.BUYER_MNEMONIC && process.env.SELLER_ADDRESS) {
    const signer = toClientCardanoSigner({ mnemonic: process.env.BUYER_MNEMONIC, network: NETWORK, provider: { koios: { baseUrl: 'https://preprod.koios.rest/api/v1' } } });
    wallets = { network: NETWORK, buyer: { mnemonic: process.env.BUYER_MNEMONIC, address: signer.getAddress() }, seller: { address: process.env.SELLER_ADDRESS } };
    if (!wallets.seller.address.startsWith('addr_test1')) throw new Error('Only a testnet recipient is allowed.');
  }
  try { if (!wallets && !process.env.VERCEL) wallets = JSON.parse(await readFile(new URL('../.local/wallets.json', import.meta.url), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (wallets && wallets.network !== NETWORK) throw new Error('Only Cardano preprod wallets are permitted.');
  const baseUrl = 'https://preprod.koios.rest/api/v1';
  const provider = process.env.BLOCKFROST_PROJECT_ID ? {
    blockfrost: { baseUrl: 'https://cardano-preprod.blockfrost.io/api/v0', projectId: process.env.BLOCKFROST_PROJECT_ID }, requestTimeoutMs: 120000,
  } : { koios: { baseUrl }, requestTimeoutMs: 120000 };
  const facilitator = new FacilitatorScheme(toFacilitatorCardanoSigner({ network: NETWORK, provider, awaitConfirmation: true }), { confirmationTimeoutMs: 120000 });
  async function readiness() {
    if (!wallets) return { ready: false, reason: 'Create the dedicated wallet with npm run wallet.', network: NETWORK };
    const basic = { network: NETWORK, buyerAddress: wallets.buyer.address, sellerAddress: wallets.seller.address, provider: process.env.BLOCKFROST_PROJECT_ID ? 'Blockfrost preprod' : 'Public Koios preprod' };
    try {
      const response = await fetch(`${baseUrl}/address_info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _addresses: [wallets.buyer.address] }), signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Provider unavailable');
      const rows = await response.json();
      const balance = Number(rows[0]?.balance ?? 0);
      return { ...basic, balance, ready: balance >= 2200000, reason: balance < 2200000 ? 'Fund the buyer wallet with free preprod test ADA, then refresh.' : null };
    } catch { return { ...basic, ready: false, reason: 'Cannot reach the preprod provider. Check the connection and refresh.' }; }
  }
  function requirements(job) {
    if (!wallets) throw new Error('Wallet not configured.');
    return { scheme: 'exact', network: NETWORK, asset: 'lovelace', amount: String(job.total), payTo: wallets.seller.address, maxTimeoutSeconds: 600,
      extra: { assetTransferMethod: 'default', confirmationPolicy: { l1Confirmations: 0 }, areFeesSponsored: false } };
  }
  async function sign(paymentRequired, job) {
    const req = paymentRequired.accepts?.[0];
    if (paymentRequired.accepts?.length !== 1 || JSON.stringify(req) !== JSON.stringify(requirements(job))) throw new Error('Payment requirements changed; refusing to sign.');
    if (job.total > job.budget) throw new Error('Payment exceeds buyer budget.');
    const signer = toClientCardanoSigner({ mnemonic: wallets.buyer.mnemonic, network: NETWORK, provider });
    const client = new x402Client().setSpendControls({ allowedAssets: [{ network: NETWORK, asset: 'lovelace', maxAmountPerPayment: String(job.total) }] });
    client.register(NETWORK, new ClientScheme(signer));
    const payload = await client.createPaymentPayload(paymentRequired);
    const decoded = decodeCardanoTransaction(payload.payload.transaction);
    if (decoded.fee > 1000000n) throw new Error('Network fee exceeds the 1 test ADA safety cap. Transaction was not broadcast.');
    return { payload, transaction: decoded.txHash, networkFee: Number(decoded.fee) };
  }
  return { readiness, requirements, sign, verify: (p,r) => facilitator.verify(p,r), settle: (p,r) => facilitator.settle(p,r) };
}
