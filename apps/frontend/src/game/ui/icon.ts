import { createElement } from "lucide";

type IconNode = Parameters<typeof createElement>[0];

/** Render a Lucide icon as a sized inline SVG (stroke = currentColor). */
export function icon(node: IconNode, size = 16): SVGElement {
  const el = createElement(node);
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("stroke-width", "2.25");
  el.classList.add("icon");
  return el;
}
