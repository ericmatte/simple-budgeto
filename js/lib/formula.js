// Parses a planned-budget cell's raw input into a number.
// Accepts a plain amount ("56,32") or a formula prefixed with "=" using
// + - * / and parentheses ("=56.32+62,21"). Both "," and "." are treated as
// a decimal point — inputs here are small hand-typed amounts, not pasted
// bank statements, so there's no thousands-grouping ambiguity to resolve.
export function parseFormula(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const expr = (raw.startsWith('=') ? raw.slice(1) : raw).replace(/,/g, '.');
  if (!expr) return null;
  try {
    const tokens = tokenize(expr);
    const { value, pos } = parseExpr(tokens, 0);
    if (pos !== tokens.length) return null;
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  } catch {
    return null;
  }
}

function tokenize(expr) {
  // Whitespace is matched as its own token (and dropped below) rather than
  // stripped up front, so "12 5" can't silently fuse into the number 125.
  const raw = expr.match(/\s+|\d+\.?\d*|\.\d+|[+\-*/()]/g) || [];
  if (raw.join('').length !== expr.length) throw new Error('unexpected character');
  return raw.filter(t => t.trim() !== '');
}

function parseExpr(tokens, pos) {
  let { value, pos: p } = parseTerm(tokens, pos);
  while (tokens[p] === '+' || tokens[p] === '-') {
    const op = tokens[p];
    const rhs = parseTerm(tokens, p + 1);
    value = op === '+' ? value + rhs.value : value - rhs.value;
    p = rhs.pos;
  }
  return { value, pos: p };
}

function parseTerm(tokens, pos) {
  let { value, pos: p } = parseUnary(tokens, pos);
  while (tokens[p] === '*' || tokens[p] === '/') {
    const op = tokens[p];
    const rhs = parseUnary(tokens, p + 1);
    value = op === '*' ? value * rhs.value : value / rhs.value;
    p = rhs.pos;
  }
  return { value, pos: p };
}

function parseUnary(tokens, pos) {
  if (tokens[pos] === '-') { const rhs = parseUnary(tokens, pos + 1); return { value: -rhs.value, pos: rhs.pos }; }
  if (tokens[pos] === '+') return parseUnary(tokens, pos + 1);
  return parseAtom(tokens, pos);
}

function parseAtom(tokens, pos) {
  const t = tokens[pos];
  if (t === '(') {
    const inner = parseExpr(tokens, pos + 1);
    if (tokens[inner.pos] !== ')') throw new Error('unbalanced parens');
    return { value: inner.value, pos: inner.pos + 1 };
  }
  const n = Number(t);
  if (t === undefined || Number.isNaN(n)) throw new Error('unexpected token ' + t);
  return { value: n, pos: pos + 1 };
}
