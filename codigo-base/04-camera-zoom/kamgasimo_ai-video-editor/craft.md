# Craft: what makes an edit look made by an editor

A viewer decides in the first second whether to keep watching, and within ten whether someone skilled
made this. These are the rules the edit plan is held to. `edit-plan.mjs check` measures the ones that
can be measured; the rest are judged on the review sheets.

## The hook: the first 1.5 seconds

- **Something moves on frame 1.** The draft starts on a slow push; never open on a still frame.
- **Say what the viewer gets, on screen, at once.** A hook title of 2 to 6 words, set from what the
  speaker promises: `hook.title`, two lines split by `|`, the second in the key colour. Write it as a
  claim or a question the video answers, not as a label ("WHAT CAN AI | DO FOR YOU?", not
  "INTRODUCTION").
- **Text behind the speaker** makes a strong opening when there is room above the head. The composer
  measures that room and refuses a title that would hide behind the head.
- **Land the opening on a hit.** An impact on the title; the music comes in under it.

## Pacing: keep the eye busy, never the ear

- **Every cut gets a camera change.** A jump cut with no change in framing looks like a mistake; the
  same cut with a change in zoom looks like a second camera. The draft does this at every cut.
- **Something changes on screen every 2–4 s in Dynamic** (5–7 s in Clean, 7–9 s in Cinematic): a camera
  level, a graphic, B-roll, a caption emphasis, a sticker. `check` reports the longest still stretch.
- **Pauses are already tight.** Do not add effects to fill a pause; the cut already removed it.

## Graphics earn their place

A graphic appears because the words carry something it can show:

| The words carry | Show | Component |
|---|---|---|
| a list ("code, videos, editing") | each item as it is named | `cards` (with bodies), `list` |
| a number ("10x", "$3,000") | the number counting up to it | `stat`, `chart` |
| a before/after, a contrast | both sides, the winner marked | `compare` |
| a process ("first… then…") | the steps, joined as they are said | `steps` |
| one big idea ("AI", "growth") | one hero icon | `icon` |
| a claim to remember | the words, set large | `quote`, `title` |
| a product, an app, a result | the interface doing it | `ui` (chat, code, browser, phone) |
| a person or a source | name and role | `lowerthird` |

- **A sentence with none of these stays on the speaker.** A greeting, an aside, a transition: speaker
  only. Graphics on every sentence leave nothing emphasised; the style's coverage range is the budget.
- **Every element lands on its word, up to two frames early.** Anticipation reads as sync; lateness
  reads as a mistake. Give every item a `word`; `check` flags items without one and words not spoken
  while the graphic shows.
- **Give the key beats bespoke scenes** (reference/graphics.md, "Custom scenes"): the hook's promise,
  each core idea, the payoff — at least one graphic beat in three, and most of them in a Short.
  Components carry the rest. A video made only of stock components looks templated; the bespoke beats
  are what viewers remember. `check` counts them.

## Emphasis, captions and emoji

- **One emphasised word per caption chunk at most**, and only a word that carries meaning: a number, a
  name, a strong word. Never "things", "really", "going".
- **An emoji only on a concrete word it depicts** (money 💰, fire 🔥, rocket 🚀), at most one every 8 s in
  Dynamic, none in Clean or Cinematic. Emoji spam is the fastest tell of an automatic edit.
- **Captions never cover the mouth, and never sit in a platform's interface zone.** The composer places
  them below the lowest point the mouth reaches while they show; it warns when the mouth sits too low.

## Transitions and effects are motivated

- **Transitions only where the topic changes**, never on every cut: about one per 8–14 s at most, per
  the style. A whip or zoom for energy, a flash for a reveal, a glitch for tech, a light leak or dip for
  a mood change.
- **Effects mark a moment**: a shake on an impact word, a flash on a reveal, an RGB pulse on a glitch
  word. One effect per moment; never stacked.
- **Snap zooms go on the words that matter**, not on a timer. The draft places them on emphasised
  strong words, spaced by the style.

## Sound

- **The voice is never beaten.** The mix measures the voice over the music while speaking; the worst
  tenth must stay at or above 12 dB (reference/sound.md).
- **Every visual event has a sound, in the style's vocabulary.** Transitions whoosh, titles hit, cards
  pop, buttons click. The render cues these itself; add `sfx` only for moments it cannot see.

## Anti-AI tells, each with its check

| Tell | Check |
|---|---|
| Everything animates the same way, at the same speed | vary within the style's two or three motions; mix entrances |
| B-roll that is generic or does not match the words | stock only for concrete nouns; your folder first; motion graphics otherwise |
| Emoji on every line | the emoji budget |
| An effect on every cut | transitions only at sections; effects only on marked moments |
| Music over the voice | the measured margin |
| Misspelled names in captions | the glossary and `--fix` corrections |
| Text under the apps' own buttons | the safe zones (reference/platforms.md) |
| A caption or sticker on the mouth | the composer's placement, and the review sheets |
| Graphics that arrive late | word landings, and `check` |
| A dead first frame | the opening push and the hook |

## Style presets

| Preset | Pacing | Captions | Graphics | Camera | Transitions | Sound |
|---|---|---|---|---|---|---|
| Dynamic creator | a change every 2–4 s | bold uppercase, keyword colour, rare emoji | 40–85 % of the time | levels at every cut, snaps on strong words | whip, zoom, flash, glitch at topics | dense effects, upbeat bed |
| Clean premium | every 5–7 s | sentence case, soft underline | 15–35 %, refined | gentle levels, slow pushes | slide, dip, zoom | few, soft effects, calm bed |
| Cinematic | every 7–9 s | small, low, no highlight | 8–25 %, lower thirds and titles | slow pushes | light leak, dip | sparse, ambient bed, film grade |
| Minimal | the clean cut | Pillow captions | none | punch-ins | none | voice only |
