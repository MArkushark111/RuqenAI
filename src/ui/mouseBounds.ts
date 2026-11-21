import type { DOMElement } from 'ink';

export function mouseOrigin(element: DOMElement | null) {
  let x = 0;
  let y = 0;
  for (let node = element ?? undefined; node; node = node.parentNode) {
    if (node.style.display === 'none') return undefined;
    x += node.yogaNode?.getComputedLeft() ?? 0;
    y += node.yogaNode?.getComputedTop() ?? 0;
  }
  return element ? { x, y } : undefined;
}
