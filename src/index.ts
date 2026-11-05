import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, unwatchFile, watchFile } from "node:fs";

import { EMOTE_STATES } from "./types.ts";
import type { Config, EmoteState, ResolvedRenderer } from "./types.ts";
import type { Renderer } from "./renderer.ts";
import { log, setDebug } from "./log.ts";
import { loadLayeredConfig } from "./config.ts";
import { resolveEmoteSet, findEmoteSetDir, findYoloSetDir, loadEmotesConfig, EXTENSION_NAME } from "./emotes.ts";
import { bannerConfigCandidates, createAccentTransform, resolveAccent } from "./accent.ts";
import type { Rgb } from "./accent.ts";
import { KittyRenderer } from "./render_kitty.ts";
import { TmuxKittyRenderer } from "./render_tmux_kitty.ts";
import { KittyUnicodeRenderer } from "./render_kitty_unicode.ts";
import { ITermRenderer } from "./render_iterm.ts";
import { TmuxITermRenderer } from "./render_tmux_iterm.ts";
import { AsciiRenderer } from "./render_ascii.ts";
import { BlocksRenderer, blocksWidth } from "./render_blocks.ts";
import { Animator } from "./animator.ts";
import { createWidgetFactory } from "./widget.ts";
import { resolveRenderer } from "./terminal.ts";
import { readYoloRest } from "./yolo.ts";

const WIDGET_KEY = "gentle-emote";
const BANNER_POLL_MS = 2000;

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob", "mem_search", "mem_context", "mem_get_observation", "codegraph_explore", "web_fetch"]);
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "apply_patch"]);
const ASK_TOOLS = new Set(["ask_user_question", "ask_user_choice"]);
const FAREWELL_TOOLS = new Set(["mem_session_summary"]);
const SUBAGENT_TOOLS = new Set(["subagent_run", "subagent_continue", "subagent_reply"]);
const JOB_TOOLS = new Set(["bash_background", "monitor", "job_list", "job_stop"]);
const MEMORY_TOOLS = new Set(["mem_save"]);
/** Gentle Shell hands out a read/observe adapter for its YOLO switch on this event-bus channel. */
const YOLO_HOST_CHANNEL = "gentle:yolo:host-ui";
/** Fired while a guarded confirm, choice, or questionnaire is waiting. The Yes/No art covers the execution. */
const HERDR_BLOCKED = "herdr:blocked";
const YOLO_DISCOVERY_MS = 300;
/** Quick tools whose scene would otherwise flash by: keep it until the next event. */
const STICKY_TOOL_STATES = new Set<EmoteState>(["jobs", "remember"]);

const PREVIEW_MS = 6000;
const DEMO_STEP_MS = 3500;
const PREVIEW_TALK_TEXT = "Here is the thing: this preview talks for a few seconds so you can watch the mouth move and the mustache bounce.";
/** States that never end on their own and would stay up forever in a preview. */
const PREVIEW_LOOPING_STATES = new Set<EmoteState>([
  "think", "read", "write", "tool", "ask", "compact", "delegate", "jobs", "remember", "yolo", "super-yolo",
  "explore", "build", "verify", "judge", "review", "jira",
]);
const DEMO_SEQUENCE: EmoteState[] = [
  "hi", "think", "talk", "read", "tool", "delegate", "explore", "build", "verify", "judge", "review", "jira",
  "write", "jobs", "remember", "ask", "success", "failure", "compact", "yolo", "super-yolo", "grandma", "bye",
];
const EMOTE_DESCRIPTIONS: Record<string, string> = {
  hi: "flies in under a propeller beanie",
  idle: "resting, blinks",
  think: "light bulb switches on",
  talk: "streaming a reply",
  read: "deerstalker, pipe and magnifier",
  write: "frying pan cooking code",
  tool: "whipping the IA robot",
  success: "celebrates",
  failure: "robot blew up",
  compact: "shrinks in place",
  ask: "Yes/No while a prompt is on screen",
  grandma: "idle too long (press a key to wake)",
  bye: "stores memory, tips the hat",
  delegate: "football coach whistling at IA robots (subagents)",
  jobs: "sips mate watching a progress bar (background jobs)",
  remember: "whispers into the Engram elephant's ear (mem_save)",
  yolo: "sunglasses, YOLO headband and a rocket (YOLO mode)",
  "super-yolo": "the same character with a sun (Super YOLO mode)",
  explore: "explorer hat, walking, flashlight on footprints (explore subagents)",
  build: "welding mask and torch (worker / fix subagents)",
  verify: "police officer, a stamp lands on the robot (verify / validator subagents)",
  judge: "judge wig and gavel (judge / refuter subagents)",
  review: "red pen on a page, robot holds the review sign (review-* subagents)",
  jira: "launches a rocket into a cloud (jira subagents)",
  demo: "plays every state in a row",
};

