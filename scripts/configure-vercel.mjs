import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const cli=process.argv[2];if(!cli)throw new Error('Pass the official Vercel CLI entrypoint path.');
const wallets=JSON.parse(await readFile(new URL('../.local/wallets.json',import.meta.url),'utf8'));
let config;
const configFile=new URL('../.local/hosting-secrets.json',import.meta.url);
try{config=JSON.parse(await readFile(configFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;config={sessionSecret:randomBytes(32).toString('base64url'),accessCode:randomBytes(16).toString('hex')};await writeFile(configFile,JSON.stringify(config),{mode:0o600,flag:'wx'});}
const entries={BUYER_MNEMONIC:wallets.buyer.mnemonic,SELLER_ADDRESS:wallets.seller.address,DEMO_SESSION_SECRET:config.sessionSecret,DEMO_ACCESS_CODE:config.accessCode,DEMO_SPEND_CAP_LOVELACE:'500000000'};
for(const [key,value]of Object.entries(entries)){
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,'env','add',key,'production','--sensitive','--yes'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    // Intentionally do not forward CLI output: secrets travel only on stdin.
    child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Could not set ${key}; inspect environment variable names in Vercel.`)));child.stdin.end(value);
  });
  console.log(`${key}: configured`);
}
await writeFile(new URL('../.local/demo-access.txt',import.meta.url),`Blindbench real-payment access code\n\n${config.accessCode}\n\nEnter in Test wallet (analytics). Grants two-hour access to testnet purchases only.\nKeep this code separate from the public demo link.\n`,{mode:0o600});
console.log('Access code saved to .local/demo-access.txt. Signing keys remain secret.');
