import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Official marks, fetched once from each brand's own site and inlined as
// data URIs: the app runs straight off the filesystem with no network, so an
// external <img src> would simply never paint.
const LOGOS = {
  cibc: { label: "CIBC Visa", src: "data:image/png;base64,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" },
  tangerine: { label: "Tangerine Mastercard", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAElBMVEVHcEzyah3yaR3yaR3yaR3yaR00XMZ+AAAABXRSTlMAsWUo2hLis+UAAAIdSURBVHic7ZoLksMwCEPJ7/5X3jr9JE6wAzbIMzvoAlb1BE7TEoVCoVAoFAqdNE8ALcXjl2mDaJ0LBkDnvzTx+cPO3zY2A1wALwpcEVagATYCZAJsC5Ad2NbRJWDnALUHigaQFmrrEDENhQA+FmZ/D+UA3ha8Y6gG8I3B8Xx2DyItlG7Dm5xmQny+00jIABwWzA0oAtg1G4cgmADfEFQAHELQAvjILAQ9gLcWoxB0E5DJxkEjgHcIBg46Akjqd9B3fn8VWxv4U+dGYB9EkQ56Gvhz0NGDbgCdDjon4FCrAQsAuxoflGwAtDswA0CNo2AGIKnhWjBYAWfpIzAEsEsbgSmAJGUPjQEkqSKwnICvVBEYroBDigg8AlBFYN7AXfJLyQUAySPwAUDydegDgMQ3ghcAkjLwAkBCBm4AkgQGHAGQ6E50BECSErgCEBhwuARzDQ7gsYW+DUyqt7Dy+yDGgDuAhxb6A6gbcLsEz1rGAqgaQACg2iJAAKgZgACoGAABKBoo/j8AZQB2fsEAYAfXDeAC4A3AGlgyADyf3YRAAKwBJADuNoRcgjUDSACcASgA5pEMC4B5KsYCuK8B9y8iTwbAAG5rAA3gOgToBt6GAB7AxQB4BSRlU4gHcHlHhAeQd3AAgLwCeAD5i8oBALK31cDn4EOnCgyYAMoSGAHg3IExARwMcN8ECw4Gff6kZV6neeD5oVAoFAqF/ov+AEtIV3J6Ve82AAAAAElFTkSuQmCC" },
  wealthsimple: { label: "Wealthsimple", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAaVBMVEX///8cGxsAAAC+vr4VFBQZGBgREBDHx8cJBwf8/PwNDAz5+fnKysrBwcE/Pj7p6embm5vR0dHz8/Ojo6Pg4OCMjIxGRkaAgICysrJLS0tycnKGhoY4Nzdsa2szMjLX19daWlpiYmIrKipt/j6tAAAExUlEQVR4nO2a23qzLBCFDZHEmGbf7NOm7f1f5CcYBWQtRHPw/we8R32ejAjDzGIGm2WJRCKRSCQSiUQi8V8zjWP3Mn9G2k/31juWAbtMxHF7jXWOtBc7awKbgF02iaJsJnAv4h7oTIAbVh6Q/cNJ2wOzfvvc80CODWciWx7KwPxe4+UrM9jlR/R5QTzmCyfQ9pc1WqcUp6f6eduzKDnbO8NtzmxBNcUvCPb5pOzazcSlGXEddEJrZ6bwHZiynIH3V1w7MxBra1230AzE3htsOeGRIw54Apn7jPhyftwGZiDAYJ/cXnySCVzsZ9qwbjgGRlyA0e7UHpprrEeEHyd8F8QTDLag6YscVvPVRkH+DX7+ZqEttmg0umliySZwaB6RIKwC25qv0WhLOgEWA9mqecTPKw0NA7FB5meiR2LKJvDxesHshxiw3BJHZM08hq0VOxFaUGa5qIPEcXXFaiQnPR7gM8zWJA7xnk2ZC+Zk+PoBshzNnAyZP6B5gbdsdiXD11lAIrCGpSKUApqJbI912OZ/gfe7amlRdoVTsx8YhnqHxQr/+ILpG1aXL++I1bBdVvMlu9lCvQqPuB2zhtusrXscQPWN5BaJGaydanHwEHCg+gZzi8UMlONT3pMCGqZvWD4XxLo4+7YqZEMa0PBDqi2cW0fmMD9olbdotWTxMSi3DvFBq1bGj2qLBw4s7D2Wtr7cqB0Q94j388ACxywvJZ3ORKF8RY9BlzJa4nldNim/OraVY7Gexi/Lzy2d2Sxo3apLZRevlVyYGHm5pQzz6y+eQaeSrPSFFkIeVIw6Bbeq4cScpI2UtqkSDC8sKKyd7siYdsCDVnKOdlaR3XcM2RCvdoRcO2BFtcDx+F8eKFZ96ClnO7FxAI0ZK+mqUouXighSHDq5VUeA+ovEjKWdVf0ao8IGWm+a3NqLtrogB5jRzsog5hiymZHAMsu4CxNnpEBvd/1Wkv6OQwJL5sAB1GH5ydjCbjAAO+jb3FL7bhItJw77bJyFCoQw5D6uyS3tAFN4EfWuX7uMP4YsqBhtgAN4gb6oZ1eie6sefnHJXefWRnQK7BuxvtRHJm5swjxDuXUrOlJLrFVdUsVzE43DIGKkcmsjvNKbWT9VgPY1A5hAbnkOoNblrer5w+0gR7LcAg6g1WG+lhHNAIaIUXFUEec1KqyOkhNZjHs/FaO8RM0Xy0R2yxYDv4xEnRpplSObAQj/0IC6T1ZEFFHNAIYvCrWqpKMZrsIGIi+k/cYdjdcgDOJEFoXvwWAmxjYDGHxziB2Ar1rplVkksORmF4EoaMepsAGJEXMAKufHqrABLYrdhIK7hbEqbPD3lTtA9x8OQ2thgK+w3AH+jo1XYUNXjEIO8I6P8Sps6IpRyAHdWnZ4LYxwu46gA7qZ+I4KG1wxEh9ha/uW7z0VNvxZYtTjAPeTw5haGGGHdp8DbO18V4UN5pDpdYA93f7JxnIcMmZ7XfG+Cre0YhThAHNd8b4KG5rGK8qpr+sK9m8Eo3iNGdlh1cIx7Eomcsy4qNJNkuRf8cegszsqAhTqsjnweXQU6pyNTqvtiCuZPtRNZ6wDVNYUkRfj8QgxQFdu4r1aGPFcDaguN6vgmZ1IJBKJRCKRSCQS/yv+AaHUM3fv8bcqAAAAAElFTkSuQmCC" },
  splitwise: { label: "Splitwise", src: "data:image/png;base64,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" },
};

// Sources with no brand mark of their own (the generic budget CSV, an
// unrecognized paste) still get a tile, so every row keeps the same first
// column and nothing shifts sideways between rows.
const FALLBACK_GLYPH = icon('file', { size: 17 });
const NAMES = { generic: 'Budget (CSV générique)' };

export function sourceLabel(source) {
  return LOGOS[source]?.label || NAMES[source] || (source ? String(source) : 'Source inconnue');
}

// One colour per Splitwise group, dealt out around the wheel rather than
// hashed from the name: the whole point is telling two groups apart at a
// glance, and two names hashed freely can land a few degrees from each other.
// Ranking by name keeps a group's colour still as long as the set of groups
// does. Only the hue moves, so every dot carries the same weight on both
// themes.
const GROUP_HUES = [0, 45, 90, 135, 180, 225, 270, 315];

export function groupColors(groups) {
  const names = [...new Set((groups || []).map(g => String(g || '').trim()).filter(Boolean))].sort();
  return new Map(names.map((name, i) => [name, `hsl(${GROUP_HUES[i % GROUP_HUES.length]} 70% 50%)`]));
}

// A white tile rather than a bare <img>: two of the four marks ship with an
// opaque light background baked in, so on the dark theme they would otherwise
// read as white squares of different sizes floating in the column. A `dot`
// pins a colour to the corner of the tile — the mark then says which of
// several Splitwise groups a row came from, not just that it came from one.
export function sourceLogoHTML(source, attrs = '', dot = '') {
  const logo = LOGOS[source];
  const label = sourceLabel(source);
  const tile = logo
    ? `<span class="src-logo" ${attrs}><img src="${logo.src}" alt="${escapeHtml(label)}" loading="lazy"></span>`
    : `<span class="src-logo src-logo-empty" aria-label="${escapeHtml(label)}" ${attrs}>${FALLBACK_GLYPH}</span>`;
  if (!dot) return tile;
  return `<span class="src-mark">${tile}<span class="src-dot" style="background:${escapeHtml(dot)}"></span></span>`;
}
