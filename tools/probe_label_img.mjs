// Test only: prints small JPEG crops of chosen probe screenshots as notices (base64) so they can be viewed where artifacts cannot be downloaded
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const names = process.argv.slice(2);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
for (const n of names) {
  const b = (await readFile(`probe-out/${n}.png`)).toString("base64");
  await page.setContent(`<body style="margin:0"><div style="width:320px;height:200px;background:url(data:image/png;base64,${b}) -224px -156px"></div>`);
  const j = (await page.screenshot({ type: "jpeg", quality: 50 })).toString("base64");
  for (let i = 0; i * 4000 < j.length; i++) console.log(`::notice title=img ${n} ${i}::` + j.slice(i * 4000, i * 4000 + 4000));
}
await browser.close();
