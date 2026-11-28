import { describe, it, expect } from "vitest";
import { mixPlaylists } from "./mixPlaylist";
import type { Track } from "../types";

const makeTrack = (id: string, title: string): Track => ({
  videoId: id,
  title,
  artist: "Artist",
  durationMs: 180000,
});

describe("mixPlaylists", () => {
  const p1 = [makeTrack("1", "Song 1"), makeTrack("2", "Song 2"), makeTrack("3", "Song 3")];
  const p2 = [makeTrack("4", "Song 4"), makeTrack("5", "Song 5")];

  it("mencampur secara interleaved (bergantian)", () => {
    const res = mixPlaylists([p1, p2], "interleaved");
    expect(res.map((t) => t.videoId)).toEqual(["1", "4", "2", "5", "3"]);
  });

  it("mencampur secara sequential (bersambung)", () => {
    const res = mixPlaylists([p1, p2], "sequential");
    expect(res.map((t) => t.videoId)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("mencegah lagu duplikat", () => {
    const duplicateList = [makeTrack("1", "Song 1"), makeTrack("6", "Song 6")];
    const res = mixPlaylists([p1, duplicateList], "interleaved");
    expect(res.map((t) => t.videoId)).toEqual(["1", "2", "6", "3"]);
  });

  it("mencampur dengan shuffle", () => {
    const res = mixPlaylists([p1, p2], "shuffle");
    expect(res.length).toBe(5);
    expect(new Set(res.map((t) => t.videoId)).size).toBe(5);
  });
});
