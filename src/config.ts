import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config, EmoteMapping, TerminalMapping } from "./types.ts";
import { agentDir, EXTENSION_NAME } from "./emotes.ts";

export interface ConfigResult {
  config: Config;
  userConfiguredTerminals: Set<string>;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function loadJsonFile(path: string): any | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export const DEFAULTS: Config = {
  enabled: true,
  debug: false,
  size: 10,
  placement: "beside-editor",
  frame: true,
  frameRows: 4,
  minEditorWidth: 40,
  readingSpeed: 4,
  holdDuration: { hi: 2400, success: 1600, failure: 2400, bye: 6000 },
  blinkInterval: [3000, 6000],
  talkTickMs: 120,
  cycleMs: 500,
  grandmaAfterMs: 30_000,
  accent: "auto",
  farewellPattern: "^\\s*(chau|chao|adi[oó]s|bye|goodbye|nos vemos|hasta (luego|ma[nñ]ana)|me voy|cerr[aá] (la )?sesi[oó]n|cerremos)\\b",
  emotes: [{ model: "*", "emote-set": "gentleman" }],
  terminals: [
    { match: "zellij", render: "ascii" },
    { match: "tmux", render: "auto" },
    { match: "screen", render: "ascii" },
    { match: "wezterm", render: "iterm2" },
    { match: "ghostty", render: "kitty" },
    { match: "warpterminal", render: "kitty" },
    { match: "herdr", render: "auto" },
    { match: "alacritty", render: "blocks" },
  ],
};

/**
 * Append emote arrays in priority order.
 * Since emotes uses "last match wins", lower-priority layers come first.
 * Skips undefined/empty layers — they don't participate.
 */
function mergeEmotes(...layers: (EmoteMapping[] | undefined)[]): EmoteMapping[] {
  const result: EmoteMapping[] = [];
  for (const layer of layers) {
    if (layer?.length) result.push(...layer);
  }
  return result.length > 0 ? result : DEFAULTS.emotes;
}

/**
 * Merge terminal arrays by `match` key.
 * Higher-priority layers replace entries with the same match key,
 * or append new ones. Preserves ordering from lower layers.
 */
function mergeTerminals(...layers: (TerminalMapping[] | undefined)[]): TerminalMapping[] {
  const result = new Map<string, TerminalMapping>();
  for (const layer of layers) {
    if (!layer?.length) continue;
    for (const entry of layer) {
      result.set(entry.match, entry);
    }
  }
  return result.size > 0 ? [...result.values()] : DEFAULTS.terminals;
}

export function loadLayeredConfig(extDir: string, cwd: string): ConfigResult {
  // Layer 1: Extension config (lowest priority)
  const extConfig = loadJsonFile(join(extDir, "config.json"));

  // Layer 2: User global config
  const userConfig = loadJsonFile(join(agentDir(), "extensions", EXTENSION_NAME, "config.json"));

  // Layer 3: Project config (highest priority)
  const projectConfig = loadJsonFile(join(cwd, ".pi", "extensions", EXTENSION_NAME, "config.json"));

  // Deep merge in priority order
  let merged = DEFAULTS;
  if (extConfig) merged = deepMerge(merged, extConfig);
  if (userConfig) merged = deepMerge(merged, userConfig);
  if (projectConfig) merged = deepMerge(merged, projectConfig);

  // "emotes" — append arrays in priority order (last match wins)
  merged.emotes = mergeEmotes(
    DEFAULTS.emotes,
    extConfig?.emotes,
    userConfig?.emotes,
    projectConfig?.emotes,
  );

  // "terminals" — merge by match key, higher priority replaces (first match wins)
  merged.terminals = mergeTerminals(
    DEFAULTS.terminals,
    extConfig?.terminals,
    userConfig?.terminals,
    projectConfig?.terminals,
  );

  if (merged.placement !== "beside-editor" && merged.placement !== "above-editor") {
    console.error(`[${EXTENSION_NAME}] Warning: invalid "placement" "${String(merged.placement)}", using "beside-editor".`);
    merged.placement = "beside-editor";
  }

  // Track which terminal match keys were explicitly set by user or project config
  const userConfiguredTerminals = new Set<string>();
  for (const entry of userConfig?.terminals ?? []) {
    userConfiguredTerminals.add(entry.match);
  }
  for (const entry of projectConfig?.terminals ?? []) {
    userConfiguredTerminals.add(entry.match);
  }

  return { config: merged, userConfiguredTerminals };
}
