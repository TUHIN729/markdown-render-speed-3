// A dependency-free Markdown parser producing the same HTML as marked 18.1.3
// with its default options (GFM on, breaks off). Written from scratch:
// a block lexer producing block nodes, an inline parser with a delimiter
// stack for emphasis / strong / strikethrough, and a renderer.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_NOAMP_RE = /[<>"']/g;
function esc(s) { return s.replace(ESC_RE, c => ESC[c]); }
function escNoAmp(s) { return s.replace(ESC_NOAMP_RE, c => ESC[c]); }
// Attribute / text escaping (marked's no-encode rule): escape < > " ' and &
// unless the & starts something that looks like a character reference.
const ATTR_RE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
function escAttr(s) { return s.replace(ATTR_RE, c => ESC[c]); }

// Decode a numeric character reference starting at s[i] === '&'.
// Returns [decoded, nextIndex] or null when it is not a valid reference.
function decodeNumericRef(s, i) {
  const n = s.length;
  if (i + 1 >= n || s[i + 1] !== '#') return null;
  let j = i + 2, hex = false;
  if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
  const start = j;
  while (j < n && (hex ? /[0-9a-fA-F]/.test(s[j]) : /[0-9]/.test(s[j]))) j++;
  if (j === start || j >= n || s[j] !== ';') return null;
  if (!hex && j - start > 7) return null;
  if (hex && j - start > 6) return null;
  const code = parseInt(s.slice(start, j), hex ? 16 : 10);
  if (!code || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return ['\uFFFD', j + 1];
  return [String.fromCodePoint(code), j + 1];
}

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', iexcl: '¡', cent: '¢',
  pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§', uml: '¨', copy: '©',
  ordf: 'ª', laquo: '«', not: '¬', shy: '­', reg: '®', macr: '¯', deg: '°',
  plusmn: '±', sup2: '²', sup3: '³', acute: '´', micro: 'µ', para: '¶', middot: '·',
  cedil: '¸', sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾',
  iquest: '¿', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì',
  Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó',
  Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', times: '×', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú',
  Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á',
  acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è',
  eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  divide: '÷', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý',
  thorn: 'þ', yuml: 'ÿ', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
  lrm: '‎', rlm: '‏', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', permil: '‰',
  lsaquo: '‹', rsaquo: '›', euro: '€', hellip: '…', prime: '′', Prime: '″',
  oline: '‾', frasl: '⁄', trade: '™', bull: '•', lowast: '∗', Alpha: 'Α',
  Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η',
  Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ',
  Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ',
  Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ',
  sigmaf: 'ς', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ', infin: '∞',
  ne: '≠', le: '≤', ge: '≥', minus: '−', radic: '√', prop: '∝', part: '∂',
  sum: '∑', prod: '∏', cap: '∩', cup: '∪', int: '∫', there4: '∴', sim: '∼',
  cong: '≅', asymp: '≈', equiv: '≡', sub: '⊂', sup: '⊃', nsub: '⊄', sube: '⊆',
  supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅', lceil: '⌈',
  rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '〈', rang: '〉', loz: '◊',
  spades: '♠', clubs: '♣', hearts: '♥', diams: '♦', Tab: '\t', NewLine: '\n',
  colon: ':', sol: '/', bsol: '\\', Hat: '^', check: '✓', cross: '✗', star: '☆',
  phone: '☎', female: '♀', male: '♂', OElig: 'Œ', oelig: 'œ', Scaron: 'Š',
  scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜', ensp2: ' ',
  imagpart: 'ℑ', realpart: 'ℜ', alefsym: 'ℵ', larr: '←', uarr: '↑', rarr: '→',
  darr: '↓', harr: '↔', crarr: '↵', lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓',
  hArr: '⇔', forall: '∀', exist: '∃', empty: '∅', nabla: '∇', isin: '∈',
  notin: '∉', ni: '∋', or: '∨', and: '∧', lowast2: '∗', larr2: '←',
  // multi-character named entities used by the spec examples
  'fjlig': 'fj', 'Tab;': '\t'
};

// Decode a character reference starting at s[i] === '&'. Returns [decoded, nextIndex]
// or null when it is not a valid reference.
function decodeEntity(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  const c = s[i + 1];
  if (c === '#') {
    let j = i + 2, hex = false;
    if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
    const start = j;
    while (j < n && (hex ? /[0-9a-fA-F]/.test(s[j]) : /[0-9]/.test(s[j]))) j++;
    if (j === start || j >= n || s[j] !== ';') return null;
    const code = parseInt(s.slice(start, j), hex ? 16 : 10);
    if (!code || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return ['\uFFFD', j + 1];
    if (code === 38) return ['&amp;', j + 1];
    return [String.fromCodePoint(code), j + 1];
  }
  if (/[a-zA-Z]/.test(c)) {
    let j = i + 1;
    while (j < n && /[a-zA-Z0-9]/.test(s[j])) j++;
    if (j < n && s[j] === ';') {
      const name = s.slice(i + 1, j);
      const v = ENT[name];
      if (v !== undefined) return [v, j + 1];
    }
    return null;
  }
  return null;
}

// Unescape backslash escapes only (link destinations, titles and labels keep
// entities verbatim; only backslash escapes are decoded there).
const PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''));
function unescapeText(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && PUNCT.has(s[i + 1])) { out += s[i + 1]; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

function normalizeLabel(s) {
  // Unicode case folding as lower -> upper -> lower, collapse whitespace.
  // Backslash escapes are NOT resolved in labels (foo\! != foo!).
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

function cleanHref(href) {
  try { href = encodeURI(href).replace(/%25/g, '%'); } catch { return null; }
  return href;
}

// --- line helpers (tabs count to the next multiple of 4 columns) ---
function indentWidth(line) {
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === ' ') w++;
    else if (c === '\t') w += 4 - (w % 4);
    else break;
  }
  return w;
}
function isBlank(line) { return /^[ \t]*$/.test(line); }
// Remove `n` columns of indentation from the start of a line (tab-aware).
function stripIndent(line, n) {
  let w = 0, i = 0;
  while (i < line.length && w < n) {
    const c = line[i];
    if (c === ' ') { w++; i++; }
    else if (c === '\t') { const tw = 4 - (w % 4); if (w + tw > n) return ' '.repeat(w + tw - n) + line.slice(i + 1); w += tw; i++; }
    else break;
  }
  return line.slice(i);
}
// Index of the first non-space/tab char, or -1.
function firstNonSpace(line) {
  for (let i = 0; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return i;
  return -1;
}
// Expand tabs in the leading whitespace run of `s`, where the run starts at
// column `startCol`.
function expandLeadingTabs(s, startCol) {
  let col = startCol, i = 0, out = '';
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === ' ') { out += ' '; col++; i++; }
    else { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
  }
  return out + s.slice(i);
}
// Remove `n` columns of indentation, expanding leading tabs to spaces first
// (used when a container marker is stripped: list items, block quotes).
function stripIndentExpand(line, n) { return expandLeadingTabs(line, 0).slice(n); }
// An HTML block's text: its lines joined with newlines, plus a trailing
// newline only when the newline after its last line is the source's final
// character.
function htmlBlockText(lines, start, text, type) {
  let s = text.join('\n');
  const lastIdx = start + text.length - 1;
  const next = lastIdx + 1;
  if (next >= lines.length) return s;
  // the newline after the block's last line is included unless a blank line
  // follows (but it is included when it is the source's final newline).
  // For end-delimited blocks (types 1-5: pre/script/style/textarea,
  // comment, PI, declaration, CDATA) only a truly empty following line
  // drops it — a whitespace-only non-empty line ("\t" or spaces) keeps it.
  // For blank-line-delimited blocks (types 6-7) any blank line drops it.
  const blank = type <= 5 ? lines[next] === '' : isBlank(lines[next]);
  if (!blank || next === lines.length - 1) s += '\n';
  return s;
}

// ============================= inline parsing =============================
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section', 'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul']);
const PUNCT_RE = /[\p{P}\p{S}]/u;
function isPunct(ch) { return ch.length === 1 && PUNCT_RE.test(ch); }
function isSpace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === ' ' || /\s/.test(ch); }
function isWord(ch) { return ch !== undefined && !isSpace(ch) && !isPunct(ch); }

