// One-time Telegram login that prints a session string for the TELEGRAM_SESSION repository secret.
// Run on your own computer (Node 18+):  npx -y -p telegram@2 -p input node tools/telegram_login.mjs
// You need the api_id and api_hash from https://my.telegram.org (API development tools).
// The session string gives full access to that Telegram account: keep it secret and store it only as a GitHub secret.
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = Number(await input.text("api_id: "));
const apiHash = await input.text("api_hash: ");
const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 });
await client.start({
  phoneNumber: () => input.text("Phone number (with country code): "),
  password: () => input.text("Two-step verification password (if set): "),
  phoneCode: () => input.text("Code Telegram sent you: "),
  onError: (e) => console.error(e),
});
console.log("\nTELEGRAM_SESSION value (copy all of it):\n\n" + client.session.save() + "\n");
await client.disconnect();
process.exit(0);
