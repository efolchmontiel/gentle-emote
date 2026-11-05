import { visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./types.ts";
import type { Animator } from "./animator.ts";
import type { RenderedFrame } from "./renderer.ts";
import { findEditorContainer, gutterWidth, installGutter } from "./gutter.ts";
import type { AvatarBlock } from "./gutter.ts";
import { log } from "./log.ts";
import { parseAnsiForeground } from "./frame_image.ts";
import type { Rgb } from "./frame_image.ts";

const TEXT_CANVAS_COLS = 8;
const TEXT_CANVAS_ROWS = 4;
const MAX_GUTTER_ATTEMPTS = 20;

/**
 * Width a text frame needs. ASCII sets fit the fixed canvas; renderers that paint
 * wider rows (blocks) must reserve what they actually draw, or the gutter clips them.
 */
function canvasCols(lines: string[]): number {
  return Math.max(TEXT_CANVAS_COLS, ...lines.map((line) => visibleWidth(line)));
}

function centerText(lines: string[], cols = canvasCols(lines)): string[] {
  const rows = Math.max(TEXT_CANVAS_ROWS, lines.length);
  const top = Math.floor((rows - lines.length) / 2);
  return Array.from({ length: rows }, (_, row) => {
    const line = lines[row - top] ?? "";
    const pad = Math.max(0, cols - visibleWidth(line));
    return " ".repeat(Math.floor(pad / 2)) + line + " ".repeat(Math.ceil(pad / 2));
  });
}

/** Frames that are plain text rows can sit in the prompt gutter; raw image escapes cannot. */
export function toAvatarBlock(
  frame: RenderedFrame | null,
  config: Config,
  border?: (text: string) => string,
): AvatarBlock | null {
  if (!frame) return null;
  const boxed = config.frame && border ? { border } : {};
  if (frame.kind === "placeholder") return { lines: frame.lines, cols: frame.cols, ...(frame.framed ? {} : boxed) };
  if (frame.kind === "text") {
    const cols = canvasCols(frame.lines);
    return { lines: centerText(frame.lines, cols), cols, ...boxed };
  }
  return null;
}

function borderPainter(theme: any): (text: string) => string {
  return (text) => {
    try {
      if (typeof theme?.fg === "function") return theme.fg("border", text);
    } catch { /* unknown theme role: plain dim border below */ }
    return `\x1b[90m${text}\x1b[39m`;
  };
}

/** Avatar-only rows for the above-editor fallback (no info panel). */
function renderAboveEditor(frame: RenderedFrame, config: Config): string[] {
  const margin = " ";
  if (frame.kind === "placeholder") return frame.lines.map((line) => margin + line);
  if (frame.kind === "text") return centerText(frame.lines).map((line) => margin + line);
  if (frame.cursorAdvances) {
    // iTerm2: the image is drawn from the last row upward so earlier line clears cannot erase it.
    const up = frame.rows > 1 ? `\x1b[${frame.rows - 1}A` : "";
    return Array.from({ length: frame.rows }, (_, row) => (row < frame.rows - 1 ? "" : `${up}\x1b[1C${frame.sequence}`));
  }
  const pad = frame.padMode === "skip" ? `\x1b[${config.size}C` : " ".repeat(config.size);
  return Array.from({ length: frame.rows }, (_, row) => (row === 0 ? margin + frame.sequence + pad : ""));
}

export interface WidgetDeps {
  animator: Animator;
  config: Config;
  getCurrentEmoteSet: () => string;
  /** Theme border colour for frames drawn inside the image. */
  setFrameColor?: (color: Rgb) => void;
}

function themeBorderColor(theme: any): Rgb | null {
  try {
    return typeof theme?.fg === "function" ? parseAnsiForeground(theme.fg("border", "x")) : null;
  } catch {
    return null;
  }
}

export function createWidgetFactory(deps: WidgetDeps) {
  return (tui: any, theme: any) => {
    deps.animator.setTui(tui);
    let restoreGutter: (() => void) | null = null;
    let gutterAttempts = 0;
    const border = borderPainter(theme);

    const avatarFor = (width: number): AvatarBlock | null => {
      const avatar = toAvatarBlock(deps.animator.getRenderedFrame(), deps.config, border);
      if (!avatar) return null;
      return width - gutterWidth(avatar) >= deps.config.minEditorWidth ? avatar : null;
    };

    const component = {
      render(width: number): string[] {
        const { animator, config } = deps;
        const borderColor = themeBorderColor(theme);
        if (borderColor) deps.setFrameColor?.(borderColor);
        const frame = animator.getRenderedFrame();

        if (config.placement === "beside-editor" && toAvatarBlock(frame, config)) {
          if (!restoreGutter && gutterAttempts < MAX_GUTTER_ATTEMPTS) {
            gutterAttempts++;
            const container = findEditorContainer(tui, component);
            if (container) {
              restoreGutter = installGutter(container, avatarFor);
              log(`gutter: installed beside the editor (set="${deps.getCurrentEmoteSet()}")`);
              tui.requestRender?.();
            } else if (gutterAttempts === MAX_GUTTER_ATTEMPTS) {
              log("gutter: editor container not found, using above-editor fallback");
            }
          }
          if (restoreGutter) return [];
        }

        if (!frame || width < config.size + 2 + config.minEditorWidth) return [];
        return renderAboveEditor(frame, config);
      },
      invalidate() {},
      dispose() {
        restoreGutter?.();
        restoreGutter = null;
        deps.animator.setTui(null);
      },
    };
    return component;
  };
}