// Find a code span starting at s[i] (a run of backticks). Returns [content, endIndex] or null.
function scanCodeSpan(s, i) {
  const n = s.length;
  let run = 0;
  while (i + run < n && s[i + run] === '`') run++;
  let j = i + run;
  while (j < n) {
    if (s[j] === '`') {
      let r = 0;
      while (j + r < n && s[j + r] === '`') r++;
      if (r === run) {
        let content = s.slice(i + run, j).replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim() !== '') {
          content = content.slice(1, -1);
        }
        return [content, j + r];
      }
      j += r;
    } else j++;
  }
  return null;
}

// Scan a link label starting at s[i] === '['. Returns [innerText, endIndex] or null.
function scanLabel(s, i) {
  const n = s.length;
  let depth = 1, j = i + 1;
  while (j < n) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') {
      // marked's label pattern: a backtick run is consumed as a code span
      // only if its content holds no backtick (`+(?!`)[^`]*?`+(?!`)), or
      // the run is 2+ backticks right before ']' (``+(?=\])); otherwise
      // the label cannot be scanned and the link does not form
      let r = 0;
      while (j + r < n && s[j + r] === '`') r++;
      if (r >= 2 && j + r < n && s[j + r] === ']') { j += r; continue; }
      let p = -1;
      for (let q = j + r; q < n; q++) { if (s[q] === '`') { p = q; break; } }
      if (p === -1) return null;
      let r2 = 0;
      while (p + r2 < n && s[p + r2] === '`') r2++;
      j = p + r2; continue;
    }
    if (c === '[') {
      depth++;
      if (depth > 3) return null;
      j++; continue;
    }
    if (c === ']') {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
      j++; continue;
    }
    j++;
  }
  return null;
}

// Scan a reference label starting at s[i] === '['. Unlike scanLabel, a
// reference label cannot contain an unescaped '[' (marked's `le` pattern)
// and cannot span a blank line. Returns [innerText, endIndex] or null.
function scanRefLabel(s, i) {
  const n = s.length;
  let j = i + 1;
  while (j < n) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === ']') {
      const inner = s.slice(i + 1, j);
      if (inner.trim() === '') return null;
      return [inner, j + 1];
    }
    if (c === '[') return null;
    if (c === '\n') {
      let k = j + 1;
      while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
      if (k >= n || s[k] === '\n') return null;
      j++;
      continue;
    }
    j++;
  }
  return null;
}

// Parse an inline link tail starting at s[j] === '('. Returns {href, title, end} or null.
function parseInlineLinkTail(s, j) {
  const n = s.length;
  let i = j + 1;
  // skip spaces/tabs/newlines
  while (i < n && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
  let href = '';
  if (i < n && s[i] === '<') {
    let k = i + 1;
    let ok = false;
    while (k < n) {
      if (s[k] === '\\') { k += 2; continue; }
      if (s[k] === '\n') return null;
      if (s[k] === '>') { ok = true; break; }
      if (s[k] === '<') return null;
      k++;
    }
    if (!ok) return null;
    href = s.slice(i + 1, k);
    i = k + 1;
  } else {
    let depth = 0, k = i;
    while (k < n) {
      const c = s[k];
      if (c === '\\') { k += 2; continue; }
      if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 0x20) break;
      if (c === '(') { depth++; if (depth > 32) return null; }
      else if (c === ')') { if (depth === 0) break; depth--; }
      k++;
    }
    href = s.slice(i, k);
    i = k;
  }
  // optional title
  let title = null;
  let k = i;
  while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
  if (k < n && (s[k] === '"' || s[k] === "'" || s[k] === '(')) {
    const q = s[k];
    const close = q === '(' ? ')' : q;
    let m = k + 1, ok = false;
    while (m < n) {
      if (s[m] === '\\') { m += 2; continue; }
      if (s[m] === close) { ok = true; break; }
      if (q === '(' && s[m] === '(') return null;
      m++;
    }
    if (!ok) return null;
    title = s.slice(k + 1, m);
    i = m + 1;
    k = i;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
  }
  if (k >= n || s[k] !== ')') return null;
  return { href, title, end: k + 1 };
}

