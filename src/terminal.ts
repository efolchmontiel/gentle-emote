import { getCapabilities } from "@earendil-works/pi-tui";
import type { TerminalMapping, ResolvedRenderer } from "./types.ts";
import { checkTmuxPassthrough, detectOuterTerminal } from "./tmux.ts";
import { log } from "./log.ts";

type Protocol = "kitty" | "kitty-unicode" | "iterm2" | "ascii" | "blocks";

const MULTIPLEXERS = new Set(["tmux", "screen", "zellij"]);

/** Pane managers that resolve their outer terminal instead of a static renderer. */
const LAYERS = new Set(["herdr"]);

/**
 * Detect the terminal or multiplexer name from environment variables.
 * Multiplexers are checked first — they set vars that leak through from
 * the outer terminal emulator.
 */
export function detectTerminalName(): string {
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  const term = (process.env.TERM ?? "").toLowerCase();

  // --- Multiplexers (checked first) ---
  if (process.env.ZELLIJ_SESSION_NAME || process.env.ZELLIJ) return "zellij";
  if (process.env.TMUX || term.startsWith("tmux")) return "tmux";
  if (term.startsWith("screen")) return "screen";

  // --- Pane layers (they rewrite TERM and TERM_PROGRAM, so they come before emulators) ---
  if (process.env.HERDR_ENV || process.env.HERDR_PANE_ID || termProgram === "herdr") return "herdr";

  // --- Terminal emulators ---
  if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") return "kitty";
  if (process.env.GHOSTTY_RESOURCES_DIR || termProgram === "ghostty" || term.includes("ghostty")) return "ghostty";
  if (process.env.WEZTERM_PANE || termProgram === "wezterm") return "wezterm";
  if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") return "iterm2";
  if (termProgram === "vscode") return "vscode";
  if (termProgram === "alacritty" || term.startsWith("alacritty")) return "alacritty";
  if (termProgram === "warpterminal") return "warpterminal";

  return "unknown";
}

/**
 * Resolve which renderer to use.
 *
 * Returns a ResolvedRenderer with:
 * - protocol: the image protocol to use
 * - multiplexer: which multiplexer we're inside (null if direct)
 * - warning: optional user-facing warning message
 * - warningLevel: "warning" (actionable) or "info" (informational)
 */
export function resolveRenderer(
  terminals: TerminalMapping[],
  userConfiguredTerminals: Set<string>,
): ResolvedRenderer {
  const name = detectTerminalName();
  log(`terminal: detected "${name}"`);

  if (MULTIPLEXERS.has(name)) {
    return resolveMultiplexer(name, terminals, userConfiguredTerminals);
  }

  if (LAYERS.has(name)) {
    return resolveLayer(name, terminals, userConfiguredTerminals);
  }

  return resolveDirect(name, terminals);
}

/**
 * Resolve renderer for a multiplexer session.
 */
function resolveMultiplexer(
  name: string,
  terminals: TerminalMapping[],
  userConfiguredTerminals: Set<string>,
): ResolvedRenderer {
  const multiplexer = name as "tmux" | "screen" | "zellij";
  const base: Pick<ResolvedRenderer, "multiplexer" | "warningLevel"> = {
    multiplexer,
    warningLevel: "warning",
  };

  // Find the terminal entry for this multiplexer
  const entry = terminals.find((e) => e.match === name);
  const render = entry?.render ?? "auto";
  const isUserConfigured = userConfiguredTerminals.has(name);

  // Concrete renderer specified (not "auto") — use it directly.
  // Only suppress warnings if it was explicitly set by user/project config.
  if (render !== "auto") {
    log(`terminal: "${name}" → "${render}"${isUserConfigured ? " (user configured)" : " (default)"}`);
    return { ...base, protocol: render, warning: null };
  }

  // Auto-detection path (explicit "auto" from user, or default "auto")
  if (name === "tmux") {
    return resolveTmux(base);
  }

  // zellij and screen — not supported yet
  const label = name === "zellij" ? "zellij" : "screen";
  log(`terminal: ${label} detected, image passthrough not supported`);
  return {
    ...base,
    protocol: "ascii",
    warningLevel: "info",
    warning: isUserConfigured
      ? null
      : `[gentle-emote] ${label} detected. Image passthrough not supported... yet! Defaulting to ASCII.`,
  };
}

/**
 * Resolve renderer for tmux auto-detection.
 */
