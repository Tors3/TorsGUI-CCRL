// Builds the sidecars in release mode and copies them where Tauri expects them
// (`src-tauri/binaries/<name>-<target triple>[.exe]`). At runtime Tauri places
// them next to the app executable: `torsgui-runner` (plays the tournaments) and
// `torsgui-demo-engine` (the mock UCI engine used by the guided demo).
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const triple = process.env.TAURI_TARGET || execSync("rustc -vV").toString().match(/host: (\S+)/)[1];
const ext = triple.includes("windows") ? ".exe" : "";
execSync(`cargo build --release -p torsgui-runner -p mock-uci --target ${triple}`, { cwd: root, stdio: "inherit" });
mkdirSync(join(root, "src-tauri", "binaries"), { recursive: true });
for (const [bin, name] of [["torsgui-runner", "torsgui-runner"], ["mock-uci", "torsgui-demo-engine"]]) {
  copyFileSync(join(root, "target", triple, "release", `${bin}${ext}`), join(root, "src-tauri", "binaries", `${name}-${triple}${ext}`));
}
console.log(`sidecars ready for ${triple}`);