// Match an inline HTML tag starting at s[i] === '<'. Returns [raw, tagName] or null.
function scanHtmlTag(s, i) {
  const n = s.length;
  if (s.startsWith('<!--', i)) {
    const e = s.indexOf('-->', i + 2);
    if (e === -1) return null;
    return [s.slice(i, e + 3), null];
  }
  if (s.startsWith('<?', i)) {
    const e = s.indexOf('?>', i + 2);
    if (e === -1) return null;
    return [s.slice(i, e + 2), null];
  }
  if (s.startsWith('<![CDATA[', i)) {
    const e = s.indexOf(']]>', i + 9);
    if (e === -1) return null;
    return [s.slice(i, e + 3), null];
  }
  if (s.startsWith('<!', i) && i + 2 < n && /[A-Za-z]/.test(s[i + 2])) {
    const e = s.indexOf('>', i + 2);
    if (e === -1) return null;
    return [s.slice(i, e + 1), null];
  }
  let j = i + 1, closing = false;
  if (s[j] === '/') { closing = true; j++; }
  if (j >= n || !/[A-Za-z]/.test(s[j])) return null;
  const nameStart = j;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  const name = s.slice(nameStart, j).toLowerCase();
  if (closing) {
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j >= n || s[j] !== '>') return null;
    return [s.slice(i, j + 1), name];
  }
  let wsSeen = false;
  while (j < n) {
    const c = s[j];
    if (c === '>') return [s.slice(i, j + 1), name];
    if (c === '/' && s[j + 1] === '>') return [s.slice(i, j + 2), name];
    if (c === ' ' || c === '\t' || c === '\n') { wsSeen = true; j++; continue; }
    if (!wsSeen) return null;
    if (!/[A-Za-z_:]/.test(c)) return null;
    let k = j;
    while (k < n && /[\w.:-]/.test(s[k])) k++;
    let wAfterName = false;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) { wAfterName = true; k++; }
    if (s[k] === '=') {
      k++;
      while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
      if (s[k] === '"') { const e = s.indexOf('"', k + 1); if (e === -1) return null; k = e + 1; }
      else if (s[k] === "'") { const e = s.indexOf("'", k + 1); if (e === -1) return null; k = e + 1; }
      else {
        if (k >= n || /[\s"'=<>`]/.test(s[k])) return null;
        while (k < n && !/[\s"'=<>`]/.test(s[k])) k++;
      }
      j = k;
      wsSeen = false;
    } else {
      // a valueless attribute: whitespace after its name separates the next one
      j = k;
      wsSeen = wAfterName;
    }
  }
  return null;
}

// Trim trailing punctuation / unbalanced parens from an extended-autolink match.
function backpedal(u) {
  let end = u.length;
  while (end > 0) {
    // a trailing &name; (named-entity-like) is cut whole; numeric &#..; is not
    const em = u.slice(0, end).match(/&[A-Za-z0-9]+;$/);
    if (em) { end -= em[0].length; continue; }
    const c = u[end - 1];
    if ('?!.,:;*_\'"~'.includes(c)) { end--; continue; }
    if (c === ')') {
      let depth = 0;
      for (let i = 0; i < end; i++) { if (u[i] === '(') depth++; else if (u[i] === ')') depth--; }
      if (depth < 0) { end--; continue; }
    }
    break;
  }
  return u.slice(0, end);
}

const EMAIL_RE = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
// Same as EMAIL_RE, but a trailing '_' is allowed: it is the emphasis
// closer of a pending '_' opener, not part of the address.
const EMAIL_RE_RELAXED = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![A-Za-z0-9-])/;
const WWW_RE = /^www\.[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*(?:[^\s<>]*)?/;
const SCHEME_RE = /^(?:https?|ftp):\/\/[^\s<>]+/i;
const AUTOLINK_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*/;
const AUTOLINK_EMAIL_RE = /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/;
function autolinkEnd(s, i) {
  const em = s.slice(i).match(AUTOLINK_EMAIL_RE);
  if (em) return i + em[0].length;
  const sm = s.slice(i + 1).match(AUTOLINK_SCHEME_RE);
  if (sm && s[i + 1 + sm[0].length] === '>') return i + 1 + sm[0].length + 1;
  return 0;
}

// Tokenize inline text into items. refs: Map of normalized label -> {href, title}.
function tokenizeInline(s, refs, allowLinks) {
  const n = s.length;
  const items = [];
  let txt = '';
  const flush = () => { if (txt) { items.push({ k: 't', s: txt }); txt = ''; } };
  let i = 0;
  // pending unmatched '_' openers (a stack depth) for the bare-email rule:
  // a bare email may end right before a '_' closer only while an opener is
  // still pending; a closed pair no longer counts
  let openUnderscore = 0;
  while (i < n) {
    const c = s[i];
    // backslash escape / hard break
    if (c === '\\') {
      if (i + 1 < n && s[i + 1] === '\n') { flush(); items.push({ k: 'br' }); i += 2; while (i < n && (s[i] === ' ' || s[i] === '\t')) i++; continue; }
      if (i + 1 < n && PUNCT.has(s[i + 1])) {
        // an escaped & must not start an entity: keep it its own text item
        if (s[i + 1] === '&') { flush(); txt = '&'; flush(); }
        else txt += s[i + 1];
        i += 2; continue;
      }
      txt += c; i++; continue;
    }
    if (c === '\n') {
      // two-or-more trailing spaces => hard break (spaces after it are eaten)
      let sp = 0, j = txt.length - 1;
      while (j >= 0 && txt[j] === ' ') { sp++; j--; }
      if (sp >= 2) { txt = txt.slice(0, txt.length - sp); flush(); items.push({ k: 'br' }); i++; while (i < n && (s[i] === ' ' || s[i] === '\t')) i++; }
      else { flush(); items.push({ k: 'sb' }); i++; }
      continue;
    }
    if (c === '`') {
      const cs = scanCodeSpan(s, i);
      if (cs) { flush(); items.push({ k: 'c', s: cs[0] }); i = cs[1]; continue; }
      let run = 0;
      while (i + run < n && s[i + run] === '`') run++;
      txt += '`'.repeat(run); i += run; continue;
    }
    if (c === '<') {
      // autolink
      const em = s.slice(i).match(/^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/);
      if (allowLinks && em) {
        flush();
        items.push({ k: 'a', href: 'mailto:' + em[1], title: null, inner: [{ k: 't', s: em[1] }], ext: true });
        i += em[0].length; continue;
      }
      const sm = s.slice(i + 1).match(AUTOLINK_SCHEME_RE);
      if (allowLinks && sm && s[i + 1 + sm[0].length] === '>') {
        flush();
        items.push({ k: 'a', href: sm[0], title: null, inner: [{ k: 't', s: sm[0] }], ext: true });
        i += sm[0].length + 2; continue;
      }
      const tag = scanHtmlTag(s, i);
      if (tag) { flush(); items.push({ k: 'h', s: tag[0] }); i += tag[0].length; continue; }
      txt += c; i++; continue;
    }
    if (c === '&') {
      const d = decodeNumericRef(s, i);
      if (d) {
        if (d[0] === '&') { flush(); txt = '&'; flush(); }
        else txt += d[0];
        i = d[1]; continue;
      }
      txt += c; i++; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let run = 0;
      while (i + run < n && s[i + run] === c) run++;
      if (c === '~' && run > 2) { txt += '~'.repeat(run); i += run; continue; }
      if (c === '~') run = Math.min(run, 2);
      const prev = i > 0 ? s[i - 1] : undefined;
      const next = i + run < n ? s[i + run] : undefined;
      const prevWs = prev === undefined || isSpace(prev);
      const nextWs = next === undefined || isSpace(next);
      const prevPunct = prev !== undefined && isPunct(prev);
      const nextPunct = next !== undefined && isPunct(next);
      const leftFlank = !nextWs && (!nextPunct || prevWs || prevPunct);
      const rightFlank = !prevWs && (!prevPunct || nextWs || nextPunct);
      let canOpen, canClose;
      if (c === '_') {
        canOpen = leftFlank && (!rightFlank || prevPunct);
        canClose = rightFlank && (!leftFlank || nextPunct);
      } else {
        canOpen = leftFlank; canClose = rightFlank;
      }
      flush();
      const d = { k: 'd', ch: c, len: run, canOpen, canClose, tags: [], postTags: [] };
      items.push(d);
      if (c === '_') {
        // track pending '_' openers like a stack (closer-first for runs
        // that can both open and close), so a closed pair stops counting
        if (canClose && !canOpen) { if (openUnderscore > 0) openUnderscore--; }
        else if (canOpen && !canClose) { openUnderscore++; }
        else if (canOpen && canClose) { if (openUnderscore > 0) openUnderscore--; else openUnderscore++; }
      }
      i += run; continue;
    }
    if ((c === '[' && allowLinks === true) || (c === '!' && s[i + 1] === '[')) {
      const isImg = c === '!';
      const start = isImg ? i + 1 : i;
      const lab = scanLabel(s, start);
      if (lab) {
        const labelRaw = lab[0];
        let j = lab[1];
        let href = null, title = null, done = false;
        // a tag starting inside the label that swallows the closing ']' kills it
        let swallows = false;
        for (let p = start + 1; p < lab[1] - 1 && !swallows; p++) {
          if (s[p] === '<') {
            const tg = scanHtmlTag(s, p);
            if (tg && p + tg[0].length > lab[1]) swallows = true;
            const ae = autolinkEnd(s, p);
            if (ae && ae > lab[1]) swallows = true;
          }
        }
        if (!swallows) {
          if (j < n && s[j] === '(') {
            const tail = parseInlineLinkTail(s, j);
            if (tail) { href = tail.href; title = tail.title; j = tail.end; done = true; }
          }
          let refForm = false;
          if (!done && j < n && s[j] === '[') {
            // reference link: [label][ref] / [label][] — the label may nest
            // brackets; only the ref itself cannot contain '['
            let refRaw = null, kend = 0;
            if (j + 1 < n && s[j + 1] === ']') { refRaw = ''; kend = j + 2; }
            else {
              const rr = scanRefLabel(s, j);
              if (rr) { refRaw = rr[0]; kend = rr[1]; }
            }
            if (refRaw !== null) {
              refForm = true;
              const key = normalizeLabel(refRaw === '' ? labelRaw : refRaw);
              const def = refs.get(key);
              if (def) { href = def.href; title = def.title; j = kend; done = true; }
            }
          }
          if (!done && !refForm) {
            // shortcut reference — the label itself is the ref (no '[' inside)
            const rl = scanRefLabel(s, start);
            if (rl && rl[1] === lab[1]) {
              const key = normalizeLabel(labelRaw);
              const def = refs.get(key);
              if (def) { href = def.href; title = def.title; done = true; }
            }
          }
          if (done && !isImg) {
            // a link whose label itself contains a link is not a link
            // (an image's alt text may contain one)
            if (tokenizeInline(labelRaw, refs, true).some(it => it.k === 'a' && !it.ext)) done = false;
          }
        }
        if (done) {
          flush();
          if (isImg) {
            const alt = plainText(tokenizeInline(labelRaw, refs, true), refs);
            items.push({ k: 'img', href: unescapeText(href), title: title === null ? null : unescapeText(title), alt });
          } else {
            const inner = tokenizeInline(labelRaw, refs, 'auto');
            items.push({ k: 'a', href: unescapeText(href), title: title === null ? null : unescapeText(title), inner });
          }
          i = j; continue;
        }
      }
      txt += c; i++; continue;
    }
    // extended autolinks: www. / scheme:// / bare email
    if (allowLinks === true && c === 'w' && s.startsWith('www.', i) && (i === 0 || !isWord(s[i - 1]))) {
      const m = s.slice(i).match(WWW_RE);
      if (m) {
        const u = backpedal(m[0]);
        if (u.length > 4 && u.includes('.')) {
          flush();
          items.push({ k: 'a', href: 'http://' + u, title: null, inner: [{ k: 't', s: u }], ext: true });
          i += u.length; continue;
        }
      }
    }
    if (allowLinks === true && (c === 'h' || c === 'H' || c === 'f' || c === 'F') && (i === 0 || !isWord(s[i - 1]))) {
      const m = s.slice(i).match(SCHEME_RE);
      if (m) {
        const u = backpedal(m[0]);
        flush();
        items.push({ k: 'a', href: u, title: null, inner: [{ k: 't', s: u }], ext: true });
        i += u.length; continue;
      }
    }
    if (allowLinks === true && (c === 'm' || c === 'x') && (i === 0 || !isWord(s[i - 1]))) {
      const m = s.slice(i).match(/^(?:mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])|xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?)/);
      if (m) {
        const u = backpedal(m[0]);
        flush();
        items.push({ k: 'a', href: u, title: null, inner: [{ k: 't', s: u }], ext: true });
        i += u.length; continue;
      }
    }
    if (allowLinks === true && isWord(c) && (i === 0 || !/[A-Za-z0-9._+\-@]/.test(s[i - 1]) || (s[i - 1] === '_' && openUnderscore > 0))) {
      // a bare email may end right before a '_' closer, but only while an
      // unmatched '_' opener is pending (the '_' is then the emphasis
      // closer, not part of the address); without a pending opener the
      // strict boundary stands, so `foo@bar.com_` stays plain text
      // when an opener is pending, the relaxed boundary wins: the strict
      // pattern backtracks to a truncated domain (`a@b.example` of
      // `a@b.example.com__`) instead of matching the full address
      const m = openUnderscore > 0 ? s.slice(i).match(EMAIL_RE_RELAXED) : s.slice(i).match(EMAIL_RE);
      if (m) {
        const u = m[0];
        flush();
        items.push({ k: 'a', href: 'mailto:' + u, title: null, inner: [{ k: 't', s: u }], ext: true });
        i += u.length; continue;
      }
    }
    txt += c; i++;
  }
  flush();
  processDelims(items);
  return items;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

// Marked-style emphasis resolution (marked 18 emStrong/del), replacing the
// CommonMark delimiter stack: marked matches outermost-first with a forward
// scan, and the two disagree when an inner closer is followed by a letter
// (e.g. `**a *b*c**` stays literal in marked, and `**a *b* c**` forms
// strong). The scan below reproduces marked's accounting: m starts at the
// opener length; opener-only runs add to m; closer-only runs subtract;
// both-flanking runs are deferred by the rule of three (tracked in f) or
// subtract; the first run that brings m to <= 0 is the closer, clamped to
// b = min(len, len+m+f). `~` (del) uses the same scan but requires
// equal-length runs and has no rule of three. A match that uses fewer
// delimiters than a run holds splits the run, so leftover stars become
// fresh delim items inside (opener/closer inner parts) or after (closer
// rest) the span, exactly where marked's re-lexing puts them.
function processDelims(items) {
  resolveDelimRange(items, 0, null);
}

function resolveDelimRange(items, lo, hiItem) {
  let i = lo;
  while (true) {
    const end = hiItem === null ? items.length : items.indexOf(hiItem);
    if (i >= end) break;
    const it = items[i];
    if (it.k !== 'd' || it.dead || it.len === 0 || !it.canOpen) { i++; continue; }
    const res = findMarkedCloser(items, i, end);
    if (!res) {
      if (it.len > 1) {
        // Marked consumes one delimiter as literal text and retries the
        // shortened run (e.g. `***a**` fails at k=3, succeeds at k=2).
        const lit = { k: 'd', ch: it.ch, len: 1, canOpen: false, canClose: false, tags: [], postTags: [], dead: true };
        items.splice(i, 0, lit);
        it.len -= 1;
        it.cont = true; it.prevLen = (it.prevLen || 0) + 1;
        i += 1;
        continue;
      }
      it.dead = true; i++; continue;
    }
    const cl = items[res.j];
    const tag = it.ch === '~' ? 'del' : (res.use === 2 ? 'strong' : 'em');
    const k = it.len, L = cl.len, b = res.b, use = res.use;
    let innerLo = i + 1;
    if (k > use) {
      const inner = { k: 'd', ch: it.ch, len: k - use, canOpen: false, canClose: false, tags: [], postTags: [] };
      items.splice(i + 1, 0, inner);
      setSplitFlank(items, i + 1, undefined, firstCharOf(items[i + 2]));
      innerLo = i + 1;
    }
    let cj = items.indexOf(cl);
    if (b > use) {
      const inner = { k: 'd', ch: cl.ch, len: b - use, canOpen: false, canClose: false, tags: [], postTags: [] };
      items.splice(cj, 0, inner);
      setSplitFlank(items, cj, lastCharOf(items[cj - 1]), undefined);
      cj = items.indexOf(cl);
    }
    cl.len = 0;
    if (L > b) {
      const out = { k: 'd', ch: cl.ch, len: L - b, canOpen: false, canClose: false, tags: [], postTags: [], cont: true, prevLen: b };
      items.splice(cj + 1, 0, out);
      setSplitFlank(items, cj + 1, cl.ch, firstCharOf(items[cj + 2]));
    }
    it.len = 0;
    it.tags.push('<' + tag + '>');
    cl.postTags.push('</' + tag + '>');
    resolveDelimRange(items, innerLo, cl);
    i = items.indexOf(cl) + 1;
  }
}

function findMarkedCloser(items, oi, end) {
  const op = items[oi];
  const ch = op.ch;
  const k = op.len;
  let y = k, o = false;
  if (op.cont) { y = k + (op.prevLen || 0); o = true; }
  const R = op.canClose;
  let m = k, f = 0;
  // Marked's RDelim regexes have a leading alternative that hides one
  // lone delimiter sitting between a pair of the other kind at the very
  // start of the scan: `*` opener with `__ * __` ahead, or `_` opener
  // with `** _ **` ahead. The hidden run is never a candidate.
  let skip = null;
  {
    const other = ch === '*' ? '_' : '*';
    let a = -1, bIdx = -1, c = -1;
    for (let j = oi + 1; j < end; j++) {
      const d = items[j];
      if (d.k !== 'd' || d.len === 0) continue;
      if (d.ch === '~') continue;
      if (a === -1) { if (d.ch === other && d.len === 2) a = j; else break; }
      else if (bIdx === -1) { if (d.ch === ch && d.len === 1) bIdx = j; else break; }
      else { if (d.ch === other && d.len >= 2) c = j; break; }
    }
    if (a !== -1 && bIdx !== -1 && c !== -1) skip = items[bIdx];
  }
  for (let j = oi + 1; j < end; j++) {
    const d = items[j];
    if (d.k !== 'd' || d.ch !== ch || d.len === 0) continue;
    if (d === skip) continue;
    if (!d.canOpen && !d.canClose) continue;
    if (ch === '~') {
      if (d.len !== k) continue;
      if (d.canOpen && !d.canClose) { m += d.len; continue; }
      m -= d.len;
      if (m <= 0) return { j, b: d.len, use: k };
      continue;
    }
    if (d.canOpen && !d.canClose) { m += d.len; continue; }
    if (d.canOpen && d.canClose || R) {
      if (o && d.canOpen && d.canClose) return null;
      if (y % 3 !== 0 && (y + d.len) % 3 === 0) { f += d.len; continue; }
    }
    m -= d.len;
    if (m <= 0) {
      const b = Math.min(d.len, d.len + m + f);
      const use = (Math.min(k, b) % 2 === 1) ? 1 : 2;
      return { j, b, use };
    }
  }
  return null;
}

function firstCharOf(it) {
  if (!it) return undefined;
  if (it.k === 't') return it.s.length ? it.s[0] : undefined;
  if (it.k === 'c') return '`';
  if (it.k === 'a' || it.k === 'img') return '[';
  if (it.k === 'h') return '<';
  if (it.k === 'br' || it.k === 'sb') return '\n';
  if (it.k === 'd') return it.ch;
  return undefined;
}

function lastCharOf(it) {
  if (!it) return undefined;
  if (it.k === 't') return it.s.length ? it.s[it.s.length - 1] : undefined;
  if (it.k === 'c') return '`';
  if (it.k === 'a' || it.k === 'img') return ']';
  if (it.k === 'h') return '>';
  if (it.k === 'br' || it.k === 'sb') return '\n';
  if (it.k === 'd') return it.ch;
  return undefined;
}

function setSplitFlank(items, idx, prev, next) {
  const it = items[idx];
  const f = flankFor(it.ch, prev, next);
  it.canOpen = f.canOpen; it.canClose = f.canClose;
}

function flankFor(ch, prev, next) {
  const prevWs = prev === undefined || isSpace(prev);
  const nextWs = next === undefined || isSpace(next);
  const prevPunct = prev !== undefined && isPunct(prev);
  const nextPunct = next !== undefined && isPunct(next);
  const leftFlank = !nextWs && (!nextPunct || prevWs || prevPunct);
  const rightFlank = !prevWs && (!prevPunct || nextWs || nextPunct);
  let canOpen, canClose;
  if (ch === '_') {
    canOpen = leftFlank && (!rightFlank || prevPunct);
    canClose = rightFlank && (!leftFlank || nextPunct);
  } else {
    canOpen = leftFlank; canClose = rightFlank;
  }
  return { canOpen, canClose };
}

function plainText(items, refs) {
  let out = '';
  for (const it of items) {
    if (it.k === 't') out += it.s;
    else if (it.k === 'c') out += it.s;
    else if (it.k === 'd') out += it.ch.repeat(it.len);
    else if (it.k === 'a') out += plainText(it.inner, refs);
    else if (it.k === 'img') out += it.alt;
    else if (it.k === 'sb') out += '\n';
  }
  return out;
}

function renderItems(items, refs) {
  let out = '';
  for (const it of items) {
    if (it.k === 't') out += escAttr(it.s);
    else if (it.k === 'c') out += '<code>' + esc(it.s) + '</code>';
    else if (it.k === 'h') out += it.s;
    else if (it.k === 'br') out += '<br>';
    else if (it.k === 'sb') out += '\n';
    else if (it.k === 'd') {
      for (const t of it.postTags) out += t;
      out += it.ch.repeat(it.len);
      for (const t of it.tags) out += t;
    }
    else if (it.k === 'a') {
      const href = cleanHref(it.href);
      if (href === null) { out += renderItems(it.inner, refs); continue; }
      out += '<a href="' + escAttr(href) + '"';
      if (it.title !== null && it.title !== undefined) out += ' title="' + escAttr(it.title) + '"';
      out += '>' + renderItems(it.inner, refs) + '</a>';
    }
    else if (it.k === 'img') {
      const src = cleanHref(it.href);
      if (src === null) { out += escAttr(it.alt); continue; }
      out += '<img src="' + escAttr(src) + '" alt="' + escAttr(it.alt) + '"';
      if (it.title !== null && it.title !== undefined) out += ' title="' + escAttr(it.title) + '"';
      out += '>';
    }
  }
  return out;
}

function inline(s, refs) {
  return renderItems(tokenizeInline(s, refs, true), refs);
}

// ============================= block parsing =============================
// A node: {t:'p',text} {t:'h',level,text} {t:'code',lang,text} {t:'hr'}
// {t:'quote',blocks} {t:'list',ordered,start,loose,items:[{blocks}]}
// {t:'table',header,aligns,rows} {t:'html',text}

function nlAfter(lines, i) { return i < lines.length - 1 ? '\n' : ''; }

function codeText(contentLines) {
  let s = contentLines.join('\n');
  if (s !== '' && !s.endsWith('\n')) s += '\n';
  return s;
}

function parseTitleAtSeg(s, c) {
  const q = s[c];
  const close = q === '(' ? ')' : q;
  let m = c + 1;
  while (m < s.length) {
    if (s[m] === '\\') { m += 2; continue; }
    if (s[m] === close) {
      const title = s.slice(c + 1, m);
      if (/\n[ \t]*\n/.test(title)) return null;
      return { title, end: m + 1 };
    }
    if (q === '(' && s[m] === '(') return null;
    m++;
  }
  return null;
}

// Try to parse a link reference definition starting at lines[i]. Returns
// {consumed, label, href, title} (consumed = number of lines) or null.
// The label, destination and title may each span lines.
function tryRefDef(lines, i, end) {
  const segLines = lines.slice(i, Math.min(end, i + 8));
  const seg = segLines.join('\n');
  if (indentWidth(segLines[0]) > 3) return null;
  const start = firstNonSpace(segLines[0]);
  if (start < 0 || segLines[0][start] !== '[') return null;
  const lab = scanRefLabel(seg, start);
  if (!lab || lab[0].trim() === '') return null;
  let p = lab[1];
  const skipInlineWs = () => { while (p < seg.length && (seg[p] === ' ' || seg[p] === '\t')) p++; };
  skipInlineWs();
  if (p >= seg.length || seg[p] !== ':') return null;
  p++;
  // skip whitespace (including newlines) to the destination; it must not
  // sit on a blank line
  while (true) {
    skipInlineWs();
    if (p < seg.length && seg[p] !== '\n') break;
    if (p >= seg.length) return null;
    p++; // pass the newline
    if (p >= seg.length) return null;
    let q = p;
    while (q < seg.length && (seg[q] === ' ' || seg[q] === '\t')) q++;
    if (q >= seg.length || seg[q] === '\n') return null;
  }
  let href = '';
  if (seg[p] === '<') {
    let k = p + 1, good = false;
    while (k < seg.length) {
      if (seg[k] === '\\') { k += 2; continue; }
      if (seg[k] === '\n' || seg[k] === '<') return null;
      if (seg[k] === '>') { good = true; break; }
      k++;
    }
    if (!good) return null;
    href = seg.slice(p + 1, k);
    p = k + 1;
  } else {
    let k = p;
    while (k < seg.length && seg[k] !== ' ' && seg[k] !== '\t' && seg[k] !== '\n') k++;
    href = seg.slice(p, k);
    if (href === '') return null;
    p = k;
  }
  let title = null;
  const wsBeforeTitle = p;
  skipInlineWs();
  if (p < seg.length && seg[p] !== '\n') {
    if (p === wsBeforeTitle) return null; // title must be separated by whitespace
    const q = seg[p];
    if (q !== '"' && q !== "'" && q !== '(') return null;
    const t = parseTitleAtSeg(seg, p);
    if (!t) return null;
    title = t.title;
    p = t.end;
    skipInlineWs();
    if (p < seg.length && seg[p] !== '\n') return null;
  } else if (p < seg.length && seg[p] === '\n') {
    // title on the immediately following line, alone on its line
    let q = p + 1;
    while (q < seg.length && (seg[q] === ' ' || seg[q] === '\t')) q++;
    if (q < seg.length && seg[q] !== '\n' && (seg[q] === '"' || seg[q] === "'" || seg[q] === '(')) {
      const t = parseTitleAtSeg(seg, q);
      if (t) {
        let e = t.end;
        while (e < seg.length && (seg[e] === ' ' || seg[e] === '\t')) e++;
        if (e >= seg.length || seg[e] === '\n') { title = t.title; p = e; }
      }
    }
  }
  const consumed = seg.slice(0, p).split('\n').length;
  return { consumed, label: lab[0], href, title };
}

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const DELIM_CELL_RE = /^:?-+:?$/;

function splitCells(s) {
  const parts = [];
  let cur = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += ''; i += 2; continue; }
    if (s[i] === '|') { parts.push(cur); cur = ''; i++; continue; }
    cur += s[i]; i++;
  }
  parts.push(cur);
  if (parts.length > 1 && parts[0].trim() === '') parts.shift();
  if (parts.length > 1 && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map(p => p.replace(//g, '|').trim());
}

function isDelimRow(line) {
  if (!line.includes('|')) return null;
  const m = line.match(/^ {0,3}(.*)$/);
  const cells = splitCells(m[1]);
  if (cells.length === 0) return null;
  const aligns = [];
  for (const c of cells) {
    const t = c.trim();
    if (!DELIM_CELL_RE.test(t)) return null;
    aligns.push(t.startsWith(':') && t.endsWith(':') && t.length > 1 ? 'center' : t.startsWith(':') ? 'left' : t.endsWith(':') ? 'right' : null);
  }
  return aligns;
}

const HTML_START_RE = /^ {0,3}<(\/?)([A-Za-z][A-Za-z0-9-]*)?/;
function htmlBlockInfo(line) {
  const ind = indentWidth(line);
  if (ind > 3) return null;
  const s = line.slice(firstNonSpace(line));
  const low = s.toLowerCase();
  if (low.startsWith('<script') || low.startsWith('<pre') || low.startsWith('<style') || low.startsWith('<textarea')) {
    const after = low.slice(1);
    const m = after.match(/^(script|pre|style|textarea)(?:[\s>]|$)/);
    if (m) return { type: 1, endTag: '</' + m[1] };
  }
  if (s.startsWith('<!--')) return { type: 2, endStr: '-->' };
  if (s.startsWith('<?')) return { type: 3, endStr: '?>' };
  if (/^<![A-Za-z]/.test(s)) return { type: 4, endStr: '>' };
  if (s.startsWith('<![CDATA[')) return { type: 5, endStr: ']]>' };
  const m = s.match(/^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t\n\/>]|$)/);
  if (m) {
    if (BLOCK_TAGS.has(m[1].toLowerCase())) return { type: 6, endStr: null };
    // type 7: a complete tag alone on the line
    const tag = scanHtmlTag(s, 0);
    if (tag && tag[0].length === s.trimEnd().length) return { type: 7, endStr: null };
  }
  return null;
}

