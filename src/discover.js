/** Open the Direct inbox for Lojas Belmont and capture the conversation +
 * status subscriptions (where "Negociando" lives). */
import fs from 'node:fs';
import path from 'node:path';
import { config, DISCOVERY_DIR, ensureDirs } from './config.js';
import { chromium } from 'playwright';

function decodeTarget(post) {
  try {
    const m = decodeURIComponent(post).match(/req0___data__=(\{.*\})/s);
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

async function login(page) {
  await page.goto('https://direct.neoron.io/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  if (await email.isVisible().catch(() => false)) {
    await email.fill(config.email);
    const pass = page.locator('input[type="password"]').first();
    await pass.fill(config.password);
    await page.getByRole('button', { name: /entrar|login|acessar|continuar|sign in/i }).first().click({ timeout: 6000 })
      .catch(() => pass.press('Enter'));
    await page.waitForTimeout(5000);
  }
}

async function main() {
  ensureDirs();
  const subs = [];
  const bodies = [];
  let fi = 0;
  const browser = await chromium.launch({ headless: config.headless });
  const page = await (await browser.newContext()).newPage();

  page.on('response', async (resp) => {
    const url = resp.url();
    if (!url.includes('firestore.googleapis.com')) return;
    const post = resp.request().postData();
    if (post && post.includes('addTarget')) {
      const t = decodeTarget(post);
      const sq = t?.addTarget?.query?.structuredQuery;
      if (sq) subs.push({
        from: sq.from?.map((f) => f.collectionId).join(','),
        parent: t.addTarget.query.parent?.split('/documents')[1] || '(root)',
        where: JSON.stringify(sq.where), orderBy: JSON.stringify(sq.orderBy), limit: sq.limit,
      });
    }
    const text = await resp.text().catch(() => '');
    if (text && text.length > 2) {
      const f = path.join(DISCOVERY_DIR, `inbox_fs_${String(fi++).padStart(3, '0')}.txt`);
      fs.writeFileSync(f, text);
      if (/negocia|status/i.test(text)) bodies.push(path.basename(f));
    }
  });

  await login(page);
  console.log('home:', page.url());

  // Click the Lojas Belmont chatbot card to open the inbox.
  const card = page.getByText(/lojas belmont/i).first();
  await card.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(6000);
  console.log('inbox url:', page.url());
  await page.screenshot({ path: path.join(DISCOVERY_DIR, 'inbox.png'), fullPage: true }).catch(() => {});

  // Capture the visible text to see status labels / filters.
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '').catch(() => '');
  fs.writeFileSync(path.join(DISCOVERY_DIR, 'inbox_text.txt'), text);

  // Try to open a status filter and pick Negociando.
  for (const label of [/negociando/i, /status/i, /filtro/i, /etapa/i, /funil/i]) {
    const el = page.getByText(label).first();
    if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await page.waitForTimeout(3000); }
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(DISCOVERY_DIR, 'inbox_filtered.png'), fullPage: true }).catch(() => {});

  fs.writeFileSync(path.join(DISCOVERY_DIR, '_inbox_subs.json'), JSON.stringify(subs, null, 2));
  console.log('\n=== INBOX SUBSCRIPTIONS ===');
  for (const s of subs) console.log(` from=${s.from} parent=${s.parent} where=${s.where?.slice(0,240)} orderBy=${s.orderBy} limit=${s.limit ?? ''}`);
  console.log('\nbodies mentioning status/negocia:', bodies.slice(0, 10));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
