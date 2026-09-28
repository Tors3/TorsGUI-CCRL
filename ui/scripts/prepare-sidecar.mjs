// Builds torsgui-runner in release mode and copies it where Tauri expects a
// sidecar (`src-tauri/binaries/torsgui-runner-<target triple>[.exe]`). At
// runtime Tauri places it next to the app executable as `torsgui-runner`.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const triple = process.env.TAURI_TARGET || execSync("rustc -vV").toString().match(/host: (\S+)/)[1];
const ext = triple.includes("windows") ? ".exe" : "";
execSync(`cargo build --release -p torsgui-runner --target ${triple}`, { cwd: root, stdio: "inherit" });
mkdirSync(join(root, "src-tauri", "binaries"), { recursive: true });
copyFileSync(join(root, "target", triple, "release", `torsgui-runner${ext}`), join(root, "src-tauri", "binaries", `torsgui-runner-${triple}${ext}`));
console.log(`sidecar ready for ${triple}`);