function endsWithParagraph(nodes) {
  if (!nodes.length) return false;
  const last = nodes[nodes.length - 1];
  if (last.t === 'p') return true;
  if (last.t === 'quote') return endsWithParagraph(last.blocks);
  if (last.t === 'list') {
    if (!last.items.length) return false;
    return endsWithParagraph(last.items[last.items.length - 1].blocks);
  }
  return false;
}

// Match a list marker at the start of `line` (indent already accounted).
// Returns null or {ordered, bullet, num, delim, markerLen, contentIndent, contentStart, empty}
function matchListMarker(line) {
  const ind = indentWidth(line);
  if (ind > 3) return null;
  const s = line.slice(firstNonSpace(line));
  let ordered = false, bullet = null, num = 0, delim = '', markerLen = 0;
  const bm = s.match(/^([*+-])(?=$|[ \t])/);
  const om = s.match(/^(\d{1,9})([.)])(?=$|[ \t])/);
  if (bm) { bullet = bm[1]; markerLen = 1; }
  else if (om) { ordered = true; num = parseInt(om[1], 10); delim = om[2]; markerLen = om[1].length + 1; }
  else return null;
  // content after marker
  let rest = s.slice(markerLen);
  let contentStart, contentIndent;
  if (rest.trim() === '') { contentStart = markerLen; contentIndent = ind + markerLen + 1; }
  else {
    // count columns of whitespace after marker
    let w = 0, k = 0;
    while (k < rest.length && (rest[k] === ' ' || rest[k] === '\t')) {
      if (rest[k] === ' ') w++;
      else w += 4 - ((ind + markerLen + w) % 4);
      k++;
    }
    if (w === 0) return null; // marker must be followed by space/tab or EOL
    if (w >= 5) { contentIndent = ind + markerLen + 1; contentStart = markerLen + 1; }
    else { contentIndent = ind + markerLen + w; contentStart = markerLen + k; }
  }
  // content: expand tabs in the whitespace after the marker, then cut the
  // columns up to the content indent (so "-\t\tfoo" keeps 6 spaces)
  const content = expandLeadingTabs(rest, ind + markerLen).slice(Math.max(0, contentIndent - (ind + markerLen)));
  return { ordered, bullet, num, delim, markerLen, indent: ind, contentIndent, contentStart, content, empty: content.trim() === '' };
}

