import { Picker } from '/node_modules/emoji-mart/dist/module.js';
import { currentTheme } from './theme.js';

let activeClose = null;
let dataPromise = null;

function loadData() {
  if (!dataPromise) dataPromise = fetch('/node_modules/@emoji-mart/data/sets/15/native.json').then(r => r.json());
  return dataPromise;
}

export function closeEmojiPicker() {
  if (activeClose) activeClose();
}

// The picker eats its own Escape, in the capture phase: anything else
// listening for Escape (the palette it can be opened from) has to stand down
// while it is up, or one keypress closes both.
export function isEmojiPickerOpen() {
  return activeClose !== null;
}

// Opens the emoji-mart picker (https://www.npmjs.com/package/emoji-mart)
// anchored below `anchor`. Only one picker can be open at a time.
export async function openEmojiPicker(anchor, { onSelect } = {}) {
  closeEmojiPicker();
  const data = await loadData();
  if (activeClose) return; // superseded by a picker opened while data was loading

  const wrap = document.createElement('div');
  wrap.className = 'emoji-picker-wrap';
  document.body.appendChild(wrap);
  wrap.appendChild(new Picker({
    data,
    // emoji-mart styles itself inside its own shadow DOM, so it can't pick up
    // the app's variables — it has to be told which palette is active.
    theme: currentTheme(),
    previewPosition: 'none',
    onEmojiSelect: (emoji) => { onSelect(emoji.native); close(); },
  }));

  function position() {
    const r = anchor.getBoundingClientRect();
    const pw = 352, ph = 420, margin = 8;
    let left = Math.min(Math.max(r.left, margin), window.innerWidth - pw - margin);
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - margin && r.top > ph + margin) top = r.top - ph - 6;
    wrap.style.left = `${left}px`;
    wrap.style.top = `${Math.max(margin, top)}px`;
  }

  function onDocMouseDown(e) {
    if (!wrap.contains(e.target) && e.target !== anchor) close();
  }
  function onKeyDown(e) { if (e.key === 'Escape') close(); }
  function onReposition() { position(); }

  function close() {
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onReposition, true);
    window.removeEventListener('resize', onReposition);
    wrap.remove();
    if (activeClose === close) activeClose = null;
  }

  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);
  position();

  activeClose = close;
}