/** Check if a set directory contains any image frames (PNG files in state subdirs). */
function hasImageFrames(setDir: string): boolean {
  for (const state of EMOTE_STATES) {
    const stateDir = join(setDir, state);
    if (existsSync(stateDir) && readdirSync(stateDir).some((f) => f.endsWith(".png"))) return true;
  }
  return false;
}

/** Subagent name patterns, first match wins; anything else keeps the generic megaphone scene. */
const AGENT_STATES: Array<[RegExp, EmoteState]> = [
  [/jira/, "jira"],
  [/judge|refuter/, "judge"],
  [/verify|validator/, "verify"],
  [/^review-/, "review"],
  [/worker|fix|apply/, "build"],
  [/explore/, "explore"],
];

export function agentToState(agent: unknown): EmoteState {
  const name = typeof agent === "string" ? agent.toLowerCase() : "";
  return AGENT_STATES.find(([pattern]) => pattern.test(name))?.[1] ?? "delegate";
}

export function toolNameToState(toolName: string, args?: unknown): EmoteState {
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (ASK_TOOLS.has(toolName)) return "ask";
  if (FAREWELL_TOOLS.has(toolName)) return "bye";
  if (SUBAGENT_TOOLS.has(toolName) || /^mcp__.+?__subagent_(run|continue|reply)$/.test(toolName)) {
    return agentToState((args as { agent?: unknown } | undefined)?.agent);
  }
  if (JOB_TOOLS.has(toolName)) return "jobs";
  if (MEMORY_TOOLS.has(toolName)) return "remember";
  return "tool";
}

function createRendererFromResolved(resolved: ResolvedRenderer, config: Config): Renderer {
  const { protocol, multiplexer } = resolved;
  const { size } = config;
  const besideEditor = config.placement === "beside-editor";
  const inTmux = multiplexer === "tmux";
  // Only placeholder rows are plain text, so they are the only image form that fits the prompt gutter.
  if (protocol === "kitty-unicode" || (protocol === "kitty" && besideEditor)) {
    const frameRows = besideEditor && config.frame ? Math.max(2, Math.round(config.frameRows)) : 0;
    log(`createRenderer: using KittyUnicodeRenderer (passthrough=${inTmux}, frameRows=${frameRows})`);
    return new KittyUnicodeRenderer(size, inTmux, frameRows);
  }
  if (protocol === "kitty") {
    log(`createRenderer: using ${inTmux ? "TmuxKittyRenderer" : "KittyRenderer"}`);
    return inTmux ? new TmuxKittyRenderer(size) : new KittyRenderer(size);
  }
  if (protocol === "iterm2") {
    log(`createRenderer: using ${inTmux ? "TmuxITermRenderer" : "ITermRenderer"}`);
    return inTmux ? new TmuxITermRenderer(size) : new ITermRenderer(size);
  }
  if (protocol === "blocks") {
    const cols = blocksWidth(size, config.blocksCols);
    log(`createRenderer: using BlocksRenderer (${cols} cols for size ${size})`);
    return new BlocksRenderer(cols);
  }
  log(`createRenderer: using AsciiRenderer`);
  return new AsciiRenderer();
}

