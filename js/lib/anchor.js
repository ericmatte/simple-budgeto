// Popups anchored to a table row — the source tooltip, the category dropdown
// — are positioned `fixed` so no scroll container can clip them, which also
// means they don't move an inch when the page scrolls under them. They are
// repositioned on every scroll, but once the row they point at has left the
// window there is nothing left to anchor to: the popup gets clamped against
// the edge of the viewport and hangs there, detached from its trigger. That
// is the moment to close it instead.
export function isAnchorOffscreen(rect, viewportHeight) {
  return rect.bottom <= 0 || rect.top >= viewportHeight;
}