function parseBlocks(lines, i, end, refs, lazySet, inList) {
  const nodes = [];
  let para = [];
  let paraIdx = [];
  const flushPara = () => { if (para.length) { nodes.push({ t: 'p', text: para.join('\n'), s: paraIdx[0], e: paraIdx[paraIdx.length - 1] }); para = []; paraIdx = []; } };
  while (i < end) {
    const line = lines[i];
    if (isBlank(line)) {
      // a whitespace-only (non-empty) line at the very end of the range joins
      // an open paragraph (marked's paragraph regex only excludes space-only
      // lines that are followed by a newline)
      if (line !== '' && i === end - 1 && para.length) { para.push(line); paraIdx.push(i); i++; continue; }
      flushPara(); i++; continue;
    }
    // a lazy continuation line is paragraph text, whatever it looks like
    if (lazySet && lazySet.has(i)) { para.push(line); paraIdx.push(i); i++; continue; }
    // link reference definitions only at the start of a paragraph
    if (!para.length) {
      const def = tryRefDef(lines, i, end);
      if (def) {
        const key = normalizeLabel(def.label);
        if (!refs.has(key)) refs.set(key, { href: unescapeText(def.href), title: def.title === null ? null : unescapeText(def.title) });
        i += def.consumed;
        continue;
      }
    }
    // setext heading / table: only when a paragraph is open
    if (para.length) {
      const sm = line.match(SETEXT_RE);
      if (sm) {
        const level = sm[1][0] === '=' ? 1 : 2;
        nodes.push({ t: 'h', level, text: para.join('\n').trim(), s: paraIdx[0], e: i });
        para = [];
        paraIdx = [];
        i++;
        continue;
      }
      const aligns = isDelimRow(line);
      if (aligns) {
        const headerLine = para[para.length - 1];
        if (headerLine.includes('|')) {
          const header = splitCells(headerLine);
          if (header.length === aligns.length) {
            const headerIdx = paraIdx[paraIdx.length - 1];
            para.pop();
            paraIdx.pop();
            flushPara();
            const t = parseTable(lines, i, end, header, aligns);
            t.node.s = headerIdx;
            t.node.e = t.next - 1;
            nodes.push(t.node);
            i = t.next;
            continue;
          }
        }
      }
    }
    const ind = indentWidth(line);
    // ATX heading
    const atx = line.match(ATX_RE);
    if (atx && ind <= 3) {
      flushPara();
      let text = (atx[2] || '').trim();
      text = text.replace(/(?:[ \t]+#+|^#+)[ \t]*$/, '');
      nodes.push({ t: 'h', level: atx[1].length, text, s: i, e: i });
      i++;
      continue;
    }
    // fenced code
    const fence = line.match(FENCE_RE);
    if (fence && ind <= 3) {
      const ch = fence[1][0];
      if (ch === '`' && fence[2].includes('`')) {
        // not a fence: fall through to paragraph
      } else {
        flushPara();
        const fenceLen = fence[1].length;
        const fenceIndent = ind;
        const info = fence[2].trim();
        const content = [];
        // marked's indentCodeCompensation (backtick fences only): strip up
        // to fenceIndent leading whitespace CHARACTERS from each content
        // line — a tab counts as one character, so "\tcode" under a
        // 2-space-indented opener becomes "code", not "  code" (which a
        // column-based strip would give). Tilde fences get no compensation.
        const compLine = (cl) => {
          if (fenceIndent === 0) return cl;
          const m = cl.match(/^\s+/);
          if (!m) return cl;
          return cl.slice(Math.min(m[0].length, fenceIndent));
        };
        let j = i + 1, closed = false;
        while (j < end) {
          const cl = lines[j];
          const cm = cl.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
          if (cm && cm[1][0] === ch && cm[1].length >= fenceLen) { closed = true; break; }
          content.push(ch === '`' ? compLine(cl) : cl);
          j++;
        }
        const rawLang = info.split(/[ \t]/)[0] || '';
        const lang = rawLang ? unescapeText(rawLang) : null;
        nodes.push({ t: 'code', lang, text: codeText(content), s: i, e: closed ? j : Math.max(i, j - 1) });
        i = closed ? j + 1 : j;
        continue;
      }
    }
    // thematic break
    if (HR_RE.test(line)) { flushPara(); nodes.push({ t: 'hr', s: i, e: i }); i++; continue; }
    // HTML block
    const hb = htmlBlockInfo(line);
    if (hb && (hb.type <= 6 || !para.length)) {
      flushPara();
      const text = [];
      let j = i;
      if (hb.type === 1) {
        while (j < end) { text.push(lines[j]); if (lines[j].toLowerCase().includes(hb.endTag)) { j++; break; } j++; }
      } else if (hb.type >= 2 && hb.type <= 5) {
        while (j < end) { text.push(lines[j]); if (lines[j].includes(hb.endStr)) { j++; break; } j++; }
      } else {
        while (j < end && !isBlank(lines[j])) { text.push(lines[j]); j++; }
      }
      nodes.push({ t: 'html', text: htmlBlockText(lines, i, text, hb.type), s: i, e: j - 1 });
      i = j;
      continue;
    }
    // blockquote
    if (/^ {0,3}>/.test(line)) {
      flushPara();
      const q = parseQuote(lines, i, end, refs, inList);
      q.node.s = i;
      q.node.e = q.lastLine;
      nodes.push(q.node);
      i = q.next;
      continue;
    }
    // list
    const lm = matchListMarker(line);
    if (lm) {
      const canInterrupt = !para.length || (!lm.empty && (!lm.ordered || lm.num === 1 || inList));
      if (canInterrupt) {
        flushPara();
        const l = parseList(lines, i, end, refs);
        l.node.s = i;
        l.node.e = l.lastLine;
        nodes.push(l.node);
        i = l.next;
        continue;
      }
    }
    // table at paragraph start
    if (!para.length && line.includes('|') && i + 1 < end) {
      const aligns = isDelimRow(lines[i + 1]);
      if (aligns) {
        const header = splitCells(line);
        if (header.length === aligns.length) {
          const t = parseTable(lines, i + 1, end, header, aligns);
          t.node.s = i;
          t.node.e = t.next - 1;
          nodes.push(t.node);
          i = t.next;
          continue;
        }
      }
    }
    // indented code (cannot interrupt a paragraph)
    if (!para.length && ind >= 4) {
      const content = [];
      let j = i;
      while (j < end) {
        const cl = lines[j];
        if (isBlank(cl)) {
          // blank line: include only if a later indented line follows
          let k = j;
          while (k < end && isBlank(lines[k])) k++;
          if (k < end && indentWidth(lines[k]) >= 4) { for (; j < k; j++) content.push(stripIndent(lines[j], 4)); continue; }
          break;
        }
        if (indentWidth(cl) < 4) break;
        content.push(stripIndent(cl, 4));
        j++;
      }
      while (content.length && isBlank(content[content.length - 1])) content.pop();
      nodes.push({ t: 'code', lang: null, text: codeText(content), s: i, e: Math.max(i, j - 1) });
      i = j;
      continue;
    }
    // paragraph line (lazy continuation)
    para.push(line);
    paraIdx.push(i);
    i++;
  }
  flushPara();
  return { nodes, next: i };
}

function parseTable(lines, delimIdx, end, header, aligns) {
  const rows = [];
  let j = delimIdx + 1;
  while (j < end) {
    const line = lines[j];
    if (isBlank(line)) {
      if (/^\t+$/.test(line)) {
        rows.push(new Array(header.length).fill(''));
        j++;
        continue;
      }
      break;
    }
    if (indentWidth(line) >= 4) break;
    if (HR_RE.test(line)) break;
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) break;
    if (/^ {0,3}>/.test(line)) break;
    if (line.match(FENCE_RE)) break;
    if (htmlBlockInfo(line) && htmlBlockInfo(line).type <= 6) break;
    if (matchListMarker(line)) break;
    const cells = splitCells(line);
    while (cells.length < header.length) cells.push('');
    if (cells.length > header.length) cells.length = header.length;
    rows.push(cells);
    j++;
  }
  return { node: { t: 'table', header, aligns, rows }, next: j };
}

// Does this line start a block that can end a paragraph (so it cannot be a
// lazy continuation line of a quote or list item)?
function startsBlock(line) {
  if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) return true;
  const f = line.match(FENCE_RE);
  if (f && indentWidth(line) <= 3 && !(f[1][0] === '`' && f[2].includes('`'))) return true;
  if (HR_RE.test(line)) return true;
  const hb = htmlBlockInfo(line);
  if (hb && hb.type <= 6) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (matchListMarker(line)) return true;
  if (SETEXT_RE.test(line)) return true;
  return false;
}

