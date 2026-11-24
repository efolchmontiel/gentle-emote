import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { KittyUnicodeRenderer } from "../src/render_kitty_unicode.ts";

const SET = join(import.meta.dirname, "..", "emotes", "gentleman");

function capture(run: () => void): string {
  const write = process.stdout.write;
  let out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    run();
  } finally {
    process.stdout.write = write;
  }
  return out;
}

const transmittedIds = (out: string) => [...out.matchAll(/\x1b_Ga=T,[^;]*?i=(\d+)/g)].map((m) => Number(m[1]));
const deletedIds = (out: string) => [...out.matchAll(/\x1b_Ga=d,d=I,i=(\d+)/g)].map((m) => Number(m[1]));
const placeholderId = (renderer: KittyUnicodeRenderer) => {
  const frame = renderer.getRenderedFrame();
  assert.ok(frame && frame.kind === "placeholder");
  const [, r, g, b] = frame.lines[0]!.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/)!.map(Number);
  return (r! << 16) | (g! << 8) | b!;
};

test("each distinct frame is transmitted once under its own image id", () => {
  const renderer = new KittyUnicodeRenderer(8, false);
  renderer.loadFrames(SET, SET);
  const [first, second] = renderer.getFrameFiles("talk");
  assert.ok(first && second);

  const shown: number[] = [];
  const out = capture(() => {
    for (const name of [first, second, first, second]) {
      assert.ok(renderer.showFrame("talk", name));
      shown.push(placeholderId(renderer));
    }
  });

  const ids = transmittedIds(out);
  assert.equal(ids.length, 2, "a frame shown again is not transmitted again");
  assert.notEqual(ids[0], ids[1], "a new frame never replaces the visible image in place");
  assert.deepEqual(shown, [ids[0], ids[1], ids[0], ids[1]], "switching frames only changes the placeholder");
});

test("dispose deletes every transmitted image", () => {
  const renderer = new KittyUnicodeRenderer(8, false);
  renderer.loadFrames(SET, SET);
  const [first, second] = renderer.getFrameFiles("talk");
  const out = capture(() => {
    renderer.showFrame("talk", first!);
    renderer.showFrame("talk", second!);
    renderer.dispose();
  });
  assert.deepEqual(deletedIds(out).sort(), transmittedIds(out).sort());
  assert.equal(renderer.getRenderedFrame(), null);
});
