import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectTerminalName, resolveRenderer } from "../src/terminal.ts";
import { DEFAULTS } from "../src/config.ts";
import type { TerminalMapping } from "../src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Env vars that can change detection, so every case starts from the same place. */
const MANAGED = [
  "TERM", "TERM_PROGRAM", "COLORTERM",
  "KITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR", "WEZTERM_PANE", "ITERM_SESSION_ID",
  "TMUX", "ZELLIJ", "ZELLIJ_SESSION_NAME",
  "HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID",
];

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map(MANAGED.map((key) => [key, process.env[key]]));
  for (const key of MANAGED) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The env a herdr pane reports inside Alacritty, measured from a live session. */
const HERDR_ALACRITTY = {
  TERM: "xterm-256color",
  TERM_PROGRAM: "herdr",
  TERM_PROGRAM_VERSION: undefined,
  COLORTERM: "truecolor",
  HERDR_ENV: "1",
  HERDR_PANE_ID: "w1D:p1",
};

const resolve = (terminals: TerminalMapping[], userConfigured: string[] = []) =>
  resolveRenderer(terminals, new Set(userConfigured));

test("herdr is named from its own env and from TERM_PROGRAM, but a multiplexer still wins", () => {
  withEnv({ HERDR_ENV: "1" }, () => assert.equal(detectTerminalName(), "herdr"));
  withEnv({ HERDR_PANE_ID: "w1D:p1" }, () => assert.equal(detectTerminalName(), "herdr"));
  withEnv({ TERM_PROGRAM: "herdr" }, () => assert.equal(detectTerminalName(), "herdr"));
  withEnv({ ...HERDR_ALACRITTY, TMUX: "/tmp/tmux-1000/default,1,0" }, () =>
    assert.equal(detectTerminalName(), "tmux"));
  withEnv({ ...HERDR_ALACRITTY, ZELLIJ: "0" }, () => assert.equal(detectTerminalName(), "zellij"));
});

test("herdr over Ghostty keeps the image renderer through the leaked outer terminal", () => {
  withEnv({ ...HERDR_ALACRITTY, GHOSTTY_RESOURCES_DIR: "/usr/share/ghostty" }, () => {
    const resolved = resolve(DEFAULTS.terminals);
    assert.equal(resolved.protocol, "kitty-unicode");
    assert.equal(resolved.warning, null);
  });
  withEnv({ ...HERDR_ALACRITTY, KITTY_WINDOW_ID: "1" }, () => {
    assert.equal(resolve(DEFAULTS.terminals).protocol, "kitty-unicode");
  });
});

test("herdr over a terminal without images falls back to blocks instead of a guess", () => {
  withEnv(HERDR_ALACRITTY, () => {
    const resolved = resolve(DEFAULTS.terminals);
    assert.equal(resolved.protocol, "blocks");
    assert.match(resolved.warning ?? "", /herdr/);
    assert.match(resolved.warning ?? "", /"match": "herdr"/);
    assert.match(resolved.warning ?? "", /"blocks"/);
  });
});

test("herdr without truecolor falls back to ascii", () => {
  withEnv({ ...HERDR_ALACRITTY, COLORTERM: undefined }, () => {
    const resolved = resolve(DEFAULTS.terminals);
    assert.equal(resolved.protocol, "ascii");
    assert.match(resolved.warning ?? "", /herdr/);
  });
});

test("a user who sets herdr's renderer gets exactly that, with no warning", () => {
  withEnv(HERDR_ALACRITTY, () => {
    const resolved = resolve(DEFAULTS.terminals, ["herdr"]);
    assert.equal(resolved.protocol, "blocks");
    assert.equal(resolved.warning, null);
  });
  withEnv(HERDR_ALACRITTY, () => {
    // The layered config merges by `match`, so a user entry replaces the shipped one.
    const terminals = DEFAULTS.terminals.map((entry) =>
      entry.match === "herdr" ? { match: "herdr", render: "ascii" as const } : entry);
    const resolved = resolve(terminals, ["herdr"]);
    assert.equal(resolved.protocol, "ascii");
    assert.equal(resolved.warning, null);
  });
});

test("alacritty is detected directly, from TERM_PROGRAM and from TERM alone", () => {
  withEnv({ TERM_PROGRAM: "alacritty", TERM: "alacritty" }, () =>
    assert.equal(detectTerminalName(), "alacritty"));
  withEnv({ TERM: "alacritty" }, () => assert.equal(detectTerminalName(), "alacritty"));
});

test("alacritty without an image protocol renders blocks by default", () => {
  withEnv({ TERM_PROGRAM: "alacritty", TERM: "alacritty", COLORTERM: "truecolor" }, () => {
    const resolved = resolve(DEFAULTS.terminals);
    assert.equal(resolved.protocol, "blocks");
  });
  // Alacritty is truecolor by definition, so the shipped entry does not depend on COLORTERM.
  withEnv({ TERM: "alacritty", COLORTERM: undefined }, () => {
    assert.equal(resolve(DEFAULTS.terminals).protocol, "blocks");
  });
});

test("the terminals that already worked keep their renderer", () => {
  withEnv({ TERM_PROGRAM: "ghostty", TERM: "xterm-256color" }, () =>
    assert.equal(resolve(DEFAULTS.terminals).protocol, "kitty"));
  withEnv({ TERM_PROGRAM: "ghostty", GHOSTTY_RESOURCES_DIR: "/usr/share/ghostty" }, () =>
    assert.equal(resolve(DEFAULTS.terminals).protocol, "kitty"));
  withEnv({ TERM_PROGRAM: "WezTerm", WEZTERM_PANE: "0" }, () =>
    assert.equal(resolve(DEFAULTS.terminals).protocol, "iterm2"));
  withEnv({ TERM_PROGRAM: "iTerm.app", ITERM_SESSION_ID: "w0t0p0" }, () => {
    const resolved = resolve(DEFAULTS.terminals);
    assert.equal(resolved.protocol, "iterm2");
    assert.equal(resolved.warning, null, "iTerm2 is supported, so it must not warn");
  });
  withEnv({ KITTY_WINDOW_ID: "1", TERM: "xterm-kitty" }, () => {
    const resolved = resolve(DEFAULTS.terminals);
    assert.equal(resolved.protocol, "kitty");
    assert.equal(resolved.warning, null, "kitty is supported, so it must not warn");
  });
  withEnv({ ZELLIJ: "0" }, () => {
    const resolved = resolve(DEFAULTS.terminals);
    assert.equal(resolved.protocol, "ascii");
    assert.equal(resolved.multiplexer, "zellij");
  });
});

test("the shipped defaults carry herdr and alacritty, in the code and in config.json", () => {
  const packageConfig = JSON.parse(readFileSync(join(root, "config.json"), "utf-8")) as {
    terminals: TerminalMapping[];
  };
  for (const terminals of [DEFAULTS.terminals, packageConfig.terminals]) {
    assert.deepEqual(terminals.find((entry) => entry.match === "herdr"), { match: "herdr", render: "auto" });
    assert.deepEqual(terminals.find((entry) => entry.match === "alacritty"), { match: "alacritty", render: "blocks" });
    // Every name detection can return has its own entry, so none of them depends
    // on pi-tui's guess or gets the "unrecognized terminal" warning.
    for (const [name, render] of [["kitty", "kitty"], ["iterm2", "iterm2"], ["ghostty", "kitty"], ["wezterm", "iterm2"]] as const) {
      assert.deepEqual(terminals.find((entry) => entry.match === name), { match: name, render });
    }
  }
});
