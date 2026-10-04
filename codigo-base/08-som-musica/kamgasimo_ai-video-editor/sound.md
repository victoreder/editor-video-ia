# Sound: voice, music and effects

## The voice

The master's voice is already cleaned (high-pass, gentle denoise, light compression) and normalised.
Nothing is ever mixed over it louder than it.

## Music

`music.mjs` resolves the bed in this order, per the user's answer:

1. **Their own file** (`--file`).
2. **The music library** (`--library "<mood words>"`): real tracks from HeyGen's free library, searched by
   the style's `music.intent` or your own words. Needs the `heygen` command line signed in (the doctor
   checks it); only the mood words are sent. Exit status 3 means unavailable; fall back to 3.
3. **Generated on this machine** (`--generate upbeat|calm|cinematic`).

It fits the track to the video (skips its silent start; fades over the last 1.5 s; loops a short track
with a crossfade) and finds its beats. The mix sets it `under` dB below the voice (the style's value:
Dynamic 13, Clean 16, Cinematic 15) and ducks it under speech.

**The margin is the check.** `mix.mjs` measures the voice over the music in every 400 ms window of
speech. The worst tenth must be at least 12 dB; if not, mix again with a larger `--under`.

## Effects

`render.mjs` cues an effect on every visible event, in the style's vocabulary, and drops a weaker cue
within 0.15 s of a stronger one:

| Event | Dynamic | Clean | Cinematic |
|---|---|---|---|
| transition | whoosh (glitch → glitch, flash → impact, light leak → long whoosh) | swoosh | long whoosh |
| hook or text-behind title | impact | impact | impact |
| a title slams, a label reveals | soft impact | chime | chime |
| a card, item or panel enters | pop | soft click | — |
| a number lands | ping | ping | ping |
| typing | typing | typing | — |
| a button press | click | soft click | — |
| a snap zoom | swoosh | — | — |
| an emoji | soft pop | — | — |

Kinds for extra `sfx` cues: `whoosh`, `whoosh-long`, `swoosh`, `pop`, `click`, `click-soft`, `impact`,
`impact-swell`, `glitch`, `glitch-long`, `glitch-soft`, `riser`, `sparkle`, `chime`, `ping`,
`notification`, `typing`, `key`, `error`. The recorded library (Pixabay licence, free for commercial
use in videos) comes with the rendering engine; each file's hit is measured, so a cue lands on its
frame. Without the engine, the same kinds are synthesised.

Add a cue only for what the picture cannot report: a `riser` whose climax is a big reveal, a `sparkle`
on a magical moment, a `notification` on a phone buzz.
