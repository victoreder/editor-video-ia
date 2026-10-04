import React from "react";
import { AbsoluteFill, Easing, Freeze, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "./overlays";
import { Sfx } from "./reel-overlays";

// The plumbing every reel shares, built from one reel's segments.json: the
// original-second -> edit-frame map E(), the Sequence helper, the zoom
// grammar, the speaker track with the frozen outro, and a plain end card.
// A reel written with it keeps only its beats (see src/reels/README.md);
// the self-contained src/talk/Reel.tsx is the same thing written out long.

export const FPS = 30;
type Seg = { a: number; b: number; frames: number; note?: string };
export type Push = { at: number; z: number; up?: number; until: number | "end"; down?: number };
type Spec = { outro: number; segments: unknown[] };

export const makeReel = (spec: Spec) => {
  const SEGS = spec.segments as Seg[];
  const SPEECH_FRAMES = SEGS.reduce((n, s) => n + s.frames, 0);
  const OUTRO_FRAMES = Math.round(spec.outro * FPS);
  const DURATION = SPEECH_FRAMES + OUTRO_FRAMES;
  const segStart = (i: number) => SEGS.slice(0, i).reduce((n, s) => n + s.frames, 0);

  const E = (t: number): number => {
    for (let i = 0; i < SEGS.length; i++) {
      const s = SEGS[i];
      if (t >= s.a - 1e-6 && t <= s.b + 1e-6) return segStart(i) + Math.round((t - s.a) * FPS);
    }
    throw new Error(`E(${t}): not inside any take in reel-segments.json`);
  };
  const rel = (t: number, from: number) => E(t) - E(from);
  const life = (from: number, to: number) => E(to) - E(from);

  const At: React.FC<{ from: number; to: number; children: React.ReactNode; name?: string }> = ({ from, to, children, name }) => (
    <Sequence from={E(from)} durationInFrames={E(to) - E(from)} name={name} layout="none">
      {children}
    </Sequence>
  );

  const useZoom = (snaps: [number, number][], pushes: Push[]) => {
    const f = useCurrentFrame();
    const snapFrames = snaps.map(([t, z]) => [E(t), z] as [number, number]).sort((p, q) => p[0] - q[0]);
    let base = 1;
    for (const [fr, z] of snapFrames) if (f >= fr) base = z;
    let push = 1;
    for (const p of pushes) {
      const a = E(p.at);
      const b = p.until === "end" ? DURATION : E(p.until);
      const up = p.up ?? 12;
      const down = p.down ?? 0;
      if (f < a || f >= b + down) continue;
      const rise = interpolate(f, [a, a + up], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
      const fall = down > 0 ? interpolate(f, [b, b + down], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : f < b ? 1 : 0;
      push *= 1 + (p.z - 1) * rise * fall;
    }
    return base * push;
  };

  // The chosen takes back to back, scaled by the zoom, with the last frame
  // frozen under the outro; soft taps on every snap.
  const Speaker: React.FC<{ src: string; snaps: [number, number][]; pushes: Push[]; origin: string }> = ({ src, snaps, pushes, origin }) => {
    const zoom = useZoom(snaps, pushes);
    const last = SEGS[SEGS.length - 1];
    const taps = snaps.map(([t]) => E(t)).sort((p, q) => p - q).slice(1);
    return (
      <>
        <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: origin }}>
          {SEGS.map((s, i) => {
            const from = Math.round(s.a * FPS);
            return (
              <Sequence key={i} from={segStart(i)} durationInFrames={s.frames} layout="none" name={`take ${i + 1}`}>
                <OffthreadVideo
                  src={staticFile(src)}
                  startFrom={from}
                  endAt={from + s.frames}
                  volume={(f) => interpolate(f, [0, 2, s.frames - 3, s.frames - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
                  style={{ width: "100%", height: "100%" }}
                />
              </Sequence>
            );
          })}
          <Sequence from={SPEECH_FRAMES} durationInFrames={OUTRO_FRAMES} layout="none" name="outro freeze">
            <Freeze frame={last.frames - 1}>
              <OffthreadVideo src={staticFile(src)} startFrom={Math.round(last.a * FPS)} muted style={{ width: "100%", height: "100%" }} />
            </Freeze>
          </Sequence>
        </AbsoluteFill>
        {taps.map((fr) => (
          <Sfx key={`snap-${fr}`} at={fr} src="tap.wav" vol={0.22} />
        ))}
      </>
    );
  };

  const Outro: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Sequence from={SPEECH_FRAMES} durationInFrames={OUTRO_FRAMES} layout="none" name="end card">
      {children}
    </Sequence>
  );

  return { E, rel, life, At, Speaker, Outro, DURATION };
};

// An end card for a reel that is not about a repo: the speaker's name, one
// line (\n breaks it where you choose), and a URL under the card. The
// GitHubCard / EndCard pair in reel-overlays.tsx is for the repo case.
export const TextEndCard: React.FC<{ name: string; line: string; url?: string; size?: number }> = ({ name, line, url, size = 62 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 14, stiffness: 150, mass: 0.8 } });
  const dim = interpolate(f, [0, 12], [0, 0.55], { extrapolateRight: "clamp" });
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${dim})` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 26, fontFamily: FONT, opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
        <div style={{ background: "rgba(255,255,255,0.97)", color: "#111", borderRadius: 30, padding: "44px 50px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)", textAlign: "center", width: 900, boxSizing: "border-box" }}>
          <div style={{ fontSize: 34, color: "#666", fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>{name}</div>
          <div style={{ fontSize: size, fontWeight: 800, letterSpacing: -2, lineHeight: 1.08, marginTop: 18, whiteSpace: "pre-line" }}>{line}</div>
        </div>
        {url ? <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 34, fontWeight: 600, letterSpacing: 1 }}>{url}</div> : null}
      </div>
    </>
  );
};
