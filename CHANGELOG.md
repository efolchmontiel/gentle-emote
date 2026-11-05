# Changelog

All notable changes to gentle-emote will be documented in this file. Entries before v0.1.0 belong to [pi-emote](https://github.com/cgxeiji/pi-emote), the upstream project.

## Unreleased

### Fixed
- **herdr** — detected as the pane layer it is. The renderer now comes from the terminal outside herdr instead of pi-tui's claim, so herdr over a terminal without images no longer draws nothing in silence.
- **Alacritty** — ships an explicit `blocks` renderer instead of an implicit ASCII fallback, and the state table no longer implies Alacritty can show images.

### Added
- **`blocks` renderer** — `"render": "blocks"` draws the shipped PNG frames as 24-bit color `▀` half-blocks, for truecolor terminals without an image protocol.
- **Fallback warning** — when the avatar cannot use images, the session says so once, with the exact `terminals` override to set.

## gentle-emote v0.1.4

### Fixed
- **Super YOLO** — Gentle Shell's `super-yolo` mode rests on the sun. `yolo` mode keeps the rocket. `read()` reports ON for both, so the mode is what picks the picture.
- **Yes/No** — a confirm such as `Allow guarded git push?` keeps the ask picture on top of whatever execution is running, and returns to that execution when the prompt closes.
- **Grandma wake** — coming back from the grandma waves. The propeller beanie plays only when the session starts.

## gentle-emote v0.1.3

### Changed
- **Mouths** — smiles and open mouths are a dark curve with a tongue. The mustache used to hide every tooth except one pixel in the middle.
- **Hi** — he flies in under a propeller beanie, lands, takes it off and waves.
- **Think** — a light bulb above his head switches on.
- **Talk** — the streamer scene (headphones, podcast mic, ON AIR). A copy is kept in `docs/archive/talk-streamer/`.
- **Read** — deerstalker, pipe and magnifying glass.
- **Remember** — he cups a hand over his mouth and whispers into the Engram elephant's ear. The rim follows the accent color.
- **Build** — welding mask and torch.
- **Delegate** — football coach and exercising robots.
- **Explore** — backpack, three steps, and a flashlight on footprints.
- **Verify** — police officer. A green stamp lands on the robot. A failed verify tool holds a red stamp.
- **Jira** — he launches a rocket into a cloud.
- **Compact** — he shrinks in place. The shirt stays black.
- **Super YOLO** — the YOLO character with a sun instead of the rocket. Preview it with `/emote super-yolo`.

## gentle-emote v0.1.2

### Changed
- **Talk scene** — the Gentleman is now live on stream: headphones, a podcast mic and an ON AIR sign that lights up while he speaks.
- **Talk ends with the reply** — the scene stops half a second after the text finishes streaming instead of "reading" the reply at `readingSpeed`.
- **YOLO in every scene** — a generated `gentleman-yolo` twin set (sunglasses and headband) is swapped in the moment YOLO turns on or off, whatever he is doing. Custom sets can ship their own `<set>-yolo` twin.
- **Grandma sooner** — `grandmaAfterMs` defaults to 30 seconds.

### Fixed
- **Subagent scenes** — `explore`, `build`, `verify`, `judge`, `review` and `jira` changed state without showing any frame.

## gentle-emote v0.1.1

### Fixed
- **Unknown emote set** — a misspelled or missing set now falls back to the Gentleman instead of the removed `default` set, which left no avatar.

### Docs
- **Create your own avatar** — README guide for frames, `emotes.json`, accent key colors, install paths and per-model mapping.
- The state gallery moved from the README to `docs/gallery.md`.

## gentle-emote v0.1.0

### Added
- **Gentleman avatar** — code-generated pixel-art set (`npm run sprites`) with 23 states; the rose and the YOLO headband follow the accent color.
- **Framed avatar beside the prompt** — kitty Unicode placeholders in a rounded frame to the left of the editor; the prompt grows to the frame height (`frame`, `frameRows`).
- **Gentle Shell scenes** — subagents (`delegate`, plus `explore`, `build`, `verify`, `judge`, `review`, `jira` picked from the agent name), background jobs (`jobs`), Engram `mem_save` (`remember`) and a read-only YOLO mode look (`yolo`).
- **Grandma and farewell** — turns into a knitting grandma after `grandmaAfterMs` idle; tips the hat on a goodbye prompt (`farewellPattern`).
- **`/emote` command** — preview any state or play `/emote demo`.

### Removed
- Upstream image sets (`default`, `red`, `aza_choi`, `test`) and the status/theme widget.

## v0.3.0

### Added
- **Multi-line ASCII emotes** — ASCII frames now support 8×4 multi-line canvas with ANSI color codes. Frames can be defined as arrays of strings in `ascii.yaml`.
- **`ascii-bot` emote set** — colored ASCII robot with ANSI green body and yellow eyes. Uses multi-line 8×4 format.
- **ANSI escape support in YAML** — `\x1b`, `\e`, `\n`, `\t`, `\r` escape sequences are now processed in double-quoted strings.
- **Automatic ASCII fallback** — when terminal doesn't support images and configured emote set is image-only, automatically falls back to `ascii-bot`.
- **Thinking level emote mapping** — emote set resolution now matches on thinking level as well as model ID. Entries accept a `thinking-level` selector (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`); unset selectors default to `*`, an entry matches when **all** of its selectors match, and last match wins. Emote sets re-resolve live on thinking level changes.
- **Colored info lines** — new `theme` config section colors the info panel: `model-name`, `progress-bar` (default/cache-hit/cache-miss/almost-full), `token-info`, `working-directory`, `border`, and `vertical-separator`. Values are pi theme color tokens or the special `thinking-level-color` flag, which follows the current thinking level's color live. All colors update live when pi's theme changes.
- **Warp terminal support** — new `warpterminal` entry in the terminals config, rendering with the Kitty image protocol.

### Changed
- **ASCII renderer canvas** — fixed 8×4 canvas (8 cols × 4 rows) instead of single-line kaomoji. Frames are vertically centered.
- **YAML parser extended** — supports nested arrays (`string[][]`) for multi-line cycling frames and named multi-line frames.

### Fixed
- **Kitty ghost image artifacts** — previous kitty placements are deleted before re-rendering, since kitty images live on a separate display layer not cleared by `\x1b[2K`.

## v0.2.10

### Added
- **Context usage progress bar** — Visual 20-segment bar with eighth-block granularity. Cache (░) and input (█) portions are shown per segment; input wins when both occupy the same bin.
- **Cache hit rate** — Per-message cache ratio shown in the stats line (⇞).
- **Working directory** — Current directory displayed below stats, shortened with `~`.
- **Token count in bar** — Raw token count displayed alongside percentage.

### Changed
- **Info panel restructured** — Merged thinking level and context window into the model line. Progress bar, cumulative stats (↑↓ cache% $cost), and working directory replace the old context/tokens/cost layout.
- **`formatTokens` uses uppercase `K`** — Kilo suffix now uppercase for consistency.
- **Empty bin char** — Changed from `-` to space for a cleaner look.

## v0.2.9

### Added
- **Red emote**

### Changed
- **hideBelow default to 40** — Fit all content in narrow terminals by default.
- **claude emote** — Claude family of models show red emote by default.

## v0.2.8

### Fixed
- **ASCII YAML escape sequences** — `\"` and `\\` in `ascii.yaml` double-quoted strings are now correctly decoded (e.g. `think hard` and `tool` frames in the default set).

## v0.2.7

### Added
- **Multiple ASCII emote sets** — ASCII sets now use the same resolution/lookup machinery as image sets. Each set is a directory with an `ascii.yaml` file.
- **`ascii-bear` emote set** — bear kaomoji (`ʕ•̫͡•ʔ`) by [@LCorleone](https://github.com/LCorleone).
- **Auto-switch to AsciiRenderer** — sets with `ascii.yaml` but no image frames automatically use the ASCII renderer regardless of terminal capabilities.

### Changed
- **tmux default changed to `"auto"`** — tmux + Ghostty now gets `kitty-unicode` images automatically without user configuration. Other outer terminals still fall back to ASCII.
- `emotes/ascii/fallback.yaml` renamed to `emotes/ascii/ascii.yaml`.
- Removed `setName === "ascii"` special case — ASCII sets are now resolved through the standard emote set lookup.

## v0.2.6

### Added
- **TmuxKittyUnicodeRenderer** — pane-safe image rendering through tmux using kitty Unicode placeholders (U+10EEEE). Images stay within their pane and clean up on session switch.
- **`"kitty-unicode"` render value** — new option for terminals config. Auto-selected for Ghostty/kitty through tmux.
- **`"placeholder"` frame kind** — new RenderedFrame variant for text-based image display.

### Changed
- **tmux auto-detection** — `"auto"` now resolves to `kitty-unicode` for Ghostty/kitty (pane-safe), ASCII for iTerm2/WezTerm (no pane-safe renderer available).
- **All tmux rendering is experimental and opt-in** — default remains ASCII. Users opt in via `{ "match": "tmux", "render": "auto" }` in their config.
- Classic `"kitty"` and `"iterm2"` DCS passthrough renderers remain available for single-pane setups.

### Fixed
- **Multiplexer routing bug** — concrete render values (e.g., `"ascii"`) from extension defaults were being ignored, falling through to auto-detection.

## v0.2.5

### Changed
- **Multiplexer defaults reverted to ASCII** — tmux/zellij/screen default to `"ascii"` pending renderer fix. Users can opt in to image rendering with `{ "match": "tmux", "render": "auto" }` in their config.

## v0.2.4

### Added
- **tmux passthrough rendering** — image avatars now work through tmux using DCS passthrough. Auto-detects outer terminal via `tmux show-environment TERM_PROGRAM`.
- **TmuxKittyRenderer** — Kitty protocol through tmux (Ghostty, kitty).
- **TmuxITermRenderer** — iTerm2 protocol through tmux (iTerm2, WezTerm).
- **`"auto"` render value** — new option for terminal config entries. Multiplexers use it by default to auto-detect passthrough support and outer terminal.
- **`src/tmux.ts`** — tmux-specific logic: passthrough check, outer terminal detection, DCS wrapping.
- **Multiplexers section** in README with tmux setup instructions.
- **tmux Requirements section** in AGENTS.md with full auto-detection flow.

### Changed
- `resolveRenderer()` returns a `ResolvedRenderer` object (protocol, multiplexer, warning) instead of a plain string.
- `loadLayeredConfig()` returns `{ config, userConfiguredTerminals }` to track explicit user overrides.
- Multiplexer warnings are suppressed when the user explicitly configures a concrete render value.
- Widget supports `padMode: "skip"` for tmux iTerm2 layout (cursor-right instead of spaces on image row).

## v0.2.3

### Added
- **Configurable terminal renderer whitelist** — override image protocol per terminal via `terminals` config array.
- **Community emote sets** — `aza_choi` and `aza_choi_nobg` by [@shennguyenrs](https://github.com/shennguyenrs) (#3).
- **Gallery section** in README showcasing available emote sets.

### Fixed
- **Config merge semantics** — emote entries now correctly append across config layers; terminal entries merge by `match` key.

## v0.2.2

### Fixed
- **Image row overflow** — row calculation now uses the same column count as the actual render, fixing avatar bleeding into content below.
- **Vertical centering** — Kitty renderer uses pixel-level `Y` offset to center the image within its allocated rows, independent of font/cell dimensions.
- **Consistent sizing** — image width, row calculation, and widget padding all use `config.size` consistently (removed off-by-one from `size + 1`).
- Custom Kitty escape sequence builder replaces pi-tui's `encodeKitty`, enabling protocol params (`Y` offset) not exposed by the library.

## v0.2.1

### Added
- **ASCII fallback renderer** — terminals without image support (tmux, Alacritty, VSCode, etc.) now show text-based emotes instead of nothing.
- ASCII emote frames defined in `emotes/ascii/fallback.yaml`.
- Config support for `"emote-set": "ascii"` to force ASCII mode on any terminal.
- Warning notification via `ctx.ui.notify` when falling back to ASCII.

### Changed
- **Renderer architecture split** — rendering logic separated by protocol:
  - `render_kitty.ts` — Kitty graphics protocol (Kitty, Ghostty, WezTerm).
  - `render_iterm.ts` — iTerm2 inline image protocol.
  - `render_ascii.ts` — plain text fallback.
  - `render_image.ts` — shared base class for image renderers.
  - `renderer.ts` — `Renderer` interface and `RenderedFrame` type.
- `animator.ts` is now a pure state machine, delegates all rendering to the `Renderer` interface.
- `widget.ts` handles image, text, and protocol-specific frame rendering.

### Fixed
- Package imports updated from `@mariozechner/*` to `@earendil-works/*`.
- **iTerm2 inline image rendering** — text-first/image-last strategy prevents ghost
  images and `\x1b[2K` erasure artifacts. Uses `preserveAspectRatio` with auto height
  for correct proportions.
- **Kitty image aspect ratio** — no longer forces row count, letting Kitty auto-size
  height to preserve correct proportions.
- Image width increased by 1 cell for better visual sizing in both protocols.
- I/O token stats (`↑input ↓output`) now shown even when zero.

## v0.2.0

Initial alpha release.

- Animated pixel-art emote widget displayed above the editor.
- State machine: hi, idle, think, talk, read, write, tool, success, failure, compact.
- Idle blinking and think swap animations.
- Talk mouth animation synced to token stream with reading-speed pacing.
- Cycling animations for read/write/tool states.
- Per-model emote set selection via glob patterns in config.
- Layered configuration (extension defaults → user global → project local).
- Emote set lookup across project, user, and extension directories.
- Optional `emotes.json` per set for frame configuration (idle/blink, think/hard, talk weights).
