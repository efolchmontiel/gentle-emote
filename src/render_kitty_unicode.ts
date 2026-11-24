import { getCellDimensions, getImageDimensions, calculateImageRows } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, EmotesConfig, FrameSet, FrameTransform } from "./types.ts";
import type { Renderer, RenderedFrame } from "./renderer.ts";
import { cycleFrameFiles, discoverFrames } from "./emotes.ts";
import { wrapTmuxPassthrough } from "./tmux.ts";
import { log } from "./log.ts";
import { defaultBorderColor, frameCols, framePngBase64, frameStroke } from "./frame_image.ts";
import type { CellSize, FrameBox, Rgb } from "./frame_image.ts";

const PLACEHOLDER = "\u{10EEEE}";
const CHUNK_SIZE = 4096;

/**
 * Row/column diacritics for kitty Unicode placeholders.
 * Derived from kitty's rowcolumn-diacritics.txt (combining class 230).
 * Index 0 = row 0, index 1 = row 1, etc.
 */
const ROW_DIACRITICS: string[] = [
  "\u0305", "\u030D", "\u030E", "\u0310", "\u0312",
  "\u033D", "\u033E", "\u033F", "\u0346", "\u034A",
  "\u034B", "\u034C", "\u0350", "\u0351", "\u0352",
  "\u0357", "\u035B", "\u0363", "\u0364", "\u0365",
  "\u0366", "\u0367", "\u0368", "\u0369", "\u036A",
  "\u036B", "\u036C", "\u036D", "\u036E", "\u036F",
  "\u0483", "\u0484", "\u0485", "\u0486", "\u0487",
  "\u0592", "\u0593", "\u0594", "\u0595", "\u0597",
  "\u0598", "\u0599", "\u059C", "\u059D", "\u059E",
  "\u059F", "\u05A0", "\u05A1", "\u05A8", "\u05A9",
  "\u05AB", "\u05AC", "\u05AF", "\u05C4", "\u0610",
  "\u0611", "\u0612", "\u0613", "\u0614", "\u0615",
  "\u0616", "\u0617", "\u0618", "\u0619", "\u061A",
  "\u0653", "\u0654", "\u0657", "\u0658", "\u06D6",
  "\u06D7", "\u06D8", "\u06D9", "\u06DA", "\u06DB",
  "\u06DC", "\u06DF", "\u06E0", "\u06E1", "\u06E2",
  "\u06E4", "\u06E7", "\u06E8", "\u06EB", "\u06EC",
];

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

/**
 * Build the kitty graphics transmit sequence (with virtual placement U=1).
 * Handles chunking for large payloads. Wrapped in tmux passthrough when asked.
 */
function buildTransmitSequence(base64: string, imageId: number, cols: number, rows: number, passthrough: boolean): string {
  const chunks: string[] = [];
  let offset = 0;

  while (offset < base64.length) {
    const chunk = base64.slice(offset, offset + CHUNK_SIZE);
    const isFirst = offset === 0;
    const isLast = offset + CHUNK_SIZE >= base64.length;
    const more = isLast ? 0 : 1;

    if (isFirst) {
      const meta = `a=T,f=100,q=2,U=1,i=${imageId},c=${cols},r=${rows}`;
      chunks.push(`\x1b_G${meta},m=${more};${chunk}\x1b\\`);
    } else {
      chunks.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
    offset += CHUNK_SIZE;
  }

  if (chunks.length === 0) {
    chunks.push(`\x1b_Ga=T,f=100,q=2,U=1,i=${imageId},c=${cols},r=${rows},m=0;\x1b\\`);
  }

  const sequence = chunks.join("");
  return passthrough ? wrapTmuxPassthrough(sequence) : sequence;
}

/**
 * Build the Unicode placeholder grid text for an image.
 * Each line is one row of placeholder characters colored with the image ID.
 */
/**
 * Nearest whole row count instead of pi-tui's ceiling: the terminal fits the
 * image into the c×r box keeping its aspect, so a slight shrink beats a mostly
 * empty extra row next to the prompt.
 */
export function placeholderRows(
  dims: { widthPx: number; heightPx: number },
  cols: number,
  cellDims: { widthPx: number; heightPx: number },
): number {
  const exact = (cols * cellDims.widthPx * dims.heightPx) / (dims.widthPx * cellDims.heightPx);
  return Number.isFinite(exact) && exact > 0 ? Math.max(1, Math.round(exact)) : calculateImageRows(dims, cols, cellDims);
}

function buildPlaceholderLines(imageId: number, cols: number, rows: number): string[] {
  const r = (imageId >> 16) & 255;
  const g = (imageId >> 8) & 255;
  const b = imageId & 255;
  const colorOn = `\x1b[38;2;${r};${g};${b}m`;
  const colorOff = `\x1b[39m`;

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const diacritic = row < ROW_DIACRITICS.length ? ROW_DIACRITICS[row] : ROW_DIACRITICS[0];
    // First char gets row diacritic, rest inherit
    const firstChar = PLACEHOLDER + diacritic;
    const restChars = PLACEHOLDER.repeat(Math.max(0, cols - 1));
    lines.push(`${colorOn}${firstChar}${restChars}${colorOff}`);
  }
  return lines;
}