function parseQuote(lines, i, end, refs, inList) {
  const inner = [];
  const lazy = new Set();
  let j = i;
  let lastLine = i;
  const stripQuoteMarker = (line) => {
    const m = line.match(/^([ \t]*)>/);
    let col = 0;
    for (const ch of m[1]) col += ch === '\t' ? 4 - (col % 4) : 1;
    col += 1; // '>'
    // expand the rest's leading tabs from the column after '>', then eat the
    // single optional space after the marker
    let rest = expandLeadingTabs(line.slice(m[0].length), col);
    if (rest.startsWith(' ')) rest = rest.slice(1);
    return rest;
  };
  while (j < end) {
    const line = lines[j];
    if (/^ {0,3}>/.test(line)) { inner.push(stripQuoteMarker(line)); lastLine = j; j++; continue; }
    // a truly blank line (no '>' marker) ends the blockquote
    if (isBlank(line)) break;
    // lazy continuation: only if the line starts no block and the quote so
    // far ends with a paragraph. A setext underline is lazy text (indented
    // by 4 spaces, per marked); a lazy line with 4+ indent loses 4 columns.
    const setextLazy = /^ {0,3}(=+|-+)[ \t]*$/.test(line) && !HR_RE.test(line);
    if (!setextLazy && startsBlock(line)) break;
    const parsed = parseBlocks(inner, 0, inner.length, refs, lazy, inList);
    // the quote's paragraph must still be open (last inner line not blank)
    if (inner.length && !isBlank(inner[inner.length - 1]) && endsWithParagraph(parsed.nodes)) {
      let lz = line;
      if (setextLazy) lz = '    ' + line.slice(firstNonSpace(line));
      else if (indentWidth(line) >= 4) lz = stripIndent(line, 4);
      lazy.add(inner.length);
      inner.push(lz);
      lastLine = j;
      j++;
      continue;
    }
    break;
  }
  const blocks = parseBlocks(inner, 0, inner.length, refs, lazy, inList);
  return { node: { t: 'quote', blocks: blocks.nodes }, next: j, lastLine };
}

