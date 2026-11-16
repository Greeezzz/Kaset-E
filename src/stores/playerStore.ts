import { create } from "zustand";
import type { PlayerState, Track } from "../types";

/**
 * State UI minimal (AGENTS.md). Ingat: Rust adalah sumber kebenaran; store ini
 * cerminan yang di-update dari event Tauri, bukan tempat logika queue/shuffle.
 */
interface PlayerStore {
  state: PlayerState;
  setTrack: (t: Track | null) => void;
  setPlaying: (p: boolean) => void;
}

const INITIAL: PlayerState = {
  track: null,
  status: "idle",
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  shuffle: false,
  repeat: "off",
};

export const usePlayerStore = create<PlayerStore>((set) => ({
  state: INITIAL,
  setTrack: (track) =>
    set((s) => ({
      state: {
        ...s.state,
        track,
        status: track ? "paused" : "idle",
        durationMs: track?.durationMs ?? 0,
        positionMs: 0,
      },
    })),
  setPlaying: (playing) =>
    set((s) => ({ state: { ...s.state, status: playing ? "playing" : "paused" } })),
}));
