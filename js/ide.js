// NexaIDE — Advanced syntax-highlighting code editor
// Overlay technique: transparent textarea on top of a highlighted div
(function () {
  'use strict';

  // ── Token sets ────────────────────────────────────────────────────────────
  const NEXA_KEYWORDS = new Set([
    'class','struct','enum','fn','method','new','return','if','else','while',
    'for','loop','break','continue','pub','static','field','import','const',
    'this','unsafe','syscall','true','false','null','void','let','var','type',
    'is','as','in'
  ]);
  const NEXA_TYPES = new Set(['int','char','bool','void','string']);
  const NEXA_BUILTINS = new Set([
    'Math','Memory','Screen','Output','Keyboard','Sys','Sound','Array','String'
  ]);
  const ASM_OPCODES = new Set([
    'LDI','LDU','ADD','SUB','AND','OR','NOT','SHL','ASR','MOV','XOR',
    'LOAD','STORE','BR','JMP','CALL','PUSH','POP','TRAP','SYS','HALT',
    'IRET','RDCTL','WRCTL','RET','NOP','CLR','INC','DEC','NEG','TST',
    'LDA','CMP','BRA','BRN','BRZ','BRP','BRNZ','BRNP','BRZP',
    'BEQ','BNE','BLT','BLE','BGT','BGE'
  ]);
  const ASM_DIRECTIVES = new Set(['.ORG','.WORD','.STRING','.EQU','.FILL']);
  const ASM_REGISTERS  = new Set(['A','D','B','SP','STATUS','EPC','CAUSE','BASE','LIMIT','KSP']);

  // ── HTML escaping ──────────────────────────────────────────────────────────
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Tokenizers ────────────────────────────────────────────────────────────
  function tokenizeNexa(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      // Single-line comment
      if (ch === '/' && line[i+1] === '/') {
        tokens.push({ type: 'comment', value: line.slice(i) }); break;
      }
      // Block comment (inline portion only)
      if (ch === '/' && line[i+1] === '*') {
        let j = i + 2;
        while (j < line.length - 1 && !(line[j] === '*' && line[j+1] === '/')) j++;
        j = (j < line.length - 1) ? j + 2 : line.length;
        tokens.push({ type: 'comment', value: line.slice(i, j) }); i = j; continue;
      }
      // String literal
      if (ch === '"') {
        let j = i + 1;
        while (j < line.length && !(line[j] === '"' && line[j-1] !== '\\')) j++;
        if (j < line.length) j++;
        tokens.push({ type: 'string', value: line.slice(i, j) }); i = j; continue;
      }
      // Char literal
      if (ch === "'") {
        let j = i + 1;
        while (j < line.length && !(line[j] === "'" && line[j-1] !== '\\')) j++;
        if (j < line.length) j++;
        tokens.push({ type: 'string', value: line.slice(i, j) }); i = j; continue;
      }
      // Number (hex, binary, decimal; optional leading -)
      if (/[0-9]/.test(ch) ||
          (ch === '-' && i+1 < line.length && /[0-9]/.test(line[i+1]) &&
           (i === 0 || /[\s(,=+\-*/<>!&|^~]/.test(line[i-1])))) {
        let j = i;
        if (line[j] === '-') j++;
        if (line[j] === '0' && j+1 < line.length && /[xXbB]/.test(line[j+1])) {
          const re = /[xX]/.test(line[j+1]) ? /[0-9a-fA-F]/ : /[01]/;
          j += 2;
          while (j < line.length && re.test(line[j])) j++;
        } else {
          while (j < line.length && /[0-9]/.test(line[j])) j++;
        }
        tokens.push({ type: 'number', value: line.slice(i, j) }); i = j; continue;
      }
      // Identifier / keyword / type / builtin
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
        const word = line.slice(i, j);
        let type = 'ident';
        if      (NEXA_KEYWORDS.has(word)) type = 'keyword';
        else if (NEXA_TYPES.has(word))    type = 'type';
        else if (NEXA_BUILTINS.has(word)) type = 'builtin';
        else if (j < line.length && line[j] === '(') type = 'function';
        else if (/^[A-Z]/.test(word) && word.length > 1) type = 'class-name';
        tokens.push({ type, value: word }); i = j; continue;
      }
      // Operators and punctuation
      if (/[+\-*/%=!<>&|^~:;,.(){}\[\]]/.test(ch)) {
        let j = i + 1;
        if (i+1 < line.length) {
          const two = line.slice(i, i+2);
          if (['==','!=','<=','>=','&&','||','<<','>>','->','::','+=','-=','*=','/=','//'].includes(two)) j = i + 2;
        }
        const op = line.slice(i, j);
        if (op === '//') { tokens.push({ type: 'comment', value: line.slice(i) }); break; }
        const type = /[;,.()\[\]{}]/.test(op[0]) ? 'punctuation' : 'operator';
        tokens.push({ type, value: op }); i = j; continue;
      }
      // Whitespace
      if (/\s/.test(ch)) {
        let j = i;
        while (j < line.length && /\s/.test(line[j])) j++;
        tokens.push({ type: 'ws', value: line.slice(i, j) }); i = j; continue;
      }
      tokens.push({ type: 'unknown', value: ch }); i++;
    }
    return tokens;
  }

  function tokenizeAsm(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      // Comment
      if (ch === ';' || (ch === '/' && line[i+1] === '/')) {
        tokens.push({ type: 'comment', value: line.slice(i) }); break;
      }
      // String
      if (ch === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j++;
        if (j < line.length) j++;
        tokens.push({ type: 'string', value: line.slice(i, j) }); i = j; continue;
      }
      // Number
      if (/[0-9]/.test(ch) || (ch === '-' && i+1 < line.length && /[0-9]/.test(line[i+1]))) {
        let j = i;
        if (line[j] === '-') j++;
        if (line[j] === '0' && j+1 < line.length && /[xXbB]/.test(line[j+1])) {
          const re = /[xX]/.test(line[j+1]) ? /[0-9a-fA-F]/ : /[01]/;
          j += 2;
          while (j < line.length && re.test(line[j])) j++;
        } else {
          while (j < line.length && /[0-9]/.test(line[j])) j++;
        }
        if (j > i + (line[i] === '-' ? 1 : 0)) {
          tokens.push({ type: 'number', value: line.slice(i, j) }); i = j; continue;
        }
      }
      // Identifier / opcode / directive / register / label
      if (/[a-zA-Z_.]/.test(ch)) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_.]/.test(line[j])) j++;
        const word = line.slice(i, j);
        const upper = word.toUpperCase();
        let type = 'ident';
        if      (ASM_DIRECTIVES.has(upper) || (word[0]==='.' && word.length > 1)) type = 'directive';
        else if (ASM_OPCODES.has(upper))   type = 'opcode';
        else if (ASM_REGISTERS.has(upper)) type = 'register';
        else {
          // Label definition: word followed by ':'
          let k = j;
          while (k < line.length && line[k] === ' ') k++;
          if (k < line.length && line[k] === ':') type = 'label';
        }
        tokens.push({ type, value: word }); i = j; continue;
      }
      // Colon
      if (ch === ':') { tokens.push({ type: 'punctuation', value: ':' }); i++; continue; }
      // Operators
      if (/[,+\-*%=!<>&|^~()[\]]/.test(ch)) {
        tokens.push({ type: 'operator', value: ch }); i++; continue;
      }
      // Whitespace
      if (/\s/.test(ch)) {
        let j = i;
        while (j < line.length && /\s/.test(line[j])) j++;
        tokens.push({ type: 'ws', value: line.slice(i, j) }); i = j; continue;
      }
      tokens.push({ type: 'unknown', value: ch }); i++;
    }
    return tokens;
  }

  function tokensToHtml(tokens) {
    return tokens.map(function (tok) {
      if (tok.type === 'ws') return escHtml(tok.value);
      return '<span class="tok-' + tok.type + '">' + escHtml(tok.value) + '</span>';
    }).join('');
  }

  // ── Error line parser ─────────────────────────────────────────────────────
  function parseErrorLine(msg) {
    if (!msg) return { line: 0, col: 0, message: msg || '' };
    // Assembler: "Linje N: ..."
    let m = msg.match(/^Linje\s+(\d+):\s*(.*)/i);
    if (m) return { line: parseInt(m[1]), col: 0, message: m[2] || msg };
    // Compiler lexer/parser: "... at line N, col M: ..."
    m = msg.match(/at line\s+(\d+),\s*col\s+(\d+):\s*(.*)/i);
    if (m) return { line: parseInt(m[1]), col: parseInt(m[2]), message: m[3] || msg };
    // "... at line N, col M"
    m = msg.match(/at line\s+(\d+),\s*col\s+(\d+)/i);
    if (m) return { line: parseInt(m[1]), col: parseInt(m[2]), message: msg };
    return { line: 0, col: 0, message: msg };
  }

  // ── NexaIDE class ────────────────────────────────────────────────────────
  class NexaIDE {
    constructor(textarea, options) {
      this._origTa = textarea;
      this._opts   = options || {};
      this._mode   = options.mode || 'nexa';
      this._errors = [];
      this._warns  = [];
      this._lintTimer  = null;
      this._acVisible  = false;
      this._acSugs     = [];
      this._acIdx      = 0;
      this._buildUI();
      this._attachEvents();
      this._render();
      this._schedLint();
    }

    // ── Build DOM ──────────────────────────────────────────────────────────
    _buildUI() {
      const orig = this._origTa;
      orig.style.display = 'none';

      // ── Main wrapper (flex row) ─────────────────────────────────────────
      const wrap = document.createElement('div');
      wrap.className = 'ide-wrap';

      // ── Gutter ──────────────────────────────────────────────────────────
      const gutter = document.createElement('div');
      gutter.className = 'ide-gutter';
      this._gutter = gutter;

      // ── Code area ───────────────────────────────────────────────────────
      const codeArea = document.createElement('div');
      codeArea.className = 'ide-code-area';

      // Highlight layer (behind)
      const hl = document.createElement('div');
      hl.className = 'ide-hl';
      hl.setAttribute('aria-hidden', 'true');
      this._hl = hl;

      // Actual textarea (transparent, on top)
      const ta = document.createElement('textarea');
      ta.className = 'ide-ta';
      ta.spellcheck = false;
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocorrect',  'off');
      ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('wrap', 'off');
      ta.value = orig.value;
      this._ta = ta;

      codeArea.appendChild(hl);
      codeArea.appendChild(ta);

      // Error tooltip — appended to body so overflow:hidden doesn't clip it
      const tip = document.createElement('div');
      tip.className = 'ide-tip ide-tip-fixed';
      tip.style.display = 'none';
      this._tip = tip;
      document.body.appendChild(tip);

      // Autocomplete dropdown — also body-level for same reason
      const ac = document.createElement('div');
      ac.className = 'ide-ac ide-ac-fixed';
      ac.style.display = 'none';
      this._ac = ac;
      document.body.appendChild(ac);
      wrap.appendChild(gutter);
      wrap.appendChild(codeArea);

      // ── Status bar ──────────────────────────────────────────────────────
      const sb = document.createElement('div');
      sb.className = 'ide-sb';
      sb.innerHTML =
        '<span class="ide-sb-mode"></span>' +
        '<span class="ide-sb-sep">·</span>' +
        '<span class="ide-sb-pos">Ln 1, Col 1</span>' +
        '<span class="ide-sb-sep">·</span>' +
        '<span class="ide-sb-diag ide-ok">✓ No errors</span>' +
        '<span class="ide-sb-right">Ctrl+Space: autocomplete&nbsp;&nbsp;Ctrl+F: find&nbsp;&nbsp;Ctrl+/: comment&nbsp;&nbsp;Tab: indent</span>';
      this._sb    = sb;
      this._sbMod = sb.querySelector('.ide-sb-mode');
      this._sbPos = sb.querySelector('.ide-sb-pos');
      this._sbDiag= sb.querySelector('.ide-sb-diag');
      this._sbMod.textContent = this._mode === 'nexa' ? 'Nexa' : 'ASM';

      // ── Find/Replace bar ────────────────────────────────────────────────
      const fb = document.createElement('div');
      fb.className = 'ide-fb';
      fb.style.display = 'none';
      fb.innerHTML =
        '<div class="ide-fb-row">' +
          '<span class="ide-fb-label">Find</span>' +
          '<input class="ide-fb-inp" id="ideFbFind" placeholder="Search...">' +
          '<button class="ide-fb-btn" id="ideFbPrev" title="Shift+Enter">↑</button>' +
          '<button class="ide-fb-btn" id="ideFbNext" title="Enter">↓</button>' +
          '<span class="ide-fb-cnt" id="ideFbCnt"></span>' +
          '<button class="ide-fb-btn ide-fb-x" id="ideFbClose">✕</button>' +
        '</div>' +
        '<div class="ide-fb-row" id="ideFbReplRow">' +
          '<span class="ide-fb-label">Replace</span>' +
          '<input class="ide-fb-inp" id="ideFbRepl" placeholder="Replace with...">' +
          '<button class="ide-fb-btn" id="ideFbReplOne">Replace</button>' +
          '<button class="ide-fb-btn" id="ideFbReplAll">All</button>' +
        '</div>';
      this._fb     = fb;
      this._fbFind = fb.querySelector('#ideFbFind');
      this._fbRepl = fb.querySelector('#ideFbRepl');
      this._fbCnt  = fb.querySelector('#ideFbCnt');
      this._fbReplRow = fb.querySelector('#ideFbReplRow');

      // ── Insert into DOM ─────────────────────────────────────────────────
      const parent = orig.parentNode;
      parent.insertBefore(wrap, orig.nextSibling);
      parent.insertBefore(sb,   wrap.nextSibling);
      parent.insertBefore(fb,   sb.nextSibling);

      this._wrap     = wrap;
      this._codeArea = codeArea;
    }

    // ── Events ────────────────────────────────────────────────────────────
    _attachEvents() {
      const ta = this._ta;

      ta.addEventListener('scroll', () => this._syncScroll());
      ta.addEventListener('input',  () => {
        this._origTa.value = ta.value;
        this._render();
        this._updatePos();
        this._schedLint();
        this._maybeAc();
      });
      ta.addEventListener('keyup',  () => this._updatePos());
      ta.addEventListener('click',  () => { this._updatePos(); this._hideAc(); });
      ta.addEventListener('keydown', ev => this._onKey(ev));

      // Autocomplete click
      this._ac.addEventListener('mousedown', ev => {
        ev.preventDefault();
        const item = ev.target.closest('.ide-ac-item');
        if (item) this._acceptAc(item.dataset.val);
      });

      // Gutter tooltip (body-level, fixed position)
      this._gutter.addEventListener('mouseover', ev => {
        const icon = ev.target.closest('[data-diag]');
        if (!icon) return;
        const msgs = (icon.dataset.diag || '').split('|').filter(Boolean);
        if (!msgs.length) return;
        this._tip.textContent = msgs.join('\n');
        const ir = icon.getBoundingClientRect();
        this._tip.style.top  = (ir.bottom + 4) + 'px';
        this._tip.style.left = ir.left + 'px';
        this._tip.style.display = 'block';
      });
      this._gutter.addEventListener('mouseout', () => { this._tip.style.display = 'none'; });

      // Find bar
      this._fbFind.addEventListener('input', () => this._findAll());
      this._fb.querySelector('#ideFbPrev').addEventListener('click',    () => this._findPrev());
      this._fb.querySelector('#ideFbNext').addEventListener('click',    () => this._findNext());
      this._fb.querySelector('#ideFbClose').addEventListener('click',   () => this._closeFb());
      this._fb.querySelector('#ideFbReplOne').addEventListener('click', () => this._replOne());
      this._fb.querySelector('#ideFbReplAll').addEventListener('click', () => this._replAll());
      this._fbFind.addEventListener('keydown', ev => {
        if (ev.key === 'Enter')  { ev.shiftKey ? this._findPrev() : this._findNext(); ev.preventDefault(); }
        if (ev.key === 'Escape') { this._closeFb(); ev.preventDefault(); }
      });
    }

    _syncScroll() {
      this._hl.scrollTop     = this._ta.scrollTop;
      this._hl.scrollLeft    = this._ta.scrollLeft;
      this._gutter.scrollTop = this._ta.scrollTop;
    }

    // ── Render ────────────────────────────────────────────────────────────
    _render() {
      const source = this._ta.value;
      const lines  = source.split('\n');
      const tok    = this._mode === 'nexa' ? tokenizeNexa : tokenizeAsm;

      const errMap  = new Map();
      const warnMap = new Map();
      this._errors.forEach(e => { if (!errMap.has(e.line))  errMap.set(e.line,  []); errMap.get(e.line).push(e.message); });
      this._warns.forEach(w  => { if (!warnMap.has(w.line)) warnMap.set(w.line, []); warnMap.get(w.line).push(w.message); });

      let hlHtml = '', gutterHtml = '';
      for (let i = 0; i < lines.length; i++) {
        const ln = i + 1;
        const hasErr  = errMap.has(ln);
        const hasWarn = !hasErr && warnMap.has(ln);
        const cls = hasErr ? ' ide-line-err' : hasWarn ? ' ide-line-warn' : '';
        hlHtml += '<div class="ide-line' + cls + '">' + tokensToHtml(tok(lines[i])) + '</div>';

        let icon = '';
        if (hasErr) {
          const d = errMap.get(ln).join('|').replace(/"/g, '&quot;');
          icon = '<span class="ide-diag-e" data-diag="' + d + '">!</span>';
        } else if (hasWarn) {
          const d = warnMap.get(ln).join('|').replace(/"/g, '&quot;');
          icon = '<span class="ide-diag-w" data-diag="' + d + '">▲</span>';
        }
        gutterHtml += '<div class="ide-gr"><span class="ide-ln">' + ln + '</span>' + icon + '</div>';
      }
      this._hl.innerHTML     = hlHtml;
      this._gutter.innerHTML = gutterHtml;
      this._syncScroll();
    }

    _updatePos() {
      const ta   = this._ta;
      const text = ta.value.substring(0, ta.selectionStart);
      const lines = text.split('\n');
      const ln   = lines.length;
      const col  = lines[ln - 1].length + 1;
      this._sbPos.textContent = 'Ln ' + ln + ', Col ' + col;
    }

    // ── Lint ──────────────────────────────────────────────────────────────
    _schedLint() {
      clearTimeout(this._lintTimer);
      this._lintTimer = setTimeout(() => this._runLint(), 650);
    }

    _runLint() {
      if (!this._opts.onLint) return;
      this._opts.onLint(this._ta.value, this._mode, (errors, warns) => {
        this._errors = errors || [];
        this._warns  = warns  || [];
        this._render();
        this._updateDiag();
      });
    }

    _updateDiag() {
      const ec = this._errors.length, wc = this._warns.length;
      if (ec) {
        this._sbDiag.textContent = '✕ ' + ec + ' error' + (ec > 1 ? 's' : '');
        this._sbDiag.className = 'ide-sb-diag ide-has-err';
      } else if (wc) {
        this._sbDiag.textContent = '⚠ ' + wc + ' warning' + (wc > 1 ? 's' : '');
        this._sbDiag.className = 'ide-sb-diag ide-has-warn';
      } else {
        this._sbDiag.textContent = '✓ No errors';
        this._sbDiag.className = 'ide-sb-diag ide-ok';
      }
    }

    // ── Key handling ──────────────────────────────────────────────────────
    _onKey(ev) {
      const ctrl = ev.ctrlKey || ev.metaKey;
      // Ctrl+F: find
      if (ctrl && !ev.altKey && ev.key === 'f') { ev.preventDefault(); this._openFb(false); return; }
      // Ctrl+H: replace
      if (ctrl && !ev.altKey && ev.key === 'h') { ev.preventDefault(); this._openFb(true); return; }
      // Ctrl+/: toggle comment
      if (ctrl && !ev.altKey && ev.key === '/') { ev.preventDefault(); this._toggleComment(); return; }
      // Ctrl+D: select next occurrence
      if (ctrl && !ev.altKey && ev.key === 'd') { ev.preventDefault(); this._selectNext(); return; }
      // Ctrl+Space: autocomplete
      if (ctrl && ev.key === ' ') { ev.preventDefault(); this._triggerAc(); return; }

      if (ev.key === 'Escape') {
        if (this._acVisible) { this._hideAc(); ev.preventDefault(); }
        else if (this._fb.style.display !== 'none') { this._closeFb(); ev.preventDefault(); }
        return;
      }
      if (this._acVisible) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); this._acIdx = (this._acIdx + 1) % this._acSugs.length; this._renderAc(); return; }
        if (ev.key === 'ArrowUp')   { ev.preventDefault(); this._acIdx = (this._acIdx - 1 + this._acSugs.length) % this._acSugs.length; this._renderAc(); return; }
        if (ev.key === 'Tab' || ev.key === 'Enter') {
          if (this._acSugs.length) { ev.preventDefault(); this._acceptAc(this._acSugs[this._acIdx]); return; }
        }
      }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        if (ev.shiftKey) this._unindent(); else this._insert('  ');
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault(); this._autoEnter(); return;
      }
    }

    _insert(text) {
      const ta = this._ta;
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = ta.value.substring(0, s) + text + ta.value.substring(e);
      ta.selectionStart = ta.selectionEnd = s + text.length;
      ta.dispatchEvent(new Event('input'));
    }

    _autoEnter() {
      const ta   = this._ta;
      const pos  = ta.selectionStart;
      const text = ta.value;
      const lStart = text.lastIndexOf('\n', pos - 1) + 1;
      const curLine = text.substring(lStart, pos);
      const indent  = (curLine.match(/^(\s*)/) || ['',''])[1];
      const extra   = curLine.trimEnd().endsWith('{') ? '  ' : '';
      this._insert('\n' + indent + extra);
    }

    _unindent() {
      const ta  = this._ta;
      const pos = ta.selectionStart;
      const txt = ta.value;
      const ls  = txt.lastIndexOf('\n', pos - 1) + 1;
      const line = txt.substring(ls, pos);
      const rm = line.startsWith('  ') ? 2 : line.startsWith('\t') ? 1 : 0;
      if (!rm) return;
      ta.value = txt.substring(0, ls) + line.substring(rm) + txt.substring(pos);
      ta.selectionStart = ta.selectionEnd = Math.max(ls, pos - rm);
      ta.dispatchEvent(new Event('input'));
    }

    _toggleComment() {
      const ta  = this._ta;
      const pos = ta.selectionStart;
      const txt = ta.value;
      const ls  = txt.lastIndexOf('\n', pos - 1) + 1;
      const le  = txt.indexOf('\n', pos);
      const end = le === -1 ? txt.length : le;
      const line    = txt.substring(ls, end);
      const cc      = this._mode === 'nexa' ? '//' : '; ';
      const trimmed = line.trimStart();
      const spaces  = line.length - trimmed.length;
      const newLine = trimmed.startsWith(cc)
        ? line.substring(0, spaces) + trimmed.substring(cc.length)
        : line.substring(0, spaces) + cc + trimmed;
      ta.value = txt.substring(0, ls) + newLine + txt.substring(end);
      ta.selectionStart = ta.selectionEnd = pos + (newLine.length - line.length);
      ta.dispatchEvent(new Event('input'));
    }

    _selectNext() {
      const ta  = this._ta;
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      if (!sel || sel.includes('\n')) return;
      const idx = ta.value.indexOf(sel, ta.selectionEnd);
      if (idx !== -1) { ta.selectionStart = idx; ta.selectionEnd = idx + sel.length; ta.focus(); }
    }

    // ── Autocomplete ──────────────────────────────────────────────────────
    _keywords() {
      if (this._mode === 'nexa')
        return [...NEXA_KEYWORDS, ...NEXA_TYPES, ...NEXA_BUILTINS];
      return [...ASM_OPCODES, ...ASM_DIRECTIVES, ...ASM_REGISTERS];
    }

    _prefix() {
      const text = this._ta.value.substring(0, this._ta.selectionStart);
      const m = text.match(/[\w.]+$/);
      return m ? m[0] : '';
    }

    _maybeAc() {
      const p = this._prefix();
      if (p.length >= 2) this._showAc(p); else this._hideAc();
    }

    _triggerAc() { this._showAc(this._prefix()); }

    _showAc(prefix) {
      const all = this._keywords();
      const sugs = prefix
        ? all.filter(k => k.toLowerCase().startsWith(prefix.toLowerCase()) && k !== prefix)
        : all;
      if (!sugs.length) { this._hideAc(); return; }
      this._acSugs = sugs.slice(0, 12);
      this._acIdx  = 0;
      this._renderAc();

      // Position near cursor using viewport coordinates (body-level)
      const ta  = this._ta;
      const pos = ta.selectionStart;
      const before = ta.value.substring(0, pos).split('\n');
      const lineNum = before.length;
      const colNum  = before[before.length - 1].length;
      const lh = 18, cw = 7.8, pad = 12;
      const taRect = ta.getBoundingClientRect();
      let top  = taRect.top  + lineNum * lh + pad - ta.scrollTop;
      let left = taRect.left + colNum  * cw + pad - ta.scrollLeft;
      // Clamp so dropdown stays within viewport
      const vpH = window.innerHeight, vpW = window.innerWidth;
      if (top + 220 > vpH) top = top - 220 - lh; // flip above cursor
      left = Math.max(4, Math.min(left, vpW - 210));
      this._ac.style.top  = Math.max(4, top)  + 'px';
      this._ac.style.left = left + 'px';
      this._ac.style.display = 'block';
      this._acVisible = true;
    }

    _renderAc() {
      const typeMap = this._mode === 'nexa' ? {
        ...Object.fromEntries([...NEXA_KEYWORDS].map(k => [k,'kw'])),
        ...Object.fromEntries([...NEXA_TYPES].map(k    => [k,'ty'])),
        ...Object.fromEntries([...NEXA_BUILTINS].map(k => [k,'bi'])),
      } : {
        ...Object.fromEntries([...ASM_OPCODES].map(k    => [k,'op'])),
        ...Object.fromEntries([...ASM_DIRECTIVES].map(k => [k,'di'])),
        ...Object.fromEntries([...ASM_REGISTERS].map(k  => [k,'rg'])),
      };
      const labels = { kw:'keyword', ty:'type', bi:'builtin', op:'opcode', di:'directive', rg:'register' };
      this._ac.innerHTML = this._acSugs.map((s, i) => {
        const t = typeMap[s] || typeMap[s.toUpperCase()] || 'id';
        const label = labels[t] || 'ident';
        return '<div class="ide-ac-item' + (i === this._acIdx ? ' ide-ac-sel' : '') +
               '" data-val="' + escHtml(s) + '">' +
               '<span class="ide-ac-badge ide-ac-' + t + '">' + (t[0]||'i').toUpperCase() + '</span>' +
               '<span class="ide-ac-name">' + escHtml(s) + '</span>' +
               '<span class="ide-ac-kind">' + label + '</span>' +
               '</div>';
      }).join('');
    }

    _acceptAc(value) {
      const ta   = this._ta;
      const pos  = ta.selectionStart;
      const text = ta.value.substring(0, pos);
      const m    = text.match(/[\w.]+$/);
      const pfx  = m ? m[0] : '';
      const start = pos - pfx.length;
      ta.value = ta.value.substring(0, start) + value + ta.value.substring(pos);
      ta.selectionStart = ta.selectionEnd = start + value.length;
      this._hideAc();
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    }

    _hideAc() {
      this._ac.style.display = 'none';
      this._acVisible = false;
      this._acSugs = [];
    }

    // ── Find / Replace ────────────────────────────────────────────────────
    _openFb(showReplace) {
      this._fb.style.display = 'block';
      this._fbReplRow.style.display = showReplace ? '' : 'none';
      const sel = this._ta.value.substring(this._ta.selectionStart, this._ta.selectionEnd);
      if (sel && !sel.includes('\n')) this._fbFind.value = sel;
      this._fbFind.focus();
      this._fbFind.select();
      this._findAll();
    }

    _closeFb() {
      this._fb.style.display = 'none';
      this._fbCnt.textContent = '';
      this._ta.focus();
    }

    _findAll() {
      const needle = this._fbFind.value;
      if (!needle) { this._fbCnt.textContent = ''; return; }
      let count = 0, idx = 0;
      while ((idx = this._ta.value.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
      this._fbCnt.textContent = count ? count + ' match' + (count > 1 ? 'es' : '') : 'No matches';
    }

    _findNext() {
      const needle = this._fbFind.value;
      if (!needle) return;
      const ta  = this._ta;
      let idx = ta.value.indexOf(needle, ta.selectionEnd);
      if (idx === -1) idx = ta.value.indexOf(needle, 0);
      if (idx !== -1) { ta.selectionStart = idx; ta.selectionEnd = idx + needle.length; ta.focus(); }
    }

    _findPrev() {
      const needle = this._fbFind.value;
      if (!needle) return;
      const ta  = this._ta;
      let idx = ta.value.lastIndexOf(needle, ta.selectionStart - needle.length - 1);
      if (idx === -1) idx = ta.value.lastIndexOf(needle);
      if (idx !== -1) { ta.selectionStart = idx; ta.selectionEnd = idx + needle.length; ta.focus(); }
    }

    _replOne() {
      const needle = this._fbFind.value;
      const repl   = this._fbRepl.value;
      const ta     = this._ta;
      const sel    = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      if (sel === needle) {
        const s = ta.selectionStart;
        ta.value = ta.value.substring(0, s) + repl + ta.value.substring(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + repl.length;
        ta.dispatchEvent(new Event('input'));
      }
      this._findNext();
    }

    _replAll() {
      const needle = this._fbFind.value;
      if (!needle) return;
      this._ta.value = this._ta.value.split(needle).join(this._fbRepl.value);
      this._ta.dispatchEvent(new Event('input'));
      this._findAll();
    }

    // ── Public API ────────────────────────────────────────────────────────
    getValue()       { return this._ta.value; }
    focus()          { this._ta.focus(); }

    setValue(value) {
      this._ta.value = value;
      this._origTa.value = value;
      this._render();
      this._schedLint();
    }

    setMode(mode) {
      this._mode = mode;
      this._sbMod.textContent = mode === 'nexa' ? 'Nexa' : 'ASM';
      this._hideAc();
      this._render();
      this._schedLint();
    }

    setErrors(errors, warns) {
      this._errors = errors || [];
      this._warns  = warns  || [];
      this._render();
      this._updateDiag();
    }
  }

  window.NexaIDE      = NexaIDE;
  window.parseErrorLine = parseErrorLine;
})();
