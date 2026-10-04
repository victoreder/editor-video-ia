# Platforms: formats, safe zones, delivery

## Formats

| Format | Size | For |
|---|---|---|
| `vertical` | 1080×1920 (9:16) | TikTok, Instagram Reels, YouTube Shorts, Stories |
| `portrait` | 1080×1350 (4:5) | Instagram and Facebook feed, LinkedIn feed |
| `square` | 1080×1080 (1:1) | feeds, X |
| `landscape` | 1920×1080 (16:9) | YouTube, LinkedIn, websites |

A recording is never stretched: each format is a crop of it, framed on the speaker. A vertical
recording makes no landscape version.

## Safe zones

The apps draw their own buttons, names and descriptions over the video. Nothing that must be read goes
there. The composer holds captions and titles inside these lines (fractions of the height):

| Format | Top | Bottom | Also |
|---|---|---|---|
| vertical | 0.10 | 0.80 | keep text out of the right 12 % (TikTok and Reels buttons) |
| portrait | 0.07 | 0.84 | — |
| square | 0.06 | 0.86 | — |
| landscape | 0.06 | 0.90 | — |

These are conservative lines drawn from the apps' current layouts; when a platform changes its
interface, move them in `scripts/compose.mjs` → `FORMATS`.

## Delivery

- H.264, yuv420p, the master's frame rate; AAC stereo at 48 kHz.
- Loudness −14 LUFS integrated, true peak at or below −1.5 dBTP, measured on the delivered file.
- A thumbnail (1280×720) for YouTube and a cover (1080×1920) for Shorts, Reels and TikTok.
- The subtitle file (`.srt`) for platforms that take one: upload it rather than relying on their
  automatic captions.