const sameRgb = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export default function (pi: ExtensionAPI) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const extDir = dirname(__dirname);

  let cwd = process.cwd();
  let { config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd);
  setDebug(config.debug);

  if (!config.enabled) return;

  let currentEmoteSet = "gentleman";
  let widgetActive = false;
  let lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
  let renderer = createRendererFromResolved(lastResolved, config);
  let accent = resolveAccent(config.accent);
  let farewell = false;
  let farewellTimer: ReturnType<typeof setTimeout> | null = null;
  let greetTimer: ReturnType<typeof setTimeout> | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let demoTimer: ReturnType<typeof setTimeout> | null = null;
  let runHadError = false;
  let runUsedTools = false;
  let stopTerminalInput: (() => void) | null = null;
  let watchedBannerFiles: string[] = [];
  let yoloOn = false;
  let yoloVariant: EmoteState | null = null;

  const animator = new Animator(config, renderer);

  function loadEmoteSet(setName: string) {
    currentEmoteSet = setName;

    const setDir = (yoloOn && findYoloSetDir(setName, extDir, cwd)) || findEmoteSetDir(setName, extDir, cwd);
    const isAsciiOnly = existsSync(join(setDir, "ascii.yaml")) && !hasImageFrames(setDir);

    if (isAsciiOnly) {
      if (!(renderer instanceof AsciiRenderer)) {
        renderer = new AsciiRenderer();
        animator.setRenderer(renderer);
      }
    } else {
      const detected = createRendererFromResolved(lastResolved, config);
      if (renderer.constructor !== detected.constructor) {
        renderer = detected;
        animator.setRenderer(renderer);
      }
    }

    renderer.loadFrames(setDir, extDir, createAccentTransform(accent));
    animator.setEmotesConfig(loadEmotesConfig(setDir));
  }

  /** Re-show the current state after frames were reloaded. */
  function refreshCurrentFrame() {
    animator.resetRenderCache();
    if (!widgetActive) return;
    if (animator.currentState === "idle") animator.enterIdle();
    else animator.transitionTo(animator.currentState);
  }

  function switchEmoteSet(modelId: string, thinkingLevel: string) {
    const setName = resolveEmoteSet(modelId, thinkingLevel, config.emotes);
    if (setName === currentEmoteSet) return;
    loadEmoteSet(setName);
    log(`switchEmoteSet: loaded "${setName}", state="${animator.currentState}"`);
    refreshCurrentFrame();
  }

  function onBannerChange() {
    const next = resolveAccent(config.accent);
    if (sameRgb(next, accent)) return;
    accent = next;
    log(`accent: changed to rgb(${next.join(",")})`);
    loadEmoteSet(currentEmoteSet);
    refreshCurrentFrame();
  }

  function watchBanner() {
    unwatchBanner();
    if (config.accent !== "auto") return;
    watchedBannerFiles = bannerConfigCandidates();
    for (const file of watchedBannerFiles) {
      watchFile(file, { interval: BANNER_POLL_MS, persistent: false }, onBannerChange);
    }
  }

  function unwatchBanner() {
    for (const file of watchedBannerFiles) unwatchFile(file, onBannerChange);
    watchedBannerFiles = [];
  }

  function startFarewell() {
    farewell = true;
    if (farewellTimer) { clearTimeout(farewellTimer); farewellTimer = null; }
    if (animator.currentState !== "bye") animator.transitionTo("bye");
  }

  function endFarewellLater() {
    if (farewellTimer) clearTimeout(farewellTimer);
    farewellTimer = setTimeout(() => {
      farewellTimer = null;
      farewell = false;
      if (animator.currentState === "bye") animator.transitionTo("idle");
    }, config.holdDuration.bye);
  }

  // --- YOLO mode (Gentle Shell only): read and observe, never toggle ---

  interface YoloReader {
    read(): Promise<unknown>;
    readMode?: () => Promise<unknown>;
    readSnapshot?: () => Promise<unknown>;
    observe(refresh: () => void): () => void;
    dispose?(): void;
  }
  let yoloReader: YoloReader | null = null;
  let stopYoloObserve: (() => void) | null = null;

  async function refreshYolo() {
    const reader = yoloReader;
    if (!reader) return;
    try {
      const variant = await readYoloRest(reader);
      if (reader !== yoloReader || !widgetActive) return;
      const on = variant !== null;
      if (on === yoloOn && variant === yoloVariant) return;
      yoloOn = on;
      yoloVariant = variant;
      log(`yolo: ${variant ?? "off"}`);
      animator.setIdleVariant(variant);
      loadEmoteSet(currentEmoteSet);
      refreshCurrentFrame();
    } catch { /* display only */ }
  }

  function watchYolo(ctx: unknown) {
    const bus = (pi as { events?: { emit?: (channel: string, payload: unknown) => void } }).events;
    if (typeof bus?.emit !== "function") return;
    let settled = false;
    const timer = setTimeout(() => { settled = true; }, YOLO_DISCOVERY_MS);
    timer.unref?.();
    const respond = (value: unknown) => {
      const reader = value as Partial<YoloReader> | null;
      if (!reader || typeof reader.read !== "function" || typeof reader.observe !== "function") return;
      if (settled || !widgetActive) { reader.dispose?.(); return; }
      settled = true;
      clearTimeout(timer);
      yoloReader = reader as YoloReader;
      stopYoloObserve = yoloReader.observe(() => { void refreshYolo(); });
      void refreshYolo();
    };
    try {
      bus.emit(YOLO_HOST_CHANNEL, { context: ctx, respond });
    } catch {
      clearTimeout(timer);
    }
  }

  function unwatchYolo() {
    stopYoloObserve?.();
    stopYoloObserve = null;
    yoloReader?.dispose?.();
    yoloReader = null;
    yoloOn = false;
    yoloVariant = null;
    animator.setIdleVariant(null);
  }

  /** Activity transitions are suppressed while the goodbye animation owns the avatar. */
  function show(state: EmoteState) {
    if (!widgetActive || farewell) return;
    if (animator.currentState !== state) animator.transitionTo(state);
  }

  // --- /emote previews (no model involved) ---

  function clearPreview() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
  }

  function previewState(state: EmoteState) {
    clearPreview();
    if (farewellTimer) { clearTimeout(farewellTimer); farewellTimer = null; }
    farewell = false;
    if (state === "bye") {
      startFarewell();
      endFarewellLater();
      return;
    }
    animator.transitionTo(state);
    if (state === "talk") animator.onTalkToken(PREVIEW_TALK_TEXT);
    if (!PREVIEW_LOOPING_STATES.has(state)) return;
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (animator.currentState === state) animator.transitionTo("idle");
    }, PREVIEW_MS);
  }

  function playDemo(step = 0) {
    const state = DEMO_SEQUENCE[step];
    if (!state || !widgetActive) return;
    previewState(state);
    demoTimer = setTimeout(() => {
      demoTimer = null;
      playDemo(step + 1);
    }, DEMO_STEP_MS);
  }

  pi.registerCommand?.("emote", {
    description: "Preview a gentle-emote state: /emote <state> | demo",
    getArgumentCompletions: (prefix: string) =>
      [...EMOTE_STATES, "demo"]
        .filter((name) => name.startsWith(prefix.trim()))
        .map((name) => ({ value: name, label: name, description: EMOTE_DESCRIPTIONS[name] })),
    handler: async (args: string, ctx: any) => {
      const name = args.trim();
      if (!widgetActive) {
        ctx.ui?.notify?.(`[${EXTENSION_NAME}] avatar inactive (no UI or disabled)`, "warning");
        return;
      }
      if (name === "demo") {
        playDemo();
        return;
      }
      if ((EMOTE_STATES as readonly string[]).includes(name)) {
        previewState(name as EmoteState);
        return;
      }
      ctx.ui?.notify?.(`[${EXTENSION_NAME}] /emote <state>: ${[...EMOTE_STATES, "demo"].join(", ")}`, "info");
    },
  });

  loadEmoteSet(currentEmoteSet);

  // --- Events ---

  pi.on("session_start", async (_event, ctx) => {
    log(`session_start: hasUI=${ctx.hasUI}`);
    if (!ctx.hasUI) return;

    animator.clearAllTimers();
    cwd = ctx.cwd;
    ({ config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd));
    setDebug(config.debug);
    animator.updateConfig(config);
    if (!config.enabled) return;

    lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
    renderer = createRendererFromResolved(lastResolved, config);
    animator.setRenderer(renderer);
    accent = resolveAccent(config.accent);

    if (lastResolved.warning) {
      ctx.ui.notify(lastResolved.warning, lastResolved.warningLevel);
    } else if (renderer instanceof AsciiRenderer) {
      ctx.ui.notify(`[${EXTENSION_NAME}] No image protocol detected \u2014 using ASCII emotes.`, "warning");
    }

    const setName = resolveEmoteSet(ctx.model?.id ?? "", pi.getThinkingLevel(), config.emotes);
    log(`session_start: set="${setName}" dir="${findEmoteSetDir(setName, extDir, cwd)}"`);
    unwatchYolo();
    loadEmoteSet(setName);
    watchBanner();

    ctx.ui.setWidget(WIDGET_KEY, createWidgetFactory({
      animator,
      config,
      getCurrentEmoteSet: () => currentEmoteSet,
      setFrameColor: (color) => {
        if (renderer instanceof KittyUnicodeRenderer) renderer.setFrameColor(color);
      },
    }), { placement: "aboveEditor" });

    stopTerminalInput?.();
    stopTerminalInput = ctx.ui.onTerminalInput?.(() => {
      if (animator.currentState === "grandma") animator.wave();
      else animator.touch();
      return undefined;
    }) ?? null;

    widgetActive = true;
    watchYolo(ctx);
    if (greetTimer) clearTimeout(greetTimer);
    greetTimer = setTimeout(() => {
      greetTimer = null;
      if (widgetActive) animator.transitionTo("hi");
    }, 500);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
    clearPreview();
    unwatchYolo();
    animator.stop();
    animator.disposeRenderer();
    unwatchBanner();
    stopTerminalInput?.();
    stopTerminalInput = null;
    stopBlocked?.();
    if (farewellTimer) { clearTimeout(farewellTimer); farewellTimer = null; }
    if (widgetActive && ctx.hasUI) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      widgetActive = false;
    }
    animator.setTui(null);
  });

  pi.on("model_select", async (event) => {
    if (!widgetActive) return;
    switchEmoteSet(event.model?.id ?? "", pi.getThinkingLevel());
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (!widgetActive) return;
    switchEmoteSet(ctx.model?.id ?? "", event.level);
  });

  pi.on("input", async (event) => {
    if (!widgetActive) return;
    let farewellPattern: RegExp | null = null;
    try {
      farewellPattern = new RegExp(config.farewellPattern, "i");
    } catch {
      log(`input: invalid farewellPattern "${config.farewellPattern}"`);
    }
    if (farewellPattern?.test(event.text ?? "")) startFarewell();
  });

  pi.on("agent_start", async () => {
    clearPreview();
    runHadError = false;
    runUsedTools = false;
    animator.setAfterTalkState("idle");
  });

  pi.on("message_update", async (event) => {
    if (!widgetActive || farewell) return;
    if (event.message?.role !== "assistant") return;

    const streamEvent = event.assistantMessageEvent;
    if (!streamEvent) return;

    if (streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta") {
      show("think");
      return;
    }

    if (streamEvent.type === "toolcall_start") {
      const block = streamEvent.partial?.content?.[streamEvent.contentIndex];
      const name = block && "name" in block && block.name ? String(block.name) : "";
      if (FAREWELL_TOOLS.has(name)) startFarewell();
      else show(name ? toolNameToState(name) : "tool");
      return;
    }

    if (streamEvent.type !== "text_delta" || !streamEvent.delta) return;
    show("talk");
    animator.onTalkToken(streamEvent.delta);
  });

  pi.on("tool_execution_start", async (event) => {
    if (!widgetActive) return;
    runUsedTools = true;
    if (FAREWELL_TOOLS.has(event.toolName)) startFarewell();
    else show(toolNameToState(event.toolName, event.args));
  });

  pi.on("tool_execution_end", async (event) => {
    if (!widgetActive || farewell) return;
    if (event.isError) {
      runHadError = true;
      animator.setHoldNextState("think");
      const scene = toolNameToState(event.toolName, event.args);
      if (scene !== "verify" || !animator.showFailureFrame("verify", "fail.png")) animator.transitionTo("failure");
    } else if (!ASK_TOOLS.has(event.toolName) && !STICKY_TOOL_STATES.has(toolNameToState(event.toolName))) {
      show("read");
    }
  });

  pi.on("ui_prompt_start", async () => {
    if (!widgetActive) return;
    animator.beginPrompt();
  });

  pi.on("ui_prompt_end", async () => {
    if (!widgetActive) return;
    animator.endPrompt();
  });

  const stopBlocked = pi.events?.on?.(HERDR_BLOCKED, (data: unknown) => {
    if (!widgetActive) return;
    const active = !!data && typeof data === "object" && (data as { active?: unknown }).active === true;
    if (active) animator.beginPrompt();
    else animator.endPrompt();
  });

  pi.on("agent_end", async () => {
    if (!widgetActive) return;
    if (farewell) {
      endFarewellLater();
      return;
    }
    const finale: EmoteState = runUsedTools && !runHadError ? "success" : "idle";
    if (animator.currentState === "talk") {
      animator.setAfterTalkState(finale);
      animator.endTalk();
    } else if (animator.currentState !== "idle" && animator.currentState !== "hi" && animator.currentState !== "failure") {
      animator.transitionTo(finale);
    }
  });

  pi.on("session_before_compact", async () => {
    show("compact");
  });

  pi.on("session_compact", async () => {
    show("idle");
  });
}
