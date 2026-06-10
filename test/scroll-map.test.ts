import { describe, expect, it } from "vitest";
import { mapY, nearestAnchorPosition, type AnchorMap } from "../lib/diff/scroll-map";

describe("mapY", () => {
  const from = [0, 100, 200, 1000];
  const to = [0, 300, 350, 2000];

  it("maps exactly at anchors", () => {
    expect(mapY(from, to, 100)).toBe(300);
    expect(mapY(from, to, 200)).toBe(350);
  });

  it("interpolates linearly between anchors", () => {
    expect(mapY(from, to, 50)).toBe(150); // halfway 0..100 -> halfway 0..300
    expect(mapY(from, to, 600)).toBe(1175); // halfway 200..1000 -> halfway 350..2000
  });

  it("extrapolates 1:1 outside the anchor range", () => {
    expect(mapY(from, to, -50)).toBe(-50);
    expect(mapY(from, to, 1100)).toBe(2100);
  });

  it("handles empty and degenerate maps", () => {
    expect(mapY([], [], 123)).toBe(123);
    expect(mapY([100, 100], [200, 400], 100)).toBe(200);
  });
});

describe("nearestAnchorPosition", () => {
  const map: AnchorMap = {
    indices: [2, 5, 9],
    aTops: [10, 50, 90],
    bTops: [15, 55, 95],
  };

  it("returns the exact anchor when present", () => {
    expect(nearestAnchorPosition(map, "a", 5)).toBe(50);
    expect(nearestAnchorPosition(map, "b", 5)).toBe(55);
  });

  it("returns the nearest anchor by chunk distance", () => {
    expect(nearestAnchorPosition(map, "a", 3)).toBe(10); // 3 is closer to 2 than 5
    expect(nearestAnchorPosition(map, "a", 8)).toBe(90); // 8 closer to 9
    expect(nearestAnchorPosition(map, "a", 100)).toBe(90);
  });

  it("returns null for an empty map", () => {
    expect(
      nearestAnchorPosition({ indices: [], aTops: [], bTops: [] }, "a", 1),
    ).toBeNull();
  });
});