/**
 * Kitty Unicode Placeholder renderer (Ghostty, kitty; tmux via passthrough).
 *
 * Uses kitty's virtual placement + Unicode placeholder approach:
 * 1. Transmit image data out of band (creates a virtual placement)
 * 2. Display via U+10EEEE placeholder characters (regular text)
 *
 * Because every avatar row is ordinary text, it composes beside other
 * components (the prompt gutter) and stays inside tmux panes.
 */
export class KittyUnicodeRenderer implements Renderer {
  private tuiRef: TUI | null = null;
  private frameMap: Map<EmoteState, FrameSet> = new Map();
  private lastShownBase64: string | null = null;
  private currentFrame: RenderedFrame | null = null;
  private size: number;
  private imageId: number;
  private nextImageId: number;
  private uploaded = new Map<string, number>();
  private passthrough: boolean;
  private frameRows: number;
  private frameColor: Rgb = defaultBorderColor();
  private framedCache = new Map<string, string>();
  private framedCacheKey = "";
  private lastRawBase64: string | null = null;

  /** `frameRows > 0` boxes every frame in a rounded border exactly that many rows tall. */
  constructor(size: number, passthrough: boolean, frameRows = 0) {
    this.size = size;
    this.passthrough = passthrough;
    this.frameRows = frameRows;
    // Random 24-bit image ID (required for truecolor encoding)
    this.imageId = Math.floor(Math.random() * 0xFFFFFE) + 1;
    this.nextImageId = this.imageId;
  }

  private allocateImageId(): number {
    const id = this.nextImageId;
    this.nextImageId = (this.nextImageId % 0xFFFFFE) + 1;
    return id;
  }

  private deleteUploaded() {
    for (const id of this.uploaded.values()) {
      const del = `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`;
      process.stdout.write(this.passthrough ? wrapTmuxPassthrough(del) : del);
    }
    this.uploaded.clear();
  }

  /** Border colour follows the theme; returns true when it changed. */
  setFrameColor(color: Rgb): boolean {
    if (color.every((value, index) => value === this.frameColor[index])) return false;
    this.frameColor = [...color];
    if (this.frameRows > 0 && this.lastRawBase64) this.show(this.lastRawBase64, true);
    return true;
  }

  private framedBase64(base64: string, box: FrameBox, cell: CellSize): string {
    const key = `${cell.widthPx}x${cell.heightPx}|${box.cols}x${box.rows}|${box.stroke}|${box.color.join(",")}`;
    if (key !== this.framedCacheKey) {
      this.framedCache.clear();
      this.framedCacheKey = key;
    }
    let framed = this.framedCache.get(base64);
    if (!framed) {
      framed = framePngBase64(base64, box, cell);
      this.framedCache.set(base64, framed);
    }
    return framed;
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

  private show(base64: string, force = false): boolean {
    const cellDims = getCellDimensions();
    const framed = this.frameRows > 0;
    const showKey = framed
      ? `${cellDims.widthPx}x${cellDims.heightPx}|${this.frameColor.join(",")}|${base64}`
      : base64;
    if (!force && showKey === this.lastShownBase64) return true;
    this.lastShownBase64 = showKey;
    this.lastRawBase64 = base64;

    const dims = getImageDimensions(base64, "image/png") ?? { widthPx: 510, heightPx: 510 };
    let payload = base64;
    let cols = this.size;
    let rows: number;
    if (framed) {
      const stroke = frameStroke(cellDims);
      rows = this.frameRows;
      cols = frameCols(rows, cellDims, { width: dims.widthPx, height: dims.heightPx }, stroke);
      payload = this.framedBase64(base64, { cols, rows, stroke, color: this.frameColor }, cellDims);
    } else {
      rows = placeholderRows(dims, cols, cellDims);
    }

    // Upload each distinct frame once under its own id; later shows only swap
    // the placeholder text, so the visible image is never replaced in place.
    const uploadKey = `${cols}x${rows}|${showKey}`;
    let imageId = this.uploaded.get(uploadKey);
    const reused = imageId !== undefined;
    if (imageId === undefined) {
      if (this.uploaded.size >= 256) this.deleteUploaded();
      imageId = this.allocateImageId();
      const transmit = buildTransmitSequence(payload, imageId, cols, rows, this.passthrough);
      process.stdout.write(transmit);
      this.uploaded.set(uploadKey, imageId);
    }
    this.imageId = imageId;

    // Build placeholder grid as text lines
    const lines = buildPlaceholderLines(imageId, cols, rows);

    log(`KittyUnicodeRenderer.show: dims=${dims.widthPx}x${dims.heightPx}, cols=${cols}, rows=${rows}, framed=${framed}, imageId=${imageId}, reused=${reused}`);

    this.currentFrame = { kind: "placeholder", lines, rows, cols, framed };
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

  dispose() {
    // Delete every uploaded frame from terminal's graphics memory
    this.deleteUploaded();
    this.currentFrame = null;
  }

  resetCache() {
    this.lastShownBase64 = null;
  }
}
