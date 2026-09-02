// Fire-and-forget user feedback. Kept as a window event rather than a direct
// import of the UI so the store can report a refused rename without knowing
// anything about the view layer — and so it no-ops under the test runner,
// where there is no window at all.
export function toast(message) {
  if (typeof window === 'undefined' || !message) return;
  window.dispatchEvent(new CustomEvent('toast', { detail: message }));
}
