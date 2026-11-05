import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "../../src/png.ts";
import { BANNER_ACCENTS, createAccentTransform } from "../../src/accent.ts";

/**
 * One representative frame per state, recolored and upscaled, for the README
 * grid: `node scripts/sprites/scenes.ts [accent] [outDir] [set]`.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const accentName = process.argv[2] ?? "pink";
const outDir = process.argv[3] ?? join(repoRoot, "docs", "scenes");
const setRoot = join(repoRoot, "emotes", process.argv[4] ?? "gentleman");
const transform = createAccentTransform(BANNER_ACCENTS[accentName] ?? BANNER_ACCENTS.pink!);

const SCALE = 2;
const PAD = 4;
const BG = [24, 22, 30];

type EmotesJson = { talk?: { weights?: Record<string, number> } };

const config: EmotesJson = (() => {
  try {
    return JSON.parse(readFileSync(join(setRoot, "emotes.json"), "utf-8")) as EmotesJson;
  } catch {
    return {};
  }
})();

/**
 * The frame the state rests on: the exact `<state>.png`, else the heaviest
 * weighted frame, else the first `<state>_*` frame, else the first frame that
 * is not a one-shot `in_*` intro, else the first frame.
 */
function representative(state: string, files: string[]): string {
  const exact = `${state}.png`;
  if (files.includes(exact)) return exact;

  const weights = state === "talk" ? config.talk?.weights : undefined;
  if (weights) {
    const heaviest = Object.entries(weights)
      .filter(([file]) => files.includes(file))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (heaviest) return heaviest[0];
  }

  const prefixed = files.filter((file) => file.startsWith(`${state}_`) && !file.includes("_blink"));
  if (prefixed[0]) return prefixed[0];

  return files.find((file) => !file.startsWith("in_")) ?? files[0]!;
}

mkdirSync(outDir, { recursive: true });

const states = readdirSync(setRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort();

for (const state of states) {
  const files = readdirSync(join(setRoot, state)).filter((file) => file.endsWith(".png")).sort();
  if (files.length === 0) continue;

  const source = readFileSync(join(setRoot, state, representative(state, files)));
  const frame = decodePng(Buffer.from(transform(source.toString("base64")), "base64"));
  const width = frame.width * SCALE + PAD * 2;
  const height = frame.height * SCALE + PAD * 2;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([BG[0]!, BG[1]!, BG[2]!, 255], i * 4);

  for (let y = 0; y < frame.height * SCALE; y++) {
    for (let x = 0; x < frame.width * SCALE; x++) {
      const s = (Math.floor(y / SCALE) * frame.width + Math.floor(x / SCALE)) * 4;
      const alpha = frame.data[s + 3]! / 255;
      if (alpha === 0) continue;
      const d = ((PAD + y) * width + PAD + x) * 4;
      for (let c = 0; c < 3; c++) data[d + c] = Math.round(frame.data[s + c]! * alpha + data[d + c]! * (1 - alpha));
    }
  }

  writeFileSync(join(outDir, `${state}.png`), encodePng({ width, height, data }));
}

console.log(`scenes: ${states.length} states → ${outDir}`);
