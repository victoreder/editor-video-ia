# The edit plan (`edit.json`)

The plan is what the finished video does, beat by beat. `edit-plan.mjs draft` writes a complete one;
you refine it; `edit-plan.mjs check` validates it; `render.mjs` builds every format from it. All times
are seconds on the output timeline (the master's). Paths are relative to the work folder.

## Top level

| Field | Is |
|---|---|
| `style` | `dynamic`, `clean` or `cinematic` (`assets/styles/<id>.json`) |
| `brand` | `{ accent?: "#hex", font?: "Montserrat" }` — overrides the style |
| `fps`, `duration` | of the master |
| `formats` | any of `vertical` (1080×1920), `portrait` (1080×1350), `square` (1080×1080), `landscape` (1920×1080) |
| `source`, `aroll`, `words`, `track`, `face` | the graded A-roll, the master's aligned words, the speaker track, the face point |
| `captions` | `{ file, emphasis: [word start times], emoji: [{ at, char }], hide: [[from, to]] }` |
| `sections` | topic starts; each carries a transition |
| `beats` | the beats, tiling 0 → duration without gaps |
| `hook` | `{ title: "LINE ONE\|LINE TWO", until: 1.8 }` |
| `cta` | `{ text, icon, at }` — the call to action near the end |
| `progress` | `true` for a progress bar |
| `grade` | `punchy`, `clean` or `film`: the vignette follows it, and `film` adds moving grain |
| `music` | `{ file, info }` — the fitted bed and its beats |
| `notes` | the draft's opportunities and to-do list, for you |

## A beat

```json
{
  "id": "b03", "start": 9.68, "end": 16.4, "layout": "split",
  "camera": [{ "at": 9.68, "zoom": 1.2, "to": 1.25, "over": 3 }, { "at": 12.72, "zoom": 1 }],
  "effects": [{ "at": 12.1, "kind": "shake" }],
  "graphic": { "component": "cards", "at": 9.68, "until": 16.4, "props": { "title": "YOU CAN…", "items": [] } },
  "broll": { "file": "broll/b03.mp4", "at": 10, "until": 13, "from": 2.5 },
  "textBehind": { "text": "AI", "at": 1, "until": 2.4 },
  "sfx": [{ "at": 14.2, "kind": "sparkle" }],
  "transition": { "kind": "zoom" }
}
```

| Field | Is |
|---|---|
| `layout` | `full`, `overlay`, `split`, `pip`, `cutaway` (reference/graphics.md) |
| `camera` | zoom moves: `{ at, zoom }` sets a level; `{ at, zoom, to, over }` pushes; `{ at, zoom, snap: true }` snaps in fast. Zoom is 1 or more — the picture always fills the frame. A push ends where the next move begins |
| `effects` | `shake`, `flash-hit`, `rgb-pulse`, each `{ at, kind }` |
| `graphic` | `{ component, props }` or `{ scene }`, with `at`/`until` inside the beat |
| `broll` | a clip or an image (Ken Burns) over the beat's box: `file`, `at`, `until`, `from` (offset into the clip) |
| `textBehind` | a title behind the speaker; `cutouts.mjs` makes the cut-out and fills in `cutout`, `cutoutStart`, `cutoutEnd` |
| `sfx` | extra cues `{ at, kind, gain? }` (kinds in reference/sound.md) — the visible events already have theirs |
| `transition` | into the next beat, at this beat's end: `whip` (`direction: left \| right`), `slide`, `zoom`, `flash`, `glitch`, `light-leak`, `dip`, `cut` |

## What the composer guarantees

- **The picture fills the frame** in every format and layout: the speaker is scaled to cover, zooms go
  in only, and a layout never shows past the recording's edge.
- **The speaker is framed on the face**, following the track: the frame holds still until the head
  moves past a dead zone, then eases to it.
- **Captions** sit at the style's height, moved down below the lowest point the mouth reaches during
  each chunk (zoom included), never below the platform's safe line; at the seam of a split.
- **On landscape, an overlay and the hook sit beside the face**, on the wider free side at the deepest
  zoom of the beat; a beat with no room there becomes a split, with a warning.
- **The hook title leaves when the first panel, overlay, picture in picture, cutaway or B-roll
  opens**, and is left out, with a warning, when that comes too soon to read it.
- **The call to action never covers the speaker or the captions**: during a panel beat it takes the
  panel over as an end card, so a scene in that beat peaks before `cta.at`.
- **Two panel beats in a row share one panel**: the first's content leaves, the second's arrives, and
  the panel neither closes nor opens again between them.
- **Every visible event is reported** (`compose-<format>/compose.json`): transitions, entrances,
  reveals, snaps, presses — `render.mjs` cues a sound on each.
