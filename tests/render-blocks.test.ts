import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BlocksRenderer, blocksWidth } from "../src/render_blocks.ts";
import { decodePng } from "../src/png.ts";
import { createAccentTransform, BANNER_ACCENTS } from "../src/accent.ts";

const SET_DIR = join(import.meta.dirname, "..", "emotes", "gentleman");
const IDLE_PNG = join(SET_DIR, "idle", "idle.png");
const EXT_DIR = join(import.meta.dirname, "..");

const stripAnsi = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

const pixel = (image: { width: number; data: Uint8Array }, x: number, y: number) => {
  const at = (y * image.width + x) * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2], image.data[at + 3]] as const;
};

const shownIdleLines = (size: number) => {
  const renderer = new BlocksRenderer(size);
  renderer.loadFrames(SET_DIR, EXT_DIR);
  assert.equal(renderer.showFrame("idle", "idle.png"), true);
  const frame = renderer.getRenderedFrame();
  assert.ok(frame, "a shown frame must be available");
  assert.equal(frame.kind, "text");
  return frame.kind === "text" ? frame.lines : [];
};

test("idle.png at size 10 renders 10 cells per line and the spec row count", () => {
  const sprite = decodePng(readFileSync(IDLE_PNG));
  const lines = shownIdleLines(10);
  // rows = ceil(H / (2 * sx)) with sx = W / cols: ceil(40 / 9.6) = 5
  assert.equal(lines.length, Math.ceil(sprite.height / (2 * (sprite.width / 10))));
  for (const line of lines) {
    assert.equal(stripAnsi(line).length, 10, "each line is exactly 10 terminal cells wide");
  }
});

test("a cell whose top pixel is opaque emits that pixel's exact truecolor foreground", () => {
  const sprite = decodePng(readFileSync(IDLE_PNG));
  const renderer = new BlocksRenderer(1);
  renderer.loadFrames(SET_DIR, EXT_DIR);
  renderer.showFrame("idle", "idle.png");
  const frame = renderer.getRenderedFrame();
  assert.ok(frame && frame.kind === "text");
  // size 1: sx = W, so the single cell samples top at (floor(0.5*W), floor(0.5*W))
  const tx = Math.min(Math.floor(0.5 * sprite.width), sprite.width - 1);
  const ty = Math.min(Math.floor(0.5 * sprite.width), sprite.height - 1);
  const [r, g, b, a] = pixel(sprite, tx, ty);
  assert.equal(a, 255, "precondition: the sampled top pixel is opaque");
  assert.ok(
    frame.lines[0]!.includes(`\x1b[38;2;${r};${g};${b}m`),
    `top pixel rgb(${r},${g},${b}) must appear as a 38;2 foreground`,
  );
});

test("a cell whose top and bottom pixels are transparent renders as a plain space", () => {
  const sprite = decodePng(readFileSync(IDLE_PNG));
  const lines = shownIdleLines(10);
  const sx = sprite.width / 10;
  let checked = 0;
  for (const [cy, line] of lines.entries()) {
    const cells = stripAnsi(line);
    for (const [cx, char] of [...cells].entries()) {
      if (char !== " ") continue;
      const x = Math.min(Math.floor((cx + 0.5) * sx), sprite.width - 1);
      const ty = Math.min(Math.floor((2 * cy + 0.5) * sx), sprite.height - 1);
      const by = Math.min(Math.floor((2 * cy + 1.5) * sx), sprite.height - 1);
      assert.equal(pixel(sprite, x, ty)[3], 0, "space cell top pixel is transparent");
      assert.equal(pixel(sprite, x, by)[3], 0, "space cell bottom pixel is transparent");
      checked++;
    }
  }
  assert.ok(checked > 0, "at least one fully transparent cell exists in the sprite");
});

test("every line ends with exactly one reset and never resets earlier", () => {
  const lines = shownIdleLines(10);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(line.endsWith("\x1b[0m"), "line ends with \\x1b[0m");
    assert.equal(line.indexOf("\x1b[0m"), line.length - 4, "no reset before the final one");
  }
});

test("the accent transform recolors the magenta key to the pink accent", () => {
  const plain = shownIdleLines(10);
  assert.ok(plain.some((l) => l.includes("255;0;255")), "the untransformed frame shows the #ff00ff accent key");

  const renderer = new BlocksRenderer(10);
  renderer.loadFrames(SET_DIR, EXT_DIR, createAccentTransform(BANNER_ACCENTS.pink!));
  renderer.showFrame("idle", "idle.png");
  const frame = renderer.getRenderedFrame();
  assert.ok(frame && frame.kind === "text");
  for (const line of frame.lines) {
    assert.ok(!line.includes("255;0;255"), "the #ff00ff key color must be rewritten");
  }
  const pink = BANNER_ACCENTS.pink!;
  assert.ok(
    frame.lines.some((l) => l.includes(`${pink[0]};${pink[1]};${pink[2]}`)),
    "the pink accent shade appears in the transformed frame",
  );
});

