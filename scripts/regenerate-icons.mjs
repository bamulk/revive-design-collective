#!/usr/bin/env node
/**
 * Regenerate the app icon set from public/apple-icon.png.
 *
 * Run after dropping a new design PNG at public/apple-icon.png:
 *   node scripts/regenerate-icons.mjs
 *
 * Outputs:
 *   public/icon.png          — 512x512, used by manifest "any" + favicon.
 *   public/icon-maskable.png — 512x512, used by manifest "maskable"
 *                              for Android adaptive icons. The current
 *                              dark/gold design has its content roughly
 *                              centered, so we just resize — no safe-
 *                              zone shrinkwrap needed.
 *
 * The source PNG itself is what iOS reads for apple-touch-icon
 * (see layout.tsx) so we don't write it out here.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, "..", "public");
const SRC = resolve(PUBLIC, "apple-icon.png");
const OUT_ICON = resolve(PUBLIC, "icon.png");
const OUT_MASKABLE = resolve(PUBLIC, "icon-maskable.png");

if (!existsSync(SRC)) {
  console.error(
    `Missing source: ${SRC}\nDrop the design PNG there first, then re-run.`,
  );
  process.exit(1);
}

const SIZE = 512;

await sharp(SRC).resize(SIZE, SIZE, { fit: "cover" }).png().toFile(OUT_ICON);
console.log(`✓ wrote ${OUT_ICON}`);

await sharp(SRC)
  .resize(SIZE, SIZE, { fit: "cover" })
  .png()
  .toFile(OUT_MASKABLE);
console.log(`✓ wrote ${OUT_MASKABLE}`);

console.log("\nDone. Commit the three icons together:");
console.log("  git add public/apple-icon.png public/icon.png public/icon-maskable.png");