function resolveTmux(
  base: Pick<ResolvedRenderer, "multiplexer" | "warningLevel">,
): ResolvedRenderer {
  // Check if passthrough is enabled
  if (!checkTmuxPassthrough()) {
    log("terminal: tmux passthrough not enabled");
    return {
      ...base,
      protocol: "ascii",
      warning:
        "[gentle-emote] tmux detected. Add 'set -g allow-passthrough on' and 'set -ga update-environment TERM_PROGRAM' to tmux.conf to enable image avatar. Defaulting to ASCII.",
    };
  }

  // Passthrough enabled — detect outer terminal
  const outer = detectOuterTerminal();
  log(`terminal: tmux passthrough enabled, outer protocol → "${outer}"`);

  if (outer === "ascii") {
    return {
      ...base,
      protocol: "ascii",
      warning:
        "[gentle-emote] tmux passthrough enabled but could not detect outer terminal. Defaulting to ASCII.",
    };
  }

  // Use kitty-unicode for kitty protocol through tmux (pane-safe).
  // iTerm2 has no pane-safe equivalent — default to ascii.
  if (outer === "kitty") {
    return { ...base, protocol: "kitty-unicode", warning: null };
  }

  return {
    ...base,
    protocol: "ascii",
    warning:
      `[gentle-emote] tmux + ${outer} detected. No pane-safe image renderer available. Defaulting to ASCII. Set render to \"iterm2\" to opt in (experimental).`,
  };
}

/**
 * Resolve renderer for a direct (non-multiplexer) terminal.
 */
function resolveDirect(
  name: string,
  terminals: TerminalMapping[],
): ResolvedRenderer {
  const base: ResolvedRenderer = {
    protocol: "ascii",
    multiplexer: null,
    warning: null,
    warningLevel: "warning",
  };

  // Check whitelist
  const entry = terminals.find((e) => e.match === name);
  if (entry) {
    const render = entry.render === "auto" ? detectDirectProtocol() : entry.render;
    log(`terminal: whitelist match "${name}" → render "${render}"`);
    return { ...base, protocol: render };
  }

  // No whitelist match — fall back to pi-tui capabilities. That guess can be wrong
  // (it reports images for a layer that has none outside it), so say so.
  const caps = getCapabilities();
  const fallback: Protocol = caps.images ?? "ascii";
  log(`terminal: no whitelist match for "${name}", using pi-tui capabilities → "${fallback}"`);
  if (fallback === "ascii") return { ...base, protocol: fallback };
  return {
    ...base,
    protocol: fallback,
    warningLevel: "info",
    warning: `[gentle-emote] Unrecognized terminal "${name}"; pi-tui reports "${fallback}" images. If the avatar does not appear, set "render": "blocks" for it in your terminals config.`,
  };
}

/**
 * Resolve renderer for a pane layer that rewrites TERM/TERM_PROGRAM (herdr).
 *
 * The layer speaks kitty graphics itself, so an image renderer only works when
 * the terminal outside it can draw kitty images. Those terminals leak their own
 * env vars through the layer; when nothing leaks, fall back to text instead of
 * trusting pi-tui, which reports the layer's own claim.
 */
function resolveLayer(
  name: string,
  terminals: TerminalMapping[],
  userConfiguredTerminals: Set<string>,
): ResolvedRenderer {
  const base: ResolvedRenderer = {
    protocol: "ascii",
    multiplexer: null,
    warning: null,
    warningLevel: "warning",
  };

  const entry = terminals.find((e) => e.match === name);
  if (entry && entry.render !== "auto") {
    log(`terminal: layer "${name}" → "${entry.render}"${userConfiguredTerminals.has(name) ? " (user configured)" : " (default)"}`);
    return { ...base, protocol: entry.render };
  }

  const outer = detectLayerOuter();
  if (outer) {
    log(`terminal: layer "${name}" over an image-capable outer terminal → "${outer}"`);
    return { ...base, protocol: outer };
  }

  const protocol = textProtocol();
  log(`terminal: layer "${name}" over a terminal without images → "${protocol}"`);
  if (userConfiguredTerminals.has(name)) return { ...base, protocol };

  return {
    ...base,
    protocol,
    warning: `[gentle-emote] ${name} detected over a terminal with no image support (such as Alacritty), so the avatar is drawn as text. Choose it explicitly with { "match": "${name}", "render": "${protocol}" } (or "ascii") in your terminals config.`,
  };
}

/**
 * The outer terminal behind a pane layer, from the env vars it passes through.
 * Only kitty-class images survive the layer, and WezTerm speaks kitty graphics.
 */
function detectLayerOuter(): Protocol | null {
  if (process.env.KITTY_WINDOW_ID) return "kitty-unicode";
  if (process.env.GHOSTTY_RESOURCES_DIR) return "kitty-unicode";
  if (process.env.WEZTERM_PANE) return "kitty-unicode";
  log("terminal: layer found no outer terminal signal");
  return null;
}

/** The best text renderer this terminal can draw: truecolor blocks, else ascii. */
function textProtocol(): Protocol {
  return supportsTruecolor() ? "blocks" : "ascii";
}

function supportsTruecolor(): boolean {
  const colorterm = (process.env.COLORTERM ?? "").toLowerCase();
  const term = (process.env.TERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return true;
  if (term.includes("truecolor") || term.includes("24bit") || term.includes("direct")) return true;
  const hint = `${term} ${(process.env.TERM_PROGRAM ?? "").toLowerCase()}`;
  return /alacritty|kitty|ghostty|wezterm|iterm|vscode|warp/.test(hint);
}

/**
 * Detect image protocol for a direct terminal using pi-tui capabilities.
 */
function detectDirectProtocol(): Protocol {
  const caps = getCapabilities();
  return caps.images ?? "ascii";
}