function fenceOpenOf(line) {
  const m = line.match(FENCE_RE);
  if (!m || indentWidth(line) > 3) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { ch: m[1][0], len: m[1].length };
}
function fenceCloseOf(line, fence) {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return !!m && m[1][0] === fence.ch && m[1].length >= fence.len;
}

function parseList(lines, i, end, refs) {
  const first = matchListMarker(lines[i]);
  const ordered = first.ordered;
  const bullet = first.bullet;
  const delim = first.delim;
  const listIndent = first.indent;
  const start = first.num;
  const items = [];
  let loose = false;
  let prevTrailingBlank = false;
  let lastCI = first.contentIndent;
  let j = i;
  let lastLine = i;
  while (j < end) {
    if (HR_RE.test(lines[j])) break; // a thematic break ends the list
    const lm = matchListMarker(lines[j]);
    if (!lm) break;
    // a following item is a sibling iff its marker indent is below the
    // previous item's content indent (marked's nextBulletRegex rule): the
    // first item may itself be indented (e.g. "  - a") while later items
    // sit at indent 0, and they are still one list.
    if (lm.indent >= lastCI) break;
    if (j !== i && prevTrailingBlank) loose = true;
    if (ordered !== lm.ordered) break;
    if (ordered && lm.delim !== delim) break;
    if (!ordered && lm.bullet !== bullet) break;
    // new item
    lastLine = j;
    const contentIndent = lm.contentIndent;
    const itemLines = [];
    const lazy = new Set();
    let content = lm.content;
    // first line content: strip the marker's following whitespace already done;
    // content is the raw remainder of the line after marker+spaces
    itemLines.push(content);
    // a fence opened by the item's first line stays open across the item's
    // following lines (same rule as below)
    let fence = fenceOpenOf(content);
    // true while an under-indented non-blank line must end the item rather
    // than join the fence: set when the fence opener is pushed, and when a
    // blank line is pushed inside the fence (marked: a lazy line breaks if
    // the previous line was blank, or was a fence/heading/html/hr begin);
    // a content line clears it, after which under-indented lines stay in
    // the fence (doc-02's indent-0 content line after indented content)
    let fenceBreakable = fence !== null;
    let k = j + 1;
    let pendingBlanks = 0;
    let itemDone = false;
    while (k < end && !itemDone) {
      const cl = lines[k];
      // inside a fenced code block, every line belongs to the item until the
      // closing fence, regardless of indent (a fence content line at indent 0
      // must not end the item, or the closing fence reopens at top level and
      // swallows the rest of the document). pendingBlanks is always 0 here:
      // blanks inside the fence are pushed directly, and blanks before the
      // opener were flushed when the opener was pushed.
      // Strip each line exactly as the branch that would have included it
      // does: the indent branch's expand+slice when indented enough, the
      // lazy branch's plain strip otherwise (expand+slice would eat content
      // on a low-indent line).
      if (fence) {
        // an under-indented non-blank line ends the item while the fence
        // is breakable (empty fence, or fence closed by the blank); the line
        // is left for the outer parser
        if (fenceBreakable && !isBlank(cl) && indentWidth(cl) < contentIndent) { itemDone = true; break; }
        if (isBlank(cl)) { itemLines.push(''); fenceBreakable = true; lastLine = k; k++; continue; }
        const stripped = indentWidth(cl) >= contentIndent ? stripIndentExpand(cl, contentIndent) : stripIndent(cl, contentIndent);
        itemLines.push(stripped);
        fenceBreakable = false;
        if (fenceCloseOf(stripped, fence)) fence = null;
        lastLine = k; k++; continue;
      }
      if (isBlank(cl)) {
        // an empty item followed by a blank line is done (stays empty);
        // skip the blanks so the outer loop can find the next item
        if (itemLines.every(l => isBlank(l))) {
          let m = k;
          while (m < end && isBlank(lines[m])) m++;
          if (m < end) {
            const nm2 = matchListMarker(lines[m]);
            if (nm2 && nm2.indent >= listIndent && nm2.indent <= listIndent + 3 && nm2.ordered === ordered && (ordered ? nm2.delim === delim : nm2.bullet === bullet)) loose = true;
          }
          k = m;
          itemDone = true;
          break;
        }
        pendingBlanks++; k++; continue;
      }
      const nm = matchListMarker(cl);
      if (nm && nm.indent < contentIndent &&
          nm.ordered === ordered && (ordered ? nm.delim === delim : nm.bullet === bullet)) {
        // next item of this list
        if (pendingBlanks > 0) loose = true;
        itemDone = true;
        break;
      }
      if (indentWidth(cl) >= contentIndent) {
        if (pendingBlanks > 0) { for (let b = 0; b < pendingBlanks; b++) itemLines.push(''); pendingBlanks = 0; }
        itemLines.push(stripIndentExpand(cl, contentIndent));
        const fo = fenceOpenOf(itemLines[itemLines.length - 1]);
        if (fo) { fence = fo; fenceBreakable = true; }
        lastLine = k;
        k++;
        continue;
      }
      // a line that starts a block ends the item; a lazy continuation line
      // only joins the item's last paragraph, and only with no blank line
      // before it. A setext underline is lazy text (not a heading).
      const setextLazy = SETEXT_RE.test(cl) && !HR_RE.test(cl);
      if (!setextLazy && startsBlock(cl)) { itemDone = true; break; }
      const parsed = parseBlocks(itemLines, 0, itemLines.length, refs, lazy, true);
      // the item's paragraph must still be open (last item line not blank)
      if (pendingBlanks === 0 && itemLines.length && !isBlank(itemLines[itemLines.length - 1]) && endsWithParagraph(parsed.nodes)) {
        lazy.add(itemLines.length);
        // a lazy continuation line joins the paragraph verbatim, leading
        // spaces included (marked keeps them: "- one\n two" -> "one\n two");
        // but a lazy line indented 4+ loses 4 columns, like indented code
        // ("  1.  A\n    x" -> "x", "     x" -> " x")
        itemLines.push(indentWidth(cl) >= 4 ? stripIndent(cl, 4) : cl);
        const fo2 = fenceOpenOf(itemLines[itemLines.length - 1]);
        if (fo2) { fence = fo2; fenceBreakable = true; }
        lastLine = k;
        k++;
        continue;
      }
      itemDone = true;
      break;
    }
    // trailing blank lines inside the item are dropped; a blank line between
    // items makes the list loose (handled by pendingBlanks at next item)
    while (itemLines.length && isBlank(itemLines[itemLines.length - 1])) itemLines.pop();
    const parsed = parseBlocks(itemLines, 0, itemLines.length, refs, lazy, true);
    // a blank line inside the item makes the list loose only if it separates
    // two blocks at this level (no single block spans it, blocks on both sides)
    for (let b = 0; b < itemLines.length; b++) {
      if (!isBlank(itemLines[b])) continue;
      if (parsed.nodes.some(nd => nd.s <= b && b <= nd.e)) continue;
      if (parsed.nodes.some(nd => nd.e < b) && parsed.nodes.some(nd => nd.s > b)) loose = true;
    }
    // a blank line after the item's last block (e.g. before a ref def) also
    // separates it from the next item
    const lastE = parsed.nodes.length ? Math.max(...parsed.nodes.map(nd => nd.e)) : -1;
    prevTrailingBlank = itemLines.some((l, idx) => idx > lastE && isBlank(l));
    lastCI = contentIndent;
    items.push({ blocks: parsed.nodes });
    j = k;
  }
  return { node: { t: 'list', ordered, start, loose, items }, next: j, lastLine };
}

