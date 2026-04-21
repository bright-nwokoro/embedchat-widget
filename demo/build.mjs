import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

if (!existsSync("src/index.html")) {
  console.error("demo: src/index.html missing");
  process.exit(1);
}
const outDir = resolve("dist");
mkdirSync(outDir, { recursive: true });
copyFileSync("src/index.html", resolve(outDir, "index.html"));
copyFileSync("src/styles.css", resolve(outDir, "styles.css"));
console.log("demo: built to dist/");
