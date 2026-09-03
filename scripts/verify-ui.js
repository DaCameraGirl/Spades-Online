const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.env.SMOKE_PORT || 3025;
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(__dirname, '..', 'tmp-ui');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', `--window-size=1280,900`],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, 'lobby.png'), fullPage: true });

  await page.click('#createRoomBtn');
  await page.waitForSelector('#table.panel.active', { timeout: 8000 });
  await page.screenshot({ path: path.join(OUT, 'table-lobby.png'), fullPage: true });

  await page.click('#startGameBtn');
  await page.waitForFunction(() => {
    const hand = document.querySelector('#handArea');
    return hand && hand.querySelectorAll('.card-btn').length >= 13;
  }, { timeout: 12000 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.screenshot({ path: path.join(OUT, '01-bidding-13-cards.png'), fullPage: true });

  await page.waitForFunction(() => {
    const bidBtn = document.querySelector('#bidBtn');
    return bidBtn && !bidBtn.disabled;
  }, { timeout: 12000 });
  await page.select('#bidSelect', '3');
  await page.click('#bidBtn');
  await page.waitForFunction(() => {
    const hand = document.querySelector('#handArea');
    return hand && [...hand.querySelectorAll('.card-btn')].some((card) => !card.disabled);
  }, { timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, '02-your-turn-active-play.png'), fullPage: true });

  const playableCards = await page.$$('.card-btn:not([disabled])');
  if (!playableCards.length) throw new Error('Expected a playable card for disabled-state capture.');
  const cardsBeforePlay = await page.$$eval('#handArea .card-btn', (cards) => cards.length);
  for (const card of playableCards) {
    await card.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const cardsAfterPlay = await page.$$eval('#handArea .card-btn', (cards) => cards.length);
    if (cardsAfterPlay < cardsBeforePlay) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  await page.screenshot({ path: path.join(OUT, '03-not-your-turn-disabled.png'), fullPage: true });

  for (let plays = 0; plays < 3; plays += 1) {
    await page.waitForFunction(() => (
      [...document.querySelectorAll('#handArea .card-btn')].some((card) => !card.disabled)
    ), { timeout: 30000 });
    const cardsBeforePlay = await page.$$eval('#handArea .card-btn', (cards) => cards.length);
    const nextPlayableCards = await page.$$('.card-btn:not([disabled])');
    let accepted = false;
    for (const nextPlayableCard of nextPlayableCards) {
      await nextPlayableCard.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const cardsAfterPlay = await page.$$eval('#handArea .card-btn', (cards) => cards.length);
      if (cardsAfterPlay < cardsBeforePlay) {
        accepted = true;
        break;
      }
    }
    if (!accepted) throw new Error('Could not find a legal card for the next trick.');
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: path.join(OUT, '04-hand-after-several-cards.png'), fullPage: true });

  const desktopMetrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card-btn')];
    const boxes = cards.map((card) => card.getBoundingClientRect());
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cardCount: cards.length,
      handWidth: document.querySelector('#handArea')?.getBoundingClientRect().width || 0,
      handSpan: boxes.length ? boxes[boxes.length - 1].right - boxes[0].left : 0,
      cardGaps: boxes.slice(1).map((box, index) => box.left - boxes[index].right),
      rows: new Set(boxes.map((box) => Math.round(box.top / 10))).size,
      opaqueCards: cards.every((card) => getComputedStyle(card).opacity === '1'),
    };
  });
  fs.writeFileSync(path.join(OUT, 'desktop-metrics.json'), JSON.stringify(desktopMetrics, null, 2));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: path.join(OUT, '05-mobile-narrow.png'), fullPage: true });

  const metrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card-btn')];
    const seats = [...document.querySelectorAll('.seat-card')];
    const felt = document.querySelector('.table-felt');
    const rail = document.querySelector('.table-rail');
    const cardBoxes = cards.map((el) => el.getBoundingClientRect().toJSON());
    const overlaps = [];
    for (let i = 1; i < cardBoxes.length; i += 1) {
      const prev = cardBoxes[i - 1];
      const cur = cardBoxes[i];
      const gap = cur.left - (prev.left + prev.width);
      overlaps.push(gap);
    }
    return {
      cardCount: cards.length,
      seatCount: seats.length,
      feltHeight: felt ? felt.getBoundingClientRect().height : 0,
      railWidth: rail ? rail.getBoundingClientRect().width : 0,
      cardWidth: cardBoxes[0] ? cardBoxes[0].width : 0,
      cardGaps: overlaps,
      wrappingRows: new Set(cardBoxes.map((box) => Math.round(box.top / 10))).size,
      allCardsOpaque: cards.every((card) => getComputedStyle(card).opacity === '1'),
      youSeat: (seats.find((seat) => seat.textContent.includes('You')) || {}).style?.cssText || seats.find((seat) => seat.textContent.includes('You'))?.getBoundingClientRect().toJSON(),
    };
  });

  const mobileMetrics = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card-btn')];
    const boxes = cards.map((card) => card.getBoundingClientRect());
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cardCount: cards.length,
      handWidth: document.querySelector('#handArea')?.getBoundingClientRect().width || 0,
      handSpan: boxes.length ? boxes[boxes.length - 1].right - boxes[0].left : 0,
      rows: new Set(boxes.map((box) => Math.round(box.top / 10))).size,
      opaqueCards: cards.every((card) => getComputedStyle(card).opacity === '1'),
    };
  });
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ desktop: desktopMetrics, mobile: mobileMetrics, table: metrics }, null, 2));
  await browser.close();
  console.log('UI screenshots written to tmp-ui');
  console.log(JSON.stringify({ desktop: desktopMetrics, mobile: mobileMetrics }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
