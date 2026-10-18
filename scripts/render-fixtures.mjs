// Renders every fixture's expected flow to out/fixtures/<fixture>/ for visual review (PoT Part A).
// Usage: npm run render:fixtures [-- --screenshots] [-- --link <href>]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseVtt } from '../src/vtt/parse.js';
import { renderTaskFlow } from '../src/render/render.js';

const args = process.argv.slice(2);
const screenshots = args.includes('--screenshots');
const linkIndex = args.indexOf('--link');
const stylesheets = linkIndex >= 0 ? { link: [args[linkIndex + 1]] } : {};

const fixturesDir = new URL('../tests/fixtures/', import.meta.url);
const outDir = new URL('../out/fixtures/', import.meta.url);
const written = [];

for (const fixture of readdirSync(fixturesDir).filter((n) => /^F\d+-/.test(n)).sort()) {
  const { cues } = parseVtt(readFileSync(new URL(`${fixture}/transcript.vtt`, fixturesDir), 'utf8'));
  const flow = JSON.parse(readFileSync(new URL(`${fixture}/expected.flow.json`, fixturesDir), 'utf8'));
  const dir = new URL(`${fixture}/`, outDir);
  mkdirSync(dir, { recursive: true });
  for (const d of renderTaskFlow(flow, cues, { name: fixture.split('-')[0], stylesheets })) {
    writeFileSync(new URL(d.fileName, dir), d.svg);
    writeFileSync(new URL(d.fileName.replace(/\.svg$/, '.mmd'), dir), d.mermaid);
    written.push(new URL(d.fileName, dir));
  }
}
console.log(`Wrote ${written.length} diagrams to out/fixtures/`);

if (screenshots) {
  const { firefox } = await import('@playwright/test');
  const browser = await firefox.launch();
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: scheme });
    for (const file of written) {
      await page.goto(file.href);
      await page.locator('svg').first().screenshot({ path: file.pathname.replace(/\.svg$/, `.${scheme}.png`) });
    }
    await page.close();
  }
  await browser.close();
  console.log('Screenshots written (light and dark)');
}