// ============================= rendering =============================
function renderBlocks(nodes, refs, tight) {
  let out = '';
  for (const node of nodes) {
    if (node.t === 'p') {
      if (tight) out += inline(node.text, refs);
      else out += '<p>' + inline(node.text, refs) + '</p>\n';
    } else if (node.t === 'h') {
      out += '<h' + node.level + '>' + inline(node.text, refs) + '</h' + node.level + '>\n';
    } else if (node.t === 'code') {
      out += '<pre><code' + (node.lang ? ' class="language-' + escAttr(node.lang) + '"' : '') + '>' + esc(node.text) + '</code></pre>\n';
    } else if (node.t === 'hr') {
      out += '<hr>\n';
    } else if (node.t === 'quote') {
      out += '<blockquote>\n' + renderBlocks(node.blocks, refs, false) + '</blockquote>\n';
    } else if (node.t === 'list') {
      out += renderList(node, refs);
    } else if (node.t === 'table') {
      out += renderTable(node, refs);
    } else if (node.t === 'html') {
      out += node.text;
    }
  }
  return out;
}

function renderList(node, refs) {
  const tag = node.ordered ? 'ol' : 'ul';
  let out = '<' + tag;
  if (node.ordered && node.start !== 1) out += ' start="' + node.start + '"';
  out += '>\n';
  for (const item of node.items) {
    let blocks = item.blocks;
    let checkbox = '';
    let firstText = null;
    if (blocks.length && blocks[0].t === 'p') {
      const m = blocks[0].text.match(/^\[([ xX])\][ \t]+(\S[\s\S]*)$/);
      if (m) {
        checkbox = m[1] === ' ' ? '<input disabled="" type="checkbox"> ' : '<input checked="" disabled="" type="checkbox"> ';
        firstText = m[2];
      }
    }
    let body = '';
    blocks.forEach((b, bi) => {
      if (bi === 0 && firstText !== null) {
        if (node.loose) body += '<p>' + checkbox + inline(firstText, refs) + '</p>\n';
        else body += checkbox + inline(firstText, refs);
      } else if (b.t === 'p' && !node.loose) body += inline(b.text, refs);
      else body += renderBlocks([b], refs, false);
    });
    out += '<li>' + body + '</li>\n';
  }
  out += '</' + tag + '>\n';
  return out;
}

function renderTable(node, refs) {
  let out = '<table>\n<thead>\n<tr>\n';
  for (let c = 0; c < node.header.length; c++) {
    const a = node.aligns[c];
    out += '<th' + (a ? ' align="' + a + '"' : '') + '>' + inline(node.header[c], refs) + '</th>\n';
  }
  out += '</tr>\n</thead>\n';
  if (node.rows.length) {
    out += '<tbody>';
    for (const row of node.rows) {
      out += '<tr>\n';
      for (let c = 0; c < row.length; c++) {
        const a = node.aligns[c];
        out += '<td' + (a ? ' align="' + a + '"' : '') + '>' + inline(row[c], refs) + '</td>\n';
      }
      out += '</tr>\n';
    }
    out += '</tbody>';
  }
  out += '</table>\n';
  return out;
}

export function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const refs = new Map();
  const { nodes } = parseBlocks(lines, 0, lines.length, refs);
  return renderBlocks(nodes, refs, false);
}
