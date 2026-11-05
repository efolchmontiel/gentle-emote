export const EMOTE_STATES = [
  "hi", "idle", "think", "talk", "read", "write", "tool",
  "success", "failure", "compact", "ask", "grandma", "bye",
  "delegate", "jobs", "remember", "yolo", "super-yolo",
  "explore", "build", "verify", "judge", "review", "jira",
] as const;

export type EmoteState = (typeof EMOTE_STATES)[number];

/** Where the avatar is drawn: in a gutter left of the prompt, or as a widget row above it. */
export type Placement = "beside-editor" | "above-editor";

/** "auto" follows Gentle Shell's /gentle:customize color; otherwise a banner color name or #rrggbb. */
export type AccentSetting = "auto" | "pink" | "cyan" | "yellow" | "green" | `#${string}`;

export interface Config {
  enabled: boolean;
  debug: boolean;
  size: number;
  /** Columns of truecolor half-blocks; 0 follows `size`. */
  blocksCols: number;
  placement: Placement;
  /** Box the avatar in a rounded frame next to the prompt. */
  frame: boolean;
  /** Height of the framed avatar in rows; the prompt panel grows to match. */
  frameRows: number;
  /** Below this editor width (columns, after the gutter) the avatar is hidden. */
  minEditorWidth: number;
  readingSpeed: number;
  holdDuration: { hi: number; success: number; failure: number; bye: number };
  blinkInterval: [number, number];
  talkTickMs: number;
  cycleMs: number;
  /** Idle time before the avatar turns into a grandma. 0 disables it. */
  grandmaAfterMs: number;
  accent: AccentSetting;
  /** Case-insensitive regex; a matching user prompt plays the goodbye animation. */
  farewellPattern: string;
  emotes: EmoteMapping[];
  terminals: TerminalMapping[];
}

export interface EmoteMapping {
  model?: string;
  "thinking-level"?: string;
  "emote-set": string;
}

export interface TerminalMapping {
  match: string;
  render: "kitty" | "kitty-unicode" | "iterm2" | "ascii" | "blocks" | "auto";
}

export interface ResolvedRenderer {
  protocol: "kitty" | "kitty-unicode" | "iterm2" | "ascii" | "blocks";
  multiplexer: "tmux" | "screen" | "zellij" | null;
  warning: string | null;
  warningLevel: "warning" | "info";
}

export type CycleMode = "pingpong" | "loop";

export interface EmotesConfig {
  idle?: { default?: string; blink?: string };
  think?: { default?: string; hard?: string };
  talk?: { weights?: Record<string, number> };
  /** Per-state frame cycling: "pingpong" (default) or "loop". */
  cycle?: Partial<Record<EmoteState, CycleMode>>;
  /** Per-state frame duration override (ms). */
  frameMs?: Partial<Record<EmoteState, number>>;
}

export interface FrameSet {
  files: string[];
  base64Cache: Map<string, string>;
}

/** Rewrites a PNG (base64) before it is cached, e.g. to recolor accent pixels. */
export type FrameTransform = (base64: string) => string;
