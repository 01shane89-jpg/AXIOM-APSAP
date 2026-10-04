// Test only: prints small JPEG crops of chosen probe screenshots as notices (base64) so they can be viewed where artifacts cannot be downloaded
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const names = process.argv.slice(2);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 512, height: 340 } });
for (const n of names) {
  const b = (await readFile(`probe-out/${n}.png`)).toString("base64");
  await page.setContent(`<body style="margin:0"><div style="width:512px;height:340px;background:url(data:image/png;base64,${b}) -128px -86px"></div>`);
  const j = (await page.screenshot({ type: "jpeg", quality: 55 })).toString("base64");
  console.log(`::notice title=img ${n}::` + j);
}
await browser.close();
