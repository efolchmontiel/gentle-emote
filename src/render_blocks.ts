import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, EmotesConfig, FrameSet, FrameTransform } from "./types.ts";
import type { Renderer, RenderedFrame } from "./renderer.ts";
import { cycleFrameFiles, discoverFrames } from "./emotes.ts";
import { decodePng } from "./png.ts";
import type { RgbaImage } from "./png.ts";
import { log } from "./log.ts";

// --- Helpers ---

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function weightedRandomPick(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [file, weight] of entries) {
    r -= weight;
    if (r <= 0) return file;
  }
  return entries[entries.length - 1]![0];
}

const fg = (c: readonly [number, number, number]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c: readonly [number, number, number]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;

type Rgb = [number, number, number];

/**
 * Half-blocks lose far more detail than a real image at the same width, so the
 * avatar is drawn wider than `size` to stay recognizable. `size` still scales it.
 */
export const BLOCKS_WIDTH_FACTOR = 1.4;

export function blocksWidth(size: number): number {
  return Math.max(8, Math.round(size * BLOCKS_WIDTH_FACTOR));
}

/**
 * Truecolor half-block renderer for terminals with no image protocol
 * (e.g. Alacritty, or herdr over an unknown outer terminal).
 *
 * Draws the real pixel art: every terminal cell shows two vertically stacked
 * source pixels as `▀` / `▄` with 24-bit SGR colors, scaled to `size` columns.
 * Frame loading and selection mirror BaseImageRenderer exactly; only the
 * pixel → output step differs.
 */
export class BlocksRenderer implements Renderer {
  protected tuiRef: TUI | null = null;
  protected frameMap: Map<EmoteState, FrameSet> = new Map();
  protected lastShownBase64: string | null = null;
  protected currentFrame: RenderedFrame | null = null;
  protected size: number;

  /** Decoded pixels per frame, keyed by the frame's (transformed) base64. */
  private decodedCache: Map<string, RgbaImage> = new Map();
  /** Rendered lines per (frame, size), keyed by base64 + "@" + size. */
  private linesCache: Map<string, string[]> = new Map();

  constructor(size: number) {
    this.size = Math.max(1, Math.floor(size)) || 1;
  }

  setTui(tui: TUI | null) {
    this.tuiRef = tui;
  }

  loadFrames(emoteSetDir: string, _extDir: string, transform?: FrameTransform) {
    this.frameMap = discoverFrames(emoteSetDir, transform);
  }

  getFrameFiles(state: EmoteState): string[] {
    return this.frameMap.get(state)?.files ?? [];
  }

  getRenderedFrame(): RenderedFrame | null {
    return this.currentFrame;
  }

  dispose() {
    this.currentFrame = null;
  }

  resetCache() {
    this.lastShownBase64 = null;
  }

  private show(base64: string, force = false): boolean {
    if (!force && base64 === this.lastShownBase64) return true;
    this.lastShownBase64 = base64;
    this.currentFrame = { kind: "text", lines: this.renderLines(base64) };
    this.tuiRef?.requestRender();
    return true;
  }

  private getBase64(state: EmoteState, name: string): string | null {
    return this.frameMap.get(state)?.base64Cache.get(name) ?? null;
  }

  showFrame(state: EmoteState, name: string, force = false): boolean {
    const b64 = this.getBase64(state, name);
    if (!b64) return false;
    return this.show(b64, force);
  }

  showRandomFrame(state: EmoteState, force = false): boolean {
    const frameSet = this.frameMap.get(state);
    if (!frameSet || frameSet.files.length === 0) return false;
    const file = randomPick(frameSet.files);
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64, force);
  }

  showTalkFrame(emotesConfig: EmotesConfig): boolean {
    const frameSet = this.frameMap.get("talk");
    if (!frameSet || frameSet.files.length === 0) return false;

    if (emotesConfig.talk?.weights) {
      const file = weightedRandomPick(emotesConfig.talk.weights);
      const b64 = frameSet.base64Cache.get(file);
      if (!b64) return this.showRandomFrame("talk");
      return this.show(b64);
    }
    return this.showRandomFrame("talk");
  }

  showTalkCloseFrame(): boolean {
    const frameSet = this.frameMap.get("talk");
    if (!frameSet) return false;
    const closeFile = frameSet.files.find((f) => f.includes("close"));
    const file = closeFile ?? frameSet.files[0]!;
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64);
  }

  showCycleFrame(state: EmoteState, index: number): boolean {
    const frameSet = this.frameMap.get(state);
    const files = cycleFrameFiles(frameSet?.files ?? []);
    if (files.length === 0) return false;
    const file = files[index % files.length]!;
    const b64 = frameSet!.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64);
  }

  getCycleFrameCount(state: EmoteState): number {
    return cycleFrameFiles(this.frameMap.get(state)?.files ?? []).length;
  }

  /** Decode a frame's PNG lazily, cached per file. */
  private decode(base64: string): RgbaImage {
    let image = this.decodedCache.get(base64);
    if (!image) {
      image = decodePng(Buffer.from(base64, "base64"));
      this.decodedCache.set(base64, image);
    }
    return image;
  }

  /** Render the frame as truecolor half-block lines, cached per (file, size). */
  private renderLines(base64: string): string[] {
    const cacheKey = `${base64}@${this.size}`;
    const cached = this.linesCache.get(cacheKey);
    if (cached) return cached;

    const image = this.decode(base64);
    const { width, height, data } = image;
    const cols = this.size;
    const sx = width / cols;
    const rows = Math.ceil(height / (2 * sx));

    const at = (x: number, y: number): Rgb => {
      const i = (y * width + x) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    };
    const clampX = (x: number) => Math.min(Math.max(x, 0), width - 1);
    const clampY = (y: number) => Math.min(Math.max(y, 0), height - 1);

    const sameRgb = (a: Rgb | null, b: Rgb) => a !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

    const lines: string[] = [];
    for (let cy = 0; cy < rows; cy++) {
      let line = "";
      let lastFg: Rgb | null = null;
      let lastBg: Rgb | null = null;

      const setFg = (color: Rgb) => {
        if (!sameRgb(lastFg, color)) {
          line += fg(color);
          lastFg = color;
        }
      };
      // A half-block glyph paints the other half with the background color, so a
      // transparent half must clear it or the previous color bleeds through.
      const clearBg = () => {
        if (lastBg !== null) {
          line += "\x1b[49m";
          lastBg = null;
        }
      };
      const setBg = (color: Rgb) => {
        if (!sameRgb(lastBg, color)) {
          line += bg(color);
          lastBg = color;
        }
      };

      for (let cx = 0; cx < cols; cx++) {
        const x = clampX(Math.floor((cx + 0.5) * sx));
        const topY = clampY(Math.floor((2 * cy + 0.5) * sx));
        const bottomY = clampY(Math.floor((2 * cy + 1.5) * sx));
        const [tr, tg, tb, ta] = at(x, topY);
        const [br, bgc, bb, ba] = at(x, bottomY);
        const topOpaque = ta !== 0;
        const bottomOpaque = ba !== 0;

        if (!topOpaque && !bottomOpaque) {
          clearBg();
          line += " ";
          continue;
        }

        if (!bottomOpaque) {
          clearBg();
          setFg([tr, tg, tb]);
          line += "▀";
          continue;
        }

        if (!topOpaque) {
          clearBg();
          setFg([br, bgc, bb]);
          line += "▄";
          continue;
        }

        setFg([tr, tg, tb]);
        setBg([br, bgc, bb]);
        line += "▀";
      }

      line += "\x1b[0m";
      lines.push(line);
    }

    log(`BlocksRenderer: rendered ${width}x${height} as ${rows}x${cols} cells`);
    this.linesCache.set(cacheKey, lines);
    return lines;
  }
}
