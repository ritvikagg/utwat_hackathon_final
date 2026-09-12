import 'dotenv/config';
import Steel from 'steel-sdk';
import { chromium } from 'playwright';

async function main() {
  const client = new Steel({ steelAPIKey: process.env.STEEL_API_KEY });
  const session = await client.sessions.create();
  console.log('Session created:', session.id);
  console.log('Watch it live at:', session.sessionViewerUrl);

  const browser = await chromium.connectOverCDP(
    `${session.websocketUrl}&apiKey=${process.env.STEEL_API_KEY}`
  );
  const page = browser.contexts()[0].pages()[0];
  await page.goto('https://example.com');
  console.log('Page title:', await page.title());

  await client.sessions.release(session.id);
  console.log('Session released. Smoke test passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
