import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const widgetBundle = resolve("../widget/dist/embedchat.js");
if (!existsSync(widgetBundle)) {
  console.error(
    "cdn-worker: widget/dist/embedchat.js not found. Run `pnpm --filter=widget build` first.",
  );
  process.exit(1);
}
const js = readFileSync(widgetBundle, "utf-8");
const target = resolve("src/bundle.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  `// AUTO-GENERATED — DO NOT EDIT. Run 'node build.mjs'.\n` +
    `export const WIDGET_BUNDLE = ${JSON.stringify(js)};\n`,
);
console.log(`cdn-worker: inlined ${js.length} bytes of widget bundle`);
