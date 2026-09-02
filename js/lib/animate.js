// Plays a one-shot animation class and takes it back off once it has run.
//
// Leaving it on is not cosmetic: these animations are declared with
// `fill: both`, so their last keyframe stays applied forever — and even
// `transform: none` computes to an identity matrix rather than to `none`.
// An element with a transform becomes the containing block of every
// `position: fixed` descendant, which is how the source tooltips and the
// category dropdowns ended up anchored to the card instead of the window:
// they scrolled away with the page and parked themselves at the top of it.
export function playOnce(el, className, ms = 600) {
  if (!el) return;
  el.classList.add(className);
  const done = () => el.classList.remove(className);
  el.addEventListener('animationend', done, { once: true });
  // A background tab never fires animationend — the class has to come off
  // anyway, or that view keeps trapping its popups for good.
  setTimeout(done, ms);
}
