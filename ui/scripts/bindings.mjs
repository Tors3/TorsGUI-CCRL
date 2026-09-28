// Regenerates the TypeScript bindings from the Rust types (ts-rs) and maps
// 64-bit integers to `number` (JSON numbers; values stay far below 2^53).
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../src/bindings", import.meta.url).pathname;
if (!process.argv.includes("--no-cargo")) {
  execSync("cargo test -p torsgui-core --lib export_bindings -q", { cwd: join(dir, "../../.."), stdio: "inherit" });
}
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".ts")) continue;
  const p = join(dir, f);
  const s = readFileSync(p, "utf8").replace(/\bbigint\b/g, "number");
  writeFileSync(p, s);
}
console.log("bindings updated");
