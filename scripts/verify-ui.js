const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.env.SMOKE_PORT || 3025;
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(__dirname, '..', 'tmp-ui');
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function click(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.evaluate((target) => document.querySelector(target).click(), selector);
}

async function waitForHumanBidTurn(page) {
  await page.waitForFunction(() => {
    const bidBtn = document.querySelector('#bidBtn');
    return bidBtn && !bidBtn.disabled;
  }, { timeout: 15000 });
}

async function waitForHumanPlayTurn(page) {
  await page.waitForFunction(() => (
    [...document.querySelectorAll('#handArea .card-btn')].some((card) => !card.disabled)
  ), { timeout: 24000 });
}

async function playOneLegalCard(page) {
  const before = await page.$$eval('#handArea .card-btn', (cards) => cards.length);
  const playableCards = await page.$$('#handArea .card-btn:not([disabled])');
  if (!playableCards.length) throw new Error('Expected at least one playable card.');

  for (const card of playableCards) {
    await card.click();
    await sleep(180);
    const after = await page.$$eval('#handArea .card-btn', (cards) => cards.length);
    if (after < before) return;
  }

  throw new Error('Could not find a legal card to play.');
}

async function collectMetrics(page, phase) {
  return page.evaluate((phaseName) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        top: Math.round(box.top * 100) / 100,
        right: Math.round(box.right * 100) / 100,
        bottom: Math.round(box.bottom * 100) / 100,
        left: Math.round(box.left * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
      };
    };
    const inViewport = (box) => Boolean(box)
      && box.top >= -1
      && box.left >= -1
      && box.right <= window.innerWidth + 1
      && box.bottom <= window.innerHeight + 1;
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const cards = [...document.querySelectorAll('#handArea .card-btn')].map((el) => rectFromElement(el));
    const seats = [...document.querySelectorAll('.seat-card')].map((el) => rectFromElement(el));

    function rectFromElement(el) {
      const box = el.getBoundingClientRect();
      return {
        top: Math.round(box.top * 100) / 100,
        right: Math.round(box.right * 100) / 100,
        bottom: Math.round(box.bottom * 100) / 100,
        left: Math.round(box.left * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
      };
    }

    const cardTops = cards.map((box) => Math.round(box.top));
    const cardBottoms = cards.map((box) => Math.round(box.bottom));
    const bidBox = rect('.bid-row');
    const result = {
      phase: phaseName,
      viewport,
      scroll: {
        scrollY: window.scrollY,
        bodyScrollHeight: document.body.scrollHeight,
        docScrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        hasVerticalScrollbar: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      },
      counts: { seats: seats.length, cards: cards.length },
      visible: {
        hud: visible('.table-hud'),
        table: visible('.table-rail'),
        hand: visible('#handArea'),
        bidControls: visible('.bid-row'),
      },
      boxes: {
        hud: rect('.table-hud'),
        table: rect('.table-rail'),
        message: rect('.table-message'),
        bidControls: bidBox,
        hand: rect('#handArea'),
      },
      allSeatsInViewport: seats.every(inViewport),
      allCardsInViewport: cards.every(inViewport),
      allRanksReachable: cards.every((box, index) => index === 0 || box.left - cards[index - 1].left >= 18),
      cardRows: new Set(cardBottoms).size <= 3 ? 1 : new Set(cardTops).size,
      cardSpan: cards.length ? {
        left: cards[0].left,
        right: cards[cards.length - 1].right,
        width: Math.round((cards[cards.length - 1].right - cards[0].left) * 100) / 100,
      } : null,
    };

    result.pass = !result.scroll.hasVerticalScrollbar
      && result.visible.hud
      && result.visible.table
      && result.visible.hand
      && (phaseName !== 'bidding' || result.visible.bidControls)
      && result.counts.seats === 4
      && result.counts.cards >= (phaseName === 'bidding' ? 13 : 12)
      && result.allSeatsInViewport
      && result.allCardsInViewport
      && result.allRanksReachable
      && inViewport(result.boxes.hud)
      && inViewport(result.boxes.table)
      && inViewport(result.boxes.hand)
      && (phaseName !== 'bidding' || inViewport(result.boxes.bidControls));

    return result;
  }, phase);
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
  await click(page, '#createRoomBtn');
  await page.waitForSelector('#table.panel.active', { timeout: 8000 });
  await click(page, '#startGameBtn');
  await page.waitForFunction(() => document.querySelectorAll('#handArea .card-btn').length >= 13, { timeout: 12000 });
  await sleep(700);

  const name = `${viewport.width}x${viewport.height}`;
  await page.screenshot({ path: path.join(OUT, `verify-${name}-bidding.png`), fullPage: false });
  const bidding = await collectMetrics(page, 'bidding');

  await waitForHumanBidTurn(page);
  await page.select('#bidSelect', '3');
  await click(page, '#bidBtn');
  await waitForHumanPlayTurn(page);
  await sleep(250);

  await page.screenshot({ path: path.join(OUT, `verify-${name}-play-ready.png`), fullPage: false });
  const playReady = await collectMetrics(page, 'play-ready');

  await playOneLegalCard(page);
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `verify-${name}-after-play.png`), fullPage: false });

  await page.close();
  return { viewport, bidding, playReady };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const results = [];
    for (const viewport of VIEWPORTS) {
      results.push(await runViewport(browser, viewport));
    }

    fs.writeFileSync(path.join(OUT, 'verify-desktop-layout.json'), JSON.stringify(results, null, 2));
    const failures = results.flatMap((entry) => [entry.bidding, entry.playReady].filter((phase) => !phase.pass));
    console.log(JSON.stringify(results, null, 2));
    if (failures.length) {
      throw new Error(`${failures.length} desktop layout verification phase(s) failed.`);
    }
    console.log('Desktop layout verification OK.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
