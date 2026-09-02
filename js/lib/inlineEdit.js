// One shared inline editor: an absolutely-positioned input laid exactly over
// the box it replaces, sized from that box's measured rect. Nothing enters or
// leaves the layout flow, so opening and closing an editor cannot resize a
// row, reflow a table, or scroll the page under the cursor.
//
// The host must be a positioned element (relative/sticky/absolute) — the
// input is appended to it and offset against its own rect.

let activeEdit = null;

export function closeInlineEdit() {
  if (!activeEdit) return;
  const { input, row } = activeEdit;
  activeEdit = null;
  if (row) row.draggable = true;
  input.remove();
}

// Commits whatever is open and hands back the write it started, so a caller
// that is closing this editor to open the next one can wait for the resulting
// re-render before looking for its target. Null when nothing was open.
export function commitInlineEdit() {
  return activeEdit ? activeEdit.commit() : null;
}

export function openInlineEdit(host, box, { value, className = '', align = 'left', onCommit, onTab }) {
  closeInlineEdit();
  const hostBox = host.getBoundingClientRect();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit ' + className;
  input.value = value ?? '';
  Object.assign(input.style, {
    left: `${box.left - hostBox.left}px`,
    top: `${box.top - hostBox.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    textAlign: align,
  });

  // A draggable ancestor swallows the mouse gesture that would otherwise
  // place the caret / select text inside the input, so the row stops being
  // draggable for as long as it is being edited.
  const row = host.closest('[data-drag-type]');
  if (row) row.draggable = false;
  host.appendChild(input);

  let settled = false;
  let pending = null;
  const finish = (commit, nav) => {
    if (settled) return pending;
    settled = true;
    const raw = input.value;
    closeInlineEdit();
    pending = Promise.resolve(commit ? onCommit(raw) : null).then(() => nav && nav());
    return pending;
  };
  activeEdit = { input, row, commit: () => finish(true) };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab' && onTab) { e.preventDefault(); finish(true, () => onTab(e.shiftKey)); }
  });
  input.addEventListener('blur', () => finish(true));
  input.focus();
  input.select();
}