test("frame selection mirrors the image renderers, including cycle wrap", () => {
  const renderer = new BlocksRenderer(10);
  renderer.loadFrames(SET_DIR, EXT_DIR);
  assert.equal(renderer.getRenderedFrame(), null, "nothing is rendered before a frame is shown");

  const declared = readdirSync(join(SET_DIR, "idle")).filter((f) => f.endsWith(".png")).sort();
  assert.deepEqual(renderer.getFrameFiles("idle"), declared);

  assert.equal(renderer.showFrame("idle", "idle.png"), true);
  assert.ok(renderer.getRenderedFrame(), "showFrame makes the frame available");

  const count = renderer.getCycleFrameCount("read");
  assert.ok(count > 0);
  renderer.showCycleFrame("read", 0);
  const first = renderer.getRenderedFrame();
  renderer.showCycleFrame("read", count);
  const wrapped = renderer.getRenderedFrame();
  assert.ok(first && wrapped && first.kind === "text" && wrapped.kind === "text");
  assert.deepEqual(wrapped.kind === "text" ? wrapped.lines : [], first.kind === "text" ? first.lines : []);
});

test("size 4 yields exactly 4 cells per line", () => {
  const lines = shownIdleLines(4);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(stripAnsi(line).length, 4);
  }
});

/**
 * Walk a line of half-block cells, tracking the SGR state so every cell can be
 * compared against the pixels it must paint. A space or a `▄` may never sit on a
 * leftover background: that is the artifact this guards.
 */
type Painted = { char: string; fg: string | null; bg: string | null };

function paintedCells(line: string): Painted[] {
  const cells: Painted[] = [];
  let fg: string | null = null;
  let bg: string | null = null;
  for (const token of line.match(/\x1b\[[0-9;]*m|./gu) ?? []) {
    if (token.startsWith("\x1b[")) {
      const params = token.slice(2, -1).split(";");
      if (params[0] === "0") { fg = null; bg = null; }
      else if (params[0] === "49") bg = null;
      else if (params[0] === "38") fg = params.slice(2).join(";");
      else if (params[0] === "48") bg = params.slice(2).join(";");
      continue;
    }
    cells.push({ char: token, fg, bg });
  }
  return cells;
}

const CASES = [
  { state: "idle", file: "idle.png", size: 10 },
  { state: "yolo", file: "yolo.png", size: 10 },
  { state: "read", file: "read_1.png", size: 4 },
] as const;

for (const { state, file, size } of CASES) {
  test(`${file} at size ${size} paints the two sampled pixels of every cell, with no stale background`, () => {
    // Same accent transform the renderer applies, so accent keys compare as pink.
    const transform = createAccentTransform(BANNER_ACCENTS.pink);
    const sprite = decodePng(Buffer.from(transform(readFileSync(join(SET_DIR, state, file)).toString("base64")), "base64"));
    const renderer = new BlocksRenderer(size);
    renderer.loadFrames(SET_DIR, EXT_DIR, transform);
    assert.equal(renderer.showFrame(state, file), true);
    const frame = renderer.getRenderedFrame();
    assert.ok(frame && frame.kind === "text");
    const lines = frame.lines;

    const clamp = (value: number, high: number) => Math.min(Math.max(value, 0), high - 1);
    const sx = sprite.width / size;
    for (let cy = 0; cy < lines.length; cy++) {
      const cells = paintedCells(lines[cy]!);
      assert.equal(cells.length, size, `line ${cy} has ${size} cells`);
      for (let cx = 0; cx < size; cx++) {
        const x = clamp(Math.floor((cx + 0.5) * sx), sprite.width);
        const top = pixel(sprite, x, clamp(Math.floor((2 * cy + 0.5) * sx), sprite.height));
        const bottom = pixel(sprite, x, clamp(Math.floor((2 * cy + 1.5) * sx), sprite.height));
        const cell = cells[cx]!;
        const where = `line ${cy} cell ${cx}`;
        if (top[3] === 0 && bottom[3] === 0) {
          assert.equal(cell.char, " ", `${where}: a fully transparent cell is a space`);
          assert.equal(cell.bg, null, `${where}: a transparent cell must not keep a background`);
        } else if (bottom[3] === 0) {
          assert.equal(cell.char, "▀", `${where}: top-only cell uses ▀`);
          assert.equal(cell.fg, `${top[0]};${top[1]};${top[2]}`, `${where}: foreground is the top pixel`);
          assert.equal(cell.bg, null, `${where}: a top-only cell must not keep a background`);
        } else if (top[3] === 0) {
          assert.equal(cell.char, "▄", `${where}: bottom-only cell uses ▄`);
          assert.equal(cell.fg, `${bottom[0]};${bottom[1]};${bottom[2]}`, `${where}: foreground is the bottom pixel`);
          assert.equal(cell.bg, null, `${where}: a bottom-only cell must not keep a background`);
        } else {
          assert.equal(cell.char, "▀", `${where}: a full cell uses ▀`);
          assert.equal(cell.fg, `${top[0]};${top[1]};${top[2]}`, `${where}: foreground is the top pixel`);
          assert.equal(cell.bg, `${bottom[0]};${bottom[1]};${bottom[2]}`, `${where}: background is the bottom pixel`);
        }
      }
    }
  });
}

test("the avatar is drawn wider than size so half-blocks stay recognizable", () => {
  assert.equal(blocksWidth(10), 14, "the default size renders 14 columns of blocks");
  assert.equal(blocksWidth(4), 8, "small sizes keep a floor so the face does not vanish");
  assert.ok(blocksWidth(20) > 20, "a bigger size always grows the avatar");
});
