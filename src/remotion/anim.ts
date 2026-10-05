import {Easing, interpolate, spring} from 'remotion';

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** envelope de entrada (spring) e saída (fade) para um elemento de `life` frames */
export function envelope(frame: number, fps: number, life: number, outFrames = 8) {
  const enter = spring({frame, fps, config: {damping: 14, stiffness: 170, mass: 0.7}});
  const exit = life > outFrames + 2 ? interpolate(frame, [life - outFrames, life], [1, 0], {...clamp, easing: Easing.in(Easing.cubic)}) : 1;
  return {enter, exit, alpha: Math.min(Math.min(1, enter * 1.4), exit)};
}

export const pop = (frame: number, fps: number, delay = 0) => spring({frame: frame - delay, fps, config: {damping: 11, stiffness: 220, mass: 0.6}});

export const easeOut = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
