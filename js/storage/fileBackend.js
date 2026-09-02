// Wraps the File System Access API so the app can remember a budget folder
// (e.g. one inside a Google Drive sync folder) across visits, and switch
// between several such folders (one per person/budget).
import { idbGet, idbSet, idbDelete } from '../lib/idb.js';

const RECENT_KEY = 'simple-budgeto:budgets';
const ACTIVE_KEY = 'simple-budgeto:activeBudget';

export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function listRecentBudgets() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}

function saveRecentBudgets(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

export function getActiveBudgetId() {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveBudgetId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

async function verifyPermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

function newBudgetId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function chooseNewBudgetFolder(label) {
  const handle = await window.showDirectoryPicker({ id: 'simple-budgeto', mode: 'readwrite' });
  const id = newBudgetId();
  await idbSet(id, handle);
  const list = listRecentBudgets();
  list.unshift({ id, label: label || handle.name, lastOpened: new Date().toISOString() });
  saveRecentBudgets(list);
  setActiveBudgetId(id);
  return id;
}

export async function getDirectoryHandle(id) {
  const handle = await idbGet(id);
  if (!handle) return null;
  const ok = await verifyPermission(handle);
  if (!ok) return null;
  const list = listRecentBudgets();
  const item = list.find(b => b.id === id);
  if (item) { item.lastOpened = new Date().toISOString(); saveRecentBudgets(list); }
  return handle;
}

export function renameRecentBudget(id, label) {
  const list = listRecentBudgets();
  const item = list.find(b => b.id === id);
  if (item) { item.label = label; saveRecentBudgets(list); }
}

export function removeRecentBudget(id) {
  saveRecentBudgets(listRecentBudgets().filter(b => b.id !== id));
  idbDelete(id);
  if (getActiveBudgetId() === id) localStorage.removeItem(ACTIVE_KEY);
}

export async function readFile(dirHandle, name) {
  try {
    const fh = await dirHandle.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    return await file.text();
  } catch (e) {
    if (e.name === 'NotFoundError') return null;
    throw e;
  }
}

export async function writeFile(dirHandle, name, text) {
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
}
