// Renders public/icon.svg to a 1024x1024 PNG (source for `tauri icon`).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const exe = process.env.PW_CHROMIUM || undefined;
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="1024" height="1024" ')}</body></html>`);
await p.screenshot({ path: new URL("../../src-tauri/icons/icon-source.png", import.meta.url).pathname, omitBackground: true });
await b.close();
