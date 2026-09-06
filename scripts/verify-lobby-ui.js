const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.env.SMOKE_PORT || 3026;
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(__dirname, '..', 'tmp-ui');
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function click(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.evaluate((target) => document.querySelector(target).click(), selector);
}

function scrollInfo() {
  return {
    scrollY: window.scrollY,
    bodyScrollHeight: document.body.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    hasVerticalScrollbar: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
  };
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(400);

  const name = `${viewport.width}x${viewport.height}`;
  const results = {};

  await page.screenshot({ path: path.join(OUT, `lobby-${name}-opening.png`), fullPage: false });
  results.opening = await page.evaluate(scrollInfo);

  await click(page, '[data-lobby-room="beginner"]');
  await page.waitForSelector('#roomView.panel.active', { timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('#tableGrid .table-tile').length > 0, { timeout: 8000 });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, `lobby-${name}-room-browser.png`), fullPage: false });
  results.roomBrowser = await page.evaluate(scrollInfo);

  await page.close();
  return { viewport: name, results };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const all = [];
    for (const viewport of VIEWPORTS) {
      all.push(await runViewport(browser, viewport));
    }
    fs.writeFileSync(path.join(OUT, 'lobby-verify.json'), JSON.stringify(all, null, 2));
    console.log(JSON.stringify(all, null, 2));
    const scrollIssues = all.flatMap((entry) => Object.entries(entry.results)
      .filter(([, info]) => info.hasVerticalScrollbar)
      .map(([screen]) => `${entry.viewport} ${screen}`));
    if (scrollIssues.length) {
      console.warn('Vertical scroll present on:', scrollIssues.join(', '));
    } else {
      console.log('No unexpected vertical scroll on any viewport.');
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
