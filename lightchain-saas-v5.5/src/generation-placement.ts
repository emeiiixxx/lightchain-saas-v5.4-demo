import { arrangementGap } from './canvas-arrangement';
import { selectionBounds, type Bounds } from './canvas-selection';
import type { CanvasImage } from './useCanvas';

const conflicts = (a: Bounds, b: Bounds) => a.x < b.x + b.width
  && a.x + a.width > b.x
  && a.y < b.y + b.height
  && a.y + a.height > b.y;

/** R05: move the entire new batch right until clear; existing objects stay fixed. */
export function placeResultBatch(images: CanvasImage[], results: CanvasImage[]) {
  if (!results.length) return results;
  const units = new Map<string, CanvasImage[]>();
  for (const image of images) {
    const key = image.groupId ? `group:${image.groupId}` : `image:${image.id}`;
    const members = units.get(key) ?? [];
    members.push(image); units.set(key, members);
  }
  const reserved = selectionBounds(results);
  // Include every existing group, image and pending/failed result, regardless of
  // which side of the source it started on. Group interiors remain reserved.
  const obstacles = [...units.values()].map(selectionBounds);
  let placed = reserved;
  for (;;) {
    const blocking = obstacles.filter(box => conflicts(placed, box));
    if (!blocking.length) break;
    placed = {
      ...placed,
      x: Math.max(...blocking.map(box => box.x + box.width)) + arrangementGap,
    };
  }
  const dx = placed.x - reserved.x;
  return dx ? results.map(image => ({ ...image, x: image.x + dx })) : results;
}
