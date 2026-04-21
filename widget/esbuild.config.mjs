import { build, context } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: [resolve("src/index.ts")],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "dist/embedchat.js",
  logLevel: "info",
  banner: {
    js: "/* EmbedChat widget — https://github.com/brightnwokoro/embedchat-widget */",
  },
};

function reportSize() {
  const path = "dist/embedchat.js";
  const raw = readFileSync(path);
  const rawSize = statSync(path).size;
  const gzipSize = gzipSync(raw).length;
  const fmt = (n) => `${(n / 1024).toFixed(2)}kb`;
  console.log(`bundle: ${fmt(rawSize)} raw, ${fmt(gzipSize)} gzipped`);
  return gzipSize;
}

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("esbuild watching…");
} else {
  await build(buildOptions);
  const gzipSize = reportSize();
  const CEILING = 35 * 1024;
  if (gzipSize > CEILING) {
    console.error(`bundle exceeds ${CEILING} byte ceiling`);
    process.exit(1);
  }
}
