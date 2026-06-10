/**
 * Position mapping between the two panes for scroll synchronization.
 *
 * Equal chunks exist in both documents, so their rendered positions are
 * natural alignment anchors. We measure each anchor's Y once (re-measuring
 * only on layout changes), then map any scroll position through piecewise-
 * linear interpolation between surrounding anchors — O(log n) per scroll
 * event with zero layout reads.
 */
export type AnchorMap = {
  /** Chunk indices present in both panes, in document order. */
  indices: number[];
  /** Content-space Y of each anchor in pane A / pane B. */
  aTops: number[];
  bTops: number[];
};

/** Y of an element in its scroll container's content space. */
export function contentY(container: HTMLElement, el: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

export function measureAnchors(paneA: HTMLElement, paneB: HTMLElement): AnchorMap {
  const collect = (container: HTMLElement) => {
    const tops = new Map<number, number>();
    const cTop = container.getBoundingClientRect().top;
    const scrollTop = container.scrollTop;
    for (const el of container.querySelectorAll<HTMLElement>("[data-chunk]")) {
      const raw = el.dataset.chunk;
      if (!raw) continue;
      const index = Number(raw.split("-")[1]);
      if (!tops.has(index)) {
        tops.set(index, el.getBoundingClientRect().top - cTop + scrollTop);
      }
    }
    return tops;
  };

  const mapA = collect(paneA);
  const mapB = collect(paneB);
  const indices = [...mapA.keys()].filter((i) => mapB.has(i)).sort((x, y) => x - y);
  return {
    indices,
    aTops: indices.map((i) => mapA.get(i)!),
    bTops: indices.map((i) => mapB.get(i)!),
  };
}

/**
 * Map a content-space Y from one pane to the other by interpolating between
 * the nearest anchors. Outside the anchor range, extrapolate 1:1.
 */
export function mapY(from: number[], to: number[], y: number): number {
  const n = from.length;
  if (n === 0) return y;
  if (y <= from[0]) return to[0] + (y - from[0]);
  if (y >= from[n - 1]) return to[n - 1] + (y - from[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (from[mid] <= y) lo = mid;
    else hi = mid;
  }
  const span = from[hi] - from[lo];
  const fraction = span > 0 ? (y - from[lo]) / span : 0;
  return to[lo] + fraction * (to[hi] - to[lo]);
}

/** Nearest anchor index (by chunk index distance) present in the map. */
export function nearestAnchorPosition(
  map: AnchorMap,
  pane: "a" | "b",
  chunkIndex: number,
): number | null {
  const { indices } = map;
  if (indices.length === 0) return null;
  // binary search nearest index
  let lo = 0;
  let hi = indices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (indices[mid] < chunkIndex) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [lo, lo - 1].filter((i) => i >= 0 && i < indices.length);
  const best = candidates.reduce((a, b) =>
    Math.abs(indices[a] - chunkIndex) <= Math.abs(indices[b] - chunkIndex) ? a : b,
  );
  return (pane === "a" ? map.aTops : map.bTops)[best];
}
