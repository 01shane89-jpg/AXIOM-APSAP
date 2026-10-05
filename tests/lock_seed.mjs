// Test helper: an init script that makes the page count as unlocked by an owner device (assets/osap-lock.js): this app
// session's unlock flag plus a device record holding the first owner's public key. Only the public key is used, so no
// passkey or private key is involved; the page itself never sees anything secret in tests.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../assets/osap-lock.js", import.meta.url), "utf8");
const code = (src.match(/"osap-pub:v1:([A-Za-z0-9_-]+)"/) || [])[1] || "";
export const OWNER_PUB = code;
export const UNLOCK = `try { sessionStorage.setItem("osap-lock-open", "1"); localStorage.setItem("osap-lock-dev", JSON.stringify({ v: 1, cred: "test", iv: "", wrapped: "test", pub: ${JSON.stringify(code)} })); } catch (e) {}`;
