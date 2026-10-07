import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const dir=new URL('../evidence/',import.meta.url);await mkdir(dir,{recursive:true});
try {
  await page.goto('http://127.0.0.1:4318');
  await page.getByRole('heading',{name:'Let the work speak.'}).waitFor();
  // Wait for the wallet refresh before editing controls.
  await page.waitForFunction(()=>document.querySelector('.wallet-button')?.textContent.includes('tADA'));
  await page.getByRole('button',{name:'1.0 · Too low',exact:true}).click();
  await page.getByText('No agent within budget',{exact:true}).waitFor();
  assert.equal(await page.locator('#purchase').count(),0);
  await page.getByRole('button',{name:'1.2 · Economy',exact:true}).click();
  await page.getByRole('button',{name:/Hire Finch/}).waitFor();
  await page.getByRole('button',{name:'2.2 · Best fit',exact:true}).click();
  await page.getByRole('button',{name:/Hire Cedar/}).waitFor();
  await page.getByLabel('Choose a sample text').selectOption('research');
  assert.ok((await page.locator('#source').textContent()).includes('240 students'));
  await page.getByLabel('Choose a sample text').selectOption('launch');
  await page.screenshot({path:fileURLToPath(new URL('buyer-desktop.png',dir)),fullPage:true});
  await page.getByRole('button',{name:'Challenge the standard',exact:false}).click();
  await page.getByRole('button',{name:'Simulate payment & compare',exact:false}).click();
  await page.getByRole('heading',{name:'Unknown Agent Birch outperformed Agent Atlas.'}).waitFor({timeout:20000});
  await page.getByText('Private comparison evidence — demo preview',{exact:false}).waitFor();
  assert.equal(await page.locator('.timeline .pill').filter({hasText:'REAL TESTNET'}).count(),0);
  await page.screenshot({path:fileURLToPath(new URL('challenge-desktop.png',dir)),fullPage:true});
  await page.getByRole('button',{name:/Try this agent/}).click();
  await page.getByRole('button',{name:/Hire Birch/}).waitFor();
  assert.equal(await page.locator('#budget').inputValue(),'1.7');
  assert.equal(await page.locator('.rank-row').count(),3);
  if(process.env.RUN_REAL_PAYMENT==='1') {
    await page.getByRole('button',{name:/Hire Birch/}).click();
    await page.getByText('Real testnet receipt',{exact:true}).waitFor({timeout:240000});
    await page.getByText('YOUR SUMMARY · PREPARED DEMO OUTPUT',{exact:true}).waitFor({timeout:10000});
    assert.equal(await page.locator('.timeline .pill').filter({hasText:'SIMULATED'}).count(),5);
    await page.screenshot({path:fileURLToPath(new URL('birch-real-purchase.png',dir)),fullPage:true});
  }
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}px buyer overflow`);
    await page.screenshot({path:fileURLToPath(new URL(`buyer-${width}.png`,dir)),fullPage:true});
    await page.getByRole('button',{name:'Challenge the standard',exact:false}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}px comparison overflow`);
    await page.getByRole('button',{name:'Find an agent',exact:false}).click();
  }
  assert.deepEqual(errors,[]);
  await writeFile(new URL('browser-results.json',dir),JSON.stringify({passed:true,realBirchPayment:process.env.RUN_REAL_PAYMENT==='1',checks:['budget boundaries','preset text changes','simulated comparison steps','private evidence card','unchanged seeded leaderboard','direct Birch selection','390px and 320px layouts','no browser errors'],errors},null,2));
  console.log('Browser checks passed.');
} finally {await browser.close();}

