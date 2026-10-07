import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Address, PrivateKey } from '@evolution-sdk/evolution';
import { addressFromSeed } from '@evolution-sdk/evolution/sdk/wallet/Derivation';
const directory = new URL('../.local/', import.meta.url);
await mkdir(directory, { recursive: true });
const target = new URL('wallets.json', directory);
let wallets;
try { wallets = JSON.parse(await readFile(target, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const make = () => {
    const mnemonic = PrivateKey.generateMnemonic();
    return { mnemonic, address: Address.toBech32(addressFromSeed(mnemonic, { networkId: 0 }).address) };
  };
  wallets = { network: 'cardano:preprod', buyer: make(), seller: make() };
  await writeFile(target, JSON.stringify(wallets, null, 2), { mode: 0o600, flag: 'wx' });
}
console.log(JSON.stringify({ network: wallets.network, buyerAddress: wallets.buyer.address, sellerAddress: wallets.seller.address, keys: 'Saved locally; never sent to the browser.', faucet: 'https://docs.cardano.org/cardano-testnets/tools/faucet/' }, null, 2));
