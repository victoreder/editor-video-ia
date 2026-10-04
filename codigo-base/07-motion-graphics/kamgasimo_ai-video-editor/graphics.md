# Graphics: the component library and custom scenes

A beat's graphic is either a **component** (`beats[].graphic.component` with `props`) or a **custom
scene** (`beats[].graphic.scene`, an HTML file you write). Both render into the beat's layout box —
the top panel of a split on vertical, the right half on landscape, the upper area on an overlay, the
whole frame on a cutaway — and must fit any box: lay out from the box, never for one format.

Every graphic has `at` and `until` (seconds, output timeline, inside its beat). Items land on their
`word` — the first time that word is spoken while the graphic shows.

## Components

| Component | Shows | Key props |
|---|---|---|
| `cards` | 2–6 cards arriving on their words; dashed placeholders wait for them; a card can carry a living body | `title`, `items: [{ label, icon, word, color?, body? }]` — body: `code`, `video`, `likes`, `timeline`, `chart`, `chat`, `money`, `check` |
| `title` | 1–3 kinetic lines, on dark pills over the speaker | `lines: [{ text, word?, color?: "key" }]`, `variant: slam \| rise \| type`, `kicker?`, `icon?` |
| `list` | items building on their words, the current one lit | `title?`, `items: [{ text, word, icon? }]`, `marker: number \| check \| icon` |
| `stat` | a number counting up to land on its word | `value`, `prefix?`, `suffix?`, `label?`, `word`, `ring?` (percentage), `decimals?` |
| `icon` | one hero icon (or a short badge) with pulsing rings, and a label that slams in | `icon` or `badge`, `label?`, `word?` (label), `tileWord?` |
| `compare` | two sides, a VS or arrow, the winner marked | `left`/`right: { title, icon?, points?, word? }`, `join: vs \| arrow`, `winner?` |
| `steps` | numbered steps joined by a line that draws between them | `items: [{ text, word, icon? }]`, `title?` |
| `quote` | the words, revealed as spoken, highlights in the key colour | `text`, `highlight?`, `author?` |
| `chart` | bars rising, or a line drawing itself upward to a label | `kind: bar \| line`, `items` (bars) or `values` (line), `highlight?`, `endLabel?`, `word?` |
| `ui` | an interface acting out the words | `screen: chat \| code \| browser \| phone`, `items`, `url?`, `headline?` |
| `lowerthird` | a name and role | `name`, `role`, `word?` |
| `sticker` | an emoji, icon badge or tag slapped on beside the face | `emoji` \| `icon` \| `text`, `word`, `x`, `y` (0–1 of the box), `rotate?` |
| `confetti` | a seeded burst — once per video at most | `word`, `x?`, `y?` |

Icons are Lucide names (`assets/icons/lucide.json`; search concepts in `assets/icons/tags.json`, for
example `grep -o '"[a-z-]*":\[[^]]*"money"' assets/icons/tags.json`).

## Choosing the layout

| Layout | The speaker | Use for |
|---|---|---|
| `full` | fills the frame | sentences that stay on the speaker; stickers |
| `overlay` | fills the frame, a graphic in the upper area — beside the face on landscape | titles, short stats, reveals |
| `split` | moves to the lower part (vertical) or left half (landscape) | cards, lists, charts, UI — anything with detail |
| `pip` | a circle in the corner, the graphic fills the frame | a graphic that needs the whole frame while the voice stays personal |
| `cutaway` | hidden; the voice continues | B-roll and full-frame graphics, briefly |

Keep the speaker on screen most of the time: viewers stay for the person.

## Custom scenes

For the key beats, write a scene: an HTML file in the work folder, referenced as
`"graphic": { "scene": "scenes/b03.html", "at": 9.7, "until": 16.4 }`. The composer inlines it,
replaces `#SCENE` with the scene's container id, and runs its script with these helpers:

| Helper | Is |
|---|---|
| `tl` | the paused GSAP timeline; add tweens at absolute times |
| `T0`, `T1` | when the scene shows |
| `at(s)` | `T0 + s` |
| `word('code')` | when that word is spoken during the scene (null if it is not) |
| `box` | `{ w, h }` of the container |
| `$('.x')` | a selector scoped to the scene |

```html
<style>
  #SCENE .chip { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%);
    font: 900 120px/1 "Montserrat"; color: #fff; opacity: 0; }
</style>
<div class="chip">AI</div>
<script type="text/scene">
  tl.fromTo($('.chip'), { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)' }, word('ai') - 0.08);
</script>
```

Rules the engine enforces (its lint runs on every render):

- **Animate transforms and opacity**, never `left`, `top`, `width` or `height`.
- **Everything is decided by time.** No `Date.now()`, no unseeded random, no network, no infinite repeats.
  Counters and typing use `onUpdate` on a tween.
- **Scope every rule with `#SCENE`**; class names like `.cap`, `.frame`, `.cam`, `.panel` belong to the
  composition.
- **Fit the box.** Size from `box.w`/`box.h` or container units — a factor such as
  `Math.min(box.w / 1080, box.h / 902)` scales a scene designed at the vertical panel's size — and in a
  split keep the bottom tenth clear of anything that must be read: the captions sit on the seam. Test
  the scene on every format.
- **Palette and fonts from the style** — the fonts loaded are the style's (Montserrat, Inter, Anton,
  Playfair Display, JetBrains Mono).

Design for the scene the way the component library does: generous space, one focal element, colour
from the palette, glow and depth on dark panels, motion that settles.
