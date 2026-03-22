// Application entry point and event wiring
async function main() {
  buildUi();

  const editor = document.getElementById("editor");
  const assembleBtn = document.getElementById("assembleBtn");
  const resetBtn = document.getElementById("resetBtn");
  const stepBtn = document.getElementById("stepBtn");
  const runBtn = document.getElementById("runBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const errorsEl = document.getElementById("errors");
  const listingEl = document.getElementById("listing");
  const regsEl = document.getElementById("registers");
  const uartOutEl = document.getElementById("uartOut");
  const screen = document.getElementById("screen");
  const cpuStatusEl = document.getElementById("cpuStatus");
  const speedEl = document.getElementById("speed");
  const speedLabel = document.getElementById("speedLabel");
  const copyMachineBtn = document.getElementById("copyMachineBtn");
  const downloadMachineBtn = document.getElementById("downloadMachineBtn");
  const loadAluTestBtn = document.getElementById("loadAluTest");
  const loadMemTestBtn = document.getElementById("loadMemTest");
  const loadBranchTestBtn = document.getElementById("loadBranchTest");
  const loadPixelDemoBtn = document.getElementById("loadPixelDemo");

  const breakpointInput = document.getElementById("breakpointInput");
  const addBreakpointBtn = document.getElementById("addBreakpointBtn");
  const clearBreakpointsBtn = document.getElementById("clearBreakpointsBtn");
  const breakpointsEl = document.getElementById("breakpoints");
  const keyboardInput = document.getElementById("keyboardInput");
  const sendKeyboardBtn = document.getElementById("sendKeyboardBtn");
  const sendEnterBtn = document.getElementById("sendEnterBtn");
  const queueInfoEl = document.getElementById("queueInfo");
  const screenProbeEl = document.getElementById("screenProbe");
  const deviceStateEl = document.getElementById("deviceState");
  const symbolsEl = document.getElementById("symbols");
  const memoryGridEl = document.getElementById("memoryGrid");
  const memoryInfoEl = document.getElementById("memoryInfo");
  const memPrevBtn = document.getElementById("memPrevBtn");
  const memNextBtn = document.getElementById("memNextBtn");
  const jumpPcBtn = document.getElementById("jumpPcBtn");
  const jumpFbBtn = document.getElementById("jumpFbBtn");
  const memoryAddrInput = document.getElementById("memoryAddrInput");
  const jumpMemoryBtn = document.getElementById("jumpMemoryBtn");
  const inspectorTabBtns = document.querySelectorAll(".inspector-tab");
  const inspectorPanels = document.querySelectorAll(".tab-panel");
  const compileBtn = document.getElementById("compileBtn");
  const modeToggle = document.getElementById("modeToggle");
  const modeBtns = modeToggle.querySelectorAll(".mode-btn");
  const editorLangTag = document.getElementById("editorLangTag");
  const demoButtonsAsm = document.getElementById("demoButtonsAsm");
  const demoButtonsNexa = document.getElementById("demoButtonsNexa");
  const pipelineTabBtn = document.getElementById("pipelineTabBtn");
  const pipelineVM = document.getElementById("pipelineVM");
  const pipelineASM = document.getElementById("pipelineASM");
  const loadNexaHelloBtn = document.getElementById("loadNexaHello");
  const loadNexaMathBtn = document.getElementById("loadNexaMath");
  const loadNexaPixelBtn = document.getElementById("loadNexaPixel");
  const loadNexaClassBtn = document.getElementById("loadNexaClass");
  const loadNexaDemoSceneBtn = document.getElementById("loadNexaDemoScene");
  const loadNexaOsBtn = document.getElementById("loadNexaOs");
  const uploadDiskBtn = document.getElementById("uploadDiskBtn");
  const uploadDiskFile = document.getElementById("uploadDiskFile");

  var editorMode = "asm"; // will be switched to nexa at init
  var savedAsmSource = "";
  var savedNexaSource = nexaHelloDemo;

  // Main-thread only: assembler + compiler
  var assembler = new Assembler();
  // Sound stays on main thread (needs AudioContext)
  var sound = new SoundGenerator();

  // Graphics renders from framebuffer snapshots sent by worker
  var gfxCtx = screen.getContext("2d");
  var gfxImgData = gfxCtx.createImageData(640, 480);
  var gfxBuf32 = new Uint32Array(gfxImgData.data.buffer);
  var palette32 = new Uint32Array(16);
  for (var pi = 0; pi < 16; pi++) {
    var c = PALETTE[pi];
    var r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    palette32[pi] = 0xFF000000 | (b << 16) | (g << 8) | r;
  }

  function renderFbText(fb) {
    var buf = gfxBuf32;
    var pal = palette32;
    var font = FONT_8X8;
    for (var row = 0; row < 30; row++) {
      var fbRowOff = row * 80;
      var screenRowBase = row * 16 * 640;
      for (var col = 0; col < 80; col++) {
        var word = fb[fbRowOff + col];
        var bgC = pal[(word >> 12) & 15];
        var fgC = pal[(word >> 8) & 15];
        var ch = word & 255;
        var fontBase = ch < 128 ? ch * 8 : -1;
        var colBase = screenRowBase + col * 8;
        for (var py = 0; py < 8; py++) {
          var fb2 = fontBase >= 0 ? font[fontBase + py] : 0;
          var off = colBase + py * 2 * 640;
          buf[off]     = fb2 & 128 ? fgC : bgC;
          buf[off + 1] = fb2 & 64  ? fgC : bgC;
          buf[off + 2] = fb2 & 32  ? fgC : bgC;
          buf[off + 3] = fb2 & 16  ? fgC : bgC;
          buf[off + 4] = fb2 & 8   ? fgC : bgC;
          buf[off + 5] = fb2 & 4   ? fgC : bgC;
          buf[off + 6] = fb2 & 2   ? fgC : bgC;
          buf[off + 7] = fb2 & 1   ? fgC : bgC;
          var off2 = off + 640;
          buf[off2]     = buf[off];
          buf[off2 + 1] = buf[off + 1];
          buf[off2 + 2] = buf[off + 2];
          buf[off2 + 3] = buf[off + 3];
          buf[off2 + 4] = buf[off + 4];
          buf[off2 + 5] = buf[off + 5];
          buf[off2 + 6] = buf[off + 6];
          buf[off2 + 7] = buf[off + 7];
        }
      }
    }
    gfxCtx.putImageData(gfxImgData, 0, 0);
  }

  function renderFbPixel(fb) {
    var buf = gfxBuf32;
    var pal = palette32;
    for (var y = 0; y < 120; y++) {
      var fbRow = y * 40;
      var screenBase = y * 4 * 640;
      for (var xWord = 0; xWord < 40; xWord++) {
        var word = fb[fbRow + xWord];
        var c0 = pal[word >> 12 & 15];
        var c1 = pal[word >> 8 & 15];
        var c2 = pal[word >> 4 & 15];
        var c3 = pal[word & 15];
        var baseX = xWord * 16;
        for (var dy = 0; dy < 4; dy++) {
          var rr = screenBase + dy * 640 + baseX;
          buf[rr] = c0; buf[rr+1] = c0; buf[rr+2] = c0; buf[rr+3] = c0;
          buf[rr+4] = c1; buf[rr+5] = c1; buf[rr+6] = c1; buf[rr+7] = c1;
          buf[rr+8] = c2; buf[rr+9] = c2; buf[rr+10] = c2; buf[rr+11] = c2;
          buf[rr+12] = c3; buf[rr+13] = c3; buf[rr+14] = c3; buf[rr+15] = c3;
        }
      }
    }
    gfxCtx.putImageData(gfxImgData, 0, 0);
  }

  // State
  var uartText = "";
  var lastAssembleCode = new Uint16Array();
  var lastSourceMap = {};
  var lastSymbols = {};
  var lastCompilerWarnings = [];
  var rowByAddr = new Map();
  var currentPcRow = null;
  var running = false;
  var statusMessage = "Klar.";
  var memPageStart = 0xEC00;
  var hoverFramebufferAddr = null;
  var hoverProbeText = "Ingen piksel/celle valgt enn\u00e5.";
  var keyboardQueue = [];
  var breakpoints = new Set();
  var memCellByAddr = new Map();
  var activeInspectorTab = "listing";
  var displayMode = 0;
  var lastFb = new Uint16Array(4800);
  var ws = { A:0,D:0,B:0,SP:0,PC:0,STATUS:0,EPC:0,CAUSE:0,BASE:0,LIMIT:65535,KSP:0,flagN:false,flagZ:false,ie:false,mode:false,cyc:0,halted:false,df:false };
  var wKbSt = 0, wUartRx = 0;
  var regValueEls = null;
  var rafId = 0;
  var pendingRender = false;

  function renderFrame() {
    rafId = 0;
    if (pendingRender) {
      if (displayMode === 0) renderFbText(lastFb); else renderFbPixel(lastFb);
      renderRegisters();
      pendingRender = false;
    }
    if (running) rafId = requestAnimationFrame(renderFrame);
  }

  editor.value = defaultProgram;
  memoryAddrInput.value = "0xEC00";

  // === Create Advanced IDE ===
  var ide = new NexaIDE(editor, {
    mode: 'asm',
    onLint: function(source, mode, callback) {
      try {
        if (mode === 'asm') {
          var lintResult = assembler.assemble(source);
          var lintErrs  = (lintResult.success ? [] : lintResult.errors).map(function(e){ return parseErrorLine(e); });
          var lintWarns = (lintResult.warnings || []).map(function(w){ return parseErrorLine(w); });
          callback(lintErrs, lintWarns);
        } else {
          var lintParser = new Parser(source);
          var lintAst    = lintParser.parse();
          var lintCg     = new CodeGenerator();
          lintCg.generate(lintAst, 'Main');
          var lintW = (lintCg.warnings || []).map(function(w){ return { line: 0, col: 0, message: w }; });
          callback([], lintW);
        }
      } catch (e) {
        callback([parseErrorLine(e.message)], []);
      }
    }
  });

  async function loadWorkerSource() {
    var workerPath = 'js/emulator/emu-worker.js';
    var lastError = null;
    if (typeof fetch === 'function') {
      try {
        var response = await fetch(workerPath);
        if (!response.ok) throw new Error('HTTP ' + response.status + ' while loading worker source');
        return await response.text();
      } catch (e) {
        lastError = e;
      }
    }
    try {
      return await new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', workerPath, true);
        xhr.onload = function() {
          if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) resolve(xhr.responseText);
          else reject(new Error('HTTP ' + xhr.status + ' while loading worker source'));
        };
        xhr.onerror = function() {
          reject(new Error('Network error while loading worker source'));
        };
        xhr.send();
      });
    } catch (e) {
      lastError = e;
    }
    var el = document.getElementById('emuWorkerCode');
    if (el && el.textContent && el.textContent.trim()) return el.textContent;
    if (lastError) throw lastError;
    throw new Error('Worker source is empty');
  }

  // === Create Worker ===
  // Load worker source from file and create as Blob Worker
  var workerSrc;
  var emu;
  try {
    workerSrc = await loadWorkerSource();
  } catch(e) {
    errorsEl.textContent = 'Emulator worker failed to load: ' + e.message;
    setStatus('Emulator worker load failed.');
    console.error(e);
    return;
  }
  try {
    if (!workerSrc || !workerSrc.trim()) throw new Error('Worker source is empty');
    var workerBlob = new Blob([workerSrc], {type: 'application/javascript'});
    var workerBlobUrl = URL.createObjectURL(workerBlob);
    emu = new Worker(workerBlobUrl);
    URL.revokeObjectURL(workerBlobUrl);
  } catch (e) {
    errorsEl.textContent = 'Emulator worker failed to load: ' + e.message;
    setStatus('Emulator worker load failed.');
    console.error(e);
    return;
  }

  // === Worker messages ===
  emu.onmessage = function(e) {
    var msg = e.data;
    switch (msg.t) {
      case "snap": {
        ws = msg.s;
        lastFb = new Uint16Array(msg.fb);
        displayMode = msg.dm;
        wKbSt = msg.ks;
        wUartRx = msg.us;
        if (msg.u && msg.u.length > 0) { uartText += msg.u; uartOutEl.textContent = uartText; }
        if (running) {
          pendingRender = true;
          if (!rafId) rafId = requestAnimationFrame(renderFrame);
        } else {
          if (displayMode === 0) renderFbText(lastFb); else renderFbPixel(lastFb);
          renderRegisters();
          renderDeviceState();
          if (activeInspectorTab === "memory") requestMemPage();
        }
        break;
      }
      case "stop":
        running = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        pendingRender = false;
        if (msg.reason === "bp") statusMessage = "Stoppet p\u00e5 breakpoint ved 0x" + hex(msg.pc) + ".";
        else if (msg.reason === "halted") statusMessage = "Programmet stoppet (HALT).";
        else statusMessage = "Pauset.";
        if (displayMode === 0) renderFbText(lastFb); else renderFbPixel(lastFb);
        renderRegisters(); renderDeviceState();
        if (activeInspectorTab === "memory") requestMemPage();
        renderBreakpoints(); renderSymbols();
        break;
      case "dm":
        displayMode = msg.mode;
        break;
      case "snd":
        sound.write(msg.o, msg.v);
        break;
      case "uploadResult":
        if (msg.ok) setStatus("Uploaded to disk: " + msg.size + " words. Type MOUNT in NexaOS to refresh.");
        else setStatus("Upload failed: " + msg.err);
        break;
      case "memp": {
        var data = new Uint16Array(msg.data);
        renderMemFromData(data, msg.start, msg.len);
        break;
      }
    }
  };

  function requestMemPage() {
    emu.postMessage({t: "mem", start: memPageStart, len: 128});
  }
  function syncBP() { emu.postMessage({t: "bp", a: Array.from(breakpoints)}); }

  // === Rendering ===
  var alignMemPage = function(addr) { return (addr & 65535) & ~0x7F; };
  var setStatus = function(msg) { statusMessage = msg; };

  function clearMachine() {
    running = false; uartText = ""; uartOutEl.textContent = "";
    keyboardQueue = []; queueInfoEl.textContent = "Ingen tegn i k\u00f8.";
    hoverFramebufferAddr = null;
    hoverProbeText = "Ingen piksel/celle valgt enn\u00e5.";
    screenProbeEl.textContent = hoverProbeText;
    if (lastAssembleCode.length) {
      var buf = lastAssembleCode.buffer.slice(0);
      emu.postMessage({t: "reset", code: buf}, [buf]);
    } else {
      emu.postMessage({t: "reset"});
    }
    setStatus("Maskinen ble nullstilt."); screen.focus();
  }

  function renderBreakpoints() {
    if (!breakpoints.size) { breakpointsEl.innerHTML = '<span class="hint">Ingen breakpoints.</span>'; return; }
    var sorted = Array.from(breakpoints).sort(function(a,b){return a-b;});
    breakpointsEl.innerHTML = sorted.map(function(addr) {
      return '<span class="chip">0x' + hex(addr) + ' <button data-remove-bp="' + addr + '">\u00d7</button></span>';
    }).join("");
    breakpointsEl.querySelectorAll("button[data-remove-bp]").forEach(function(btn) {
      btn.addEventListener("click", function(ev) {
        ev.stopPropagation();
        breakpoints.delete(Number(btn.dataset.removeBp));
        syncBP(); renderBreakpoints(); updateListingBPClasses();
      });
    });
  }

  function updateListingBPClasses() {
    rowByAddr.forEach(function(row, addr) {
      row.classList.toggle("breakpoint", breakpoints.has(addr));
      var dot = row.querySelector(".bp-dot");
      if (dot) dot.textContent = breakpoints.has(addr) ? "\u25cf" : "\u00b7";
    });
  }

  function jumpMemoryTo(addr) {
    memPageStart = alignMemPage(addr);
    memoryAddrInput.value = "0x" + hex(memPageStart);
    if (activeInspectorTab !== "memory") setInspectorTab("memory");
    requestMemPage();
  }

  function setInspectorTab(tab) {
    activeInspectorTab = tab;
    inspectorTabBtns.forEach(function(btn) { btn.classList.toggle("active", btn.dataset.tab === tab); });
    inspectorPanels.forEach(function(panel) { panel.classList.toggle("active", panel.dataset.panel === tab); });
    if (tab === "memory") requestMemPage();
    if (tab === "tools") { renderBreakpoints(); renderSymbols(); }
    renderRegisters();
  }

  function keepListingRowVisible(row) {
    if (!row || activeInspectorTab !== "listing") return;
    var rowTop = row.offsetTop;
    var rowBottom = rowTop + row.offsetHeight;
    var viewTop = listingEl.scrollTop;
    var viewBottom = viewTop + listingEl.clientHeight;
    var pad = 28;
    if (rowTop < viewTop + pad) listingEl.scrollTop = Math.max(0, rowTop - pad);
    else if (rowBottom > viewBottom - pad) listingEl.scrollTop = Math.max(0, rowBottom - listingEl.clientHeight + pad);
  }

  function renderSymbols() {
    var entries = Object.entries(lastSymbols).sort(function(a,b){return a[1]-b[1];});
    if (!entries.length) { symbolsEl.textContent = "Ingen symboler."; return; }
    symbolsEl.textContent = entries.map(function(e){return e[0].padEnd(24," ")+"0x"+hex(e[1]);}).join("\n");
  }

  function buildRegDom() {
    var names = ["A","D","B","SP","PC","STATUS","EPC","CAUSE","BASE","LIMIT","KSP","Flags"];
    regValueEls = {};
    regsEl.innerHTML = "";
    for (var i = 0; i < names.length; i++) {
      var d = document.createElement("div"); d.className = "reg";
      var k = document.createElement("div"); k.className = "k"; k.textContent = names[i];
      var v = document.createElement("div"); v.className = "v"; v.textContent = "0x0000";
      d.appendChild(k); d.appendChild(v); regsEl.appendChild(d);
      regValueEls[names[i]] = v;
    }
  }
  buildRegDom();

  function renderRegisters() {
    var s = ws;
    if (!regValueEls) buildRegDom();
    regValueEls["A"].textContent = "0x" + hex(s.A);
    regValueEls["D"].textContent = "0x" + hex(s.D);
    regValueEls["B"].textContent = "0x" + hex(s.B);
    regValueEls["SP"].textContent = "0x" + hex(s.SP);
    regValueEls["PC"].textContent = "0x" + hex(s.PC);
    regValueEls["STATUS"].textContent = "0x" + hex(s.STATUS);
    regValueEls["EPC"].textContent = "0x" + hex(s.EPC);
    regValueEls["CAUSE"].textContent = "0x" + hex(s.CAUSE);
    regValueEls["BASE"].textContent = "0x" + hex(s.BASE);
    regValueEls["LIMIT"].textContent = "0x" + hex(s.LIMIT);
    regValueEls["KSP"].textContent = "0x" + hex(s.KSP);
    regValueEls["Flags"].textContent = "N=" + (s.flagN?1:0) + " Z=" + (s.flagZ?1:0);
    cpuStatusEl.textContent = "cycles=" + s.cyc + " \u00b7 mode=" + (s.mode?"user":"kernel") + " \u00b7 IE=" + (s.ie?1:0) + " \u00b7 halted=" + (s.halted?"yes":"no") + (s.df?" \u00b7 double fault":"") + " \u00b7 " + statusMessage;
    if (currentPcRow) currentPcRow.classList.remove("current");
    currentPcRow = rowByAddr.get(s.PC) || null;
    if (currentPcRow) { currentPcRow.classList.add("current"); if (!running) keepListingRowVisible(currentPcRow); }
  }

  function renderDeviceState() {
    var modeStr = displayMode === 0 ? "text" : "pixel";
    deviceStateEl.textContent = "Display mode: " + modeStr + "\nKeyboard: status=0x" + hex(wKbSt) + "\nUART RX: rxStatus=0x" + hex(wUartRx) + "\nInputk\u00f8: " + keyboardQueue.length + " tegn";
  }

  function renderMemFromData(data, start, len) {
    var s = ws;
    var cells = ['<div class="mem-head">Base</div>'];
    for (var c = 0; c < 8; c++) cells.push('<div class="mem-head">+' + c.toString(16).toUpperCase() + '</div>');
    for (var r = 0; r < 16; r++) {
      var base = (start + r * 8) & 65535;
      cells.push('<div class="mem-row-head">0x' + hex(base) + '</div>');
      for (var c2 = 0; c2 < 8; c2++) {
        var addr = (base + c2) & 65535;
        var idx = addr - start;
        var value = (idx >= 0 && idx < len) ? data[idx] : 0;
        var cls = "mem-cell";
        if (addr === s.PC) cls += " pc";
        if (addr >= 0xEC00 && addr <= 0xFEFF) cls += " fb";
        if (addr >= 0xFF00) cls += " io";
        if (addr === hoverFramebufferAddr) cls += " hover";
        var extra = "";
        if (breakpoints.has(addr)) extra += "BP ";
        if (addr === s.PC) extra += "PC ";
        if (addr >= 0xEC00 && addr <= 0xFEFF) extra += "FB";
        cells.push('<div class="' + cls + '" data-mem-addr="' + addr + '" title="0x' + hex(addr) + '"><div class="addr">0x' + hex(addr) + '</div><div class="val">0x' + hex(value) + '</div><div class="extra">' + (extra || '&nbsp;') + '</div></div>');
      }
    }
    memoryGridEl.innerHTML = cells.join("");
    memoryInfoEl.textContent = "Viser 0x" + hex(start) + "\u20130x" + hex((start + 0x7F) & 65535) + " \u00b7 framebuffer er 0xEC00\u2013FEFF";
    memCellByAddr = new Map();
    memoryGridEl.querySelectorAll("[data-mem-addr]").forEach(function(el) {
      var a = Number(el.dataset.memAddr);
      memCellByAddr.set(a, el);
      el.addEventListener("dblclick", function() { breakpointInput.value = "0x" + hex(a); });
    });
  }

  function renderProbe() { screenProbeEl.textContent = hoverProbeText; }

  function renderDiagnostics(errors, warnings) {
    var blocks = [];
    if (errors && errors.length) blocks.push(errors.join("\n"));
    if (warnings && warnings.length) blocks.push("Advarsler:\n" + warnings.join("\n"));
    errorsEl.textContent = blocks.join("\n\n");
  }

  function renderListing(code, sourceMap, listing) {
    rowByAddr = new Map();
    var rows = ['<div class="list-row header"><div>BP</div><div>Addr</div><div>Hex</div><div>Binary</div><div>Disassembly</div><div>Kilde</div></div>'];
    var entries = listing && listing.length ? listing : null;
    for (var addr = 0; addr < code.length; addr++) {
      var listingEntry = entries ? entries[addr] : null;
      var word = listingEntry ? listingEntry.word : code[addr] || 0;
      var srcEntry = listingEntry ? (listingEntry.line ? { line: listingEntry.line, source: listingEntry.source } : null) : sourceMap[addr];
      var sourceText = srcEntry ? srcEntry.line + ': ' + escapeHtml(srcEntry.source.trim()) : '';
      if (listingEntry && listingEntry.labels && listingEntry.labels.length) {
        sourceText = '<span class="src-label">' + escapeHtml(listingEntry.labels.join(', ')) + '</span>' + (sourceText ? '<br>' + sourceText : '');
      }
      var bp = breakpoints.has(addr);
      rows.push('<div class="list-row' + (bp ? ' breakpoint' : '') + '" data-addr="' + addr + '" title="Klikk for breakpoint"><div class="bp-dot">' + (bp ? '\u25cf' : '\u00b7') + '</div><div>' + addr.toString().padStart(5,"0") + '</div><div>0x' + hex(word) + '</div><div>' + bin16(word) + '</div><div>' + escapeHtml(disassembleInstruction(word)) + '</div><div class="src">' + sourceText + '</div></div>');
    }
    listingEl.innerHTML = rows.join("");
    listingEl.querySelectorAll(".list-row[data-addr]").forEach(function(el) {
      var a = Number(el.dataset.addr);
      rowByAddr.set(a, el);
      el.addEventListener("click", function() {
        if (breakpoints.has(a)) breakpoints.delete(a); else breakpoints.add(a);
        syncBP(); renderBreakpoints(); updateListingBPClasses();
      });
      el.addEventListener("dblclick", function() { jumpMemoryTo(a); });
    });
  }

  function pumpInputQueue() {
    if (!keyboardQueue.length) { queueInfoEl.textContent = "Ingen tegn i k\u00f8."; return; }
    if (wKbSt === 0) {
      var ascii = keyboardQueue.shift();
      emu.postMessage({t: "key", a: ascii});
      setStatus("Sendte tegn 0x" + hex(ascii, 2) + " inn.");
    }
    queueInfoEl.textContent = keyboardQueue.length ? keyboardQueue.length + " tegn venter i k\u00f8." : "Ingen tegn i k\u00f8.";
  }
  setInterval(function() { if (running) pumpInputQueue(); }, 50);

  // === Compile/Assemble (main thread only) ===
  function assembleAndLoad() {
    var result = assembler.assemble(editor.value);
    lastCompilerWarnings = [];
    renderDiagnostics(result.success ? [] : result.errors, result.warnings || []);
    // Update IDE error gutter markers
    ide.setErrors(
      (result.success ? [] : result.errors).map(function(e){ return parseErrorLine(e); }),
      (result.warnings || []).map(function(w){ return parseErrorLine(w); })
    );
    lastSourceMap = result.sourceMap; lastSymbols = result.symbols;
    renderListing(result.code, result.sourceMap, result.listing);
    if (!result.success) { lastAssembleCode = new Uint16Array(); setStatus("Assembly feilet."); return; }
    lastAssembleCode = result.code;
    var buf = result.code.buffer.slice(0);
    emu.postMessage({t: "load", code: buf}, [buf]);
    setStatus("Assemblert: " + result.code.length + " ord lastet.");
    renderRegisters();
  }

  function compileNexaAndLoad() {
    var source = editor.value;
    renderDiagnostics([], []); pipelineVM.textContent = ""; pipelineASM.textContent = "";
    var vmCode;
    try {
      var parser = new Parser(source);
      var ast = parser.parse();
      var codegen = new CodeGenerator();
      vmCode = codegen.generate(ast, "Main");
      lastCompilerWarnings = codegen.warnings.slice();
    } catch (e) {
      var nexaErr = parseErrorLine(e.message);
      ide.setErrors([nexaErr], []);
      renderDiagnostics(["Nexa kompileringsfeil:\n" + e.message], []);
      setStatus("Nexa kompileringsfeil."); return;
    }
    var fullVM = STDLIB_VM + "\n" + vmCode;
    pipelineVM.textContent = vmCode;
    var vmTranslator = new VMTranslator();
    var bootstrap = vmTranslator.bootstrap();
    var vmResult = vmTranslator.translate(fullVM, "Main");
    if (!vmResult.success) {
      renderDiagnostics(["VM-oversetterfeil:\n" + vmResult.errors.join("\n")], lastCompilerWarnings);
      setStatus("VM-oversetterfeil."); return;
    }
    var fullAssembly = bootstrap + "\n" + vmResult.assembly;
    pipelineASM.textContent = fullAssembly;
    var asmResult = assembler.assemble(fullAssembly);
    if (!asmResult.success) {
      renderDiagnostics(["Assembly-feil:\n" + asmResult.errors.join("\n")], lastCompilerWarnings);
      setStatus("Assembly-feil."); return;
    }
    renderDiagnostics([], lastCompilerWarnings);
    ide.setErrors([], lastCompilerWarnings.map(function(w){ return parseErrorLine(w); }));
    lastSourceMap = asmResult.sourceMap; lastSymbols = asmResult.symbols;
    renderListing(asmResult.code, asmResult.sourceMap, asmResult.listing);
    lastAssembleCode = asmResult.code;
    var buf = asmResult.code.buffer.slice(0);
    emu.postMessage({t: "load", code: buf}, [buf]);
    var vmLines = vmCode.split("\n").filter(function(l){return l.trim() && !l.trim().startsWith("//");}).length;
    var asmLines = fullAssembly.split("\n").filter(function(l){return l.trim();}).length;
    setStatus("Nexa kompilert: " + vmLines + " VM -> " + asmLines + " asm -> " + asmResult.code.length + " ord.");
    setInspectorTab("pipeline");
  }

  function compileAndRun() {
    compileNexaAndLoad();
    if (lastAssembleCode.length) {
      running = true; screen.focus();
      setStatus("Kj\u00f8rer Nexa program...");
      emu.postMessage({t: "run", speed: Number(speedEl.value) || 50000});
      if (!rafId) rafId = requestAnimationFrame(renderFrame);
    }
  }

  // === Mode toggle ===
  function setEditorMode(mode) {
    if (mode === editorMode) return;
    if (editorMode === "asm") savedAsmSource = editor.value;
    else savedNexaSource = editor.value;
    editorMode = mode;
    modeBtns.forEach(function(b){b.classList.toggle("active", b.dataset.mode === mode);});
    var isNexa = mode === "nexa";
    assembleBtn.style.display = isNexa ? "none" : "";
    compileBtn.style.display = isNexa ? "" : "none";
    demoButtonsAsm.style.display = isNexa ? "none" : "";
    demoButtonsNexa.style.display = isNexa ? "" : "none";
    pipelineTabBtn.style.display = isNexa ? "" : "none";
    editorLangTag.textContent = isNexa ? "NEXA" : "ASM";
    editorLangTag.className = "editor-lang-tag " + (isNexa ? "nexa-tag" : "asm-tag");
    var newSource = isNexa ? savedNexaSource : savedAsmSource;
    ide.setMode(mode);
    ide.setValue(newSource);
    if (!isNexa) {
      var ap = document.querySelector(".tab-panel.active");
      if (ap && ap.dataset.panel === "pipeline") setInspectorTab("listing");
    }
  }
  modeBtns.forEach(function(btn){btn.addEventListener("click",function(){setEditorMode(btn.dataset.mode);});});

  function loadNexaProgram(source, status) {
    if (editorMode !== "nexa") setEditorMode("nexa");
    ide.setValue(source); savedNexaSource = source;
    compileNexaAndLoad(); setStatus(status);
  }
  function enqueueText(text, appendEnter) {
    for (var i = 0; i < text.length; i++) keyboardQueue.push(text.charCodeAt(i) & 255);
    if (appendEnter) keyboardQueue.push(10);
    setStatus("La " + (text.length + (appendEnter?1:0)) + " tegn i inputk\u00f8.");
    pumpInputQueue();
  }
  function loadProgramText(source, status) {
    ide.setValue(source); assembleAndLoad(); setStatus(status);
  }
  function updateProbeFromEvent(event) {
    var rect = screen.getBoundingClientRect();
    var x = Math.max(0, Math.min(639, Math.floor((event.clientX - rect.left) * (640 / rect.width))));
    var y = Math.max(0, Math.min(479, Math.floor((event.clientY - rect.top) * (480 / rect.height))));
    if (displayMode === 0) {
      var col = Math.floor(x/8), row = Math.floor(y/16);
      var addr = 0xEC00 + row*80 + col;
      var word = lastFb[row*80+col] || 0;
      var ch = word & 255;
      hoverFramebufferAddr = addr;
      hoverProbeText = "Text \u00b7 row=" + row + " col=" + col + " \u00b7 addr=0x" + hex(addr) + " \u00b7 word=0x" + hex(word) + " \u00b7 char=" + (ch>=32&&ch<127?String.fromCharCode(ch):".");
    } else {
      var lx = Math.floor(x/4), ly = Math.floor(y/4);
      var addr2 = 0xEC00 + ly*40 + Math.floor(lx/4);
      var word2 = lastFb[ly*40+Math.floor(lx/4)] || 0;
      var nibble = (word2 >> ((3-(lx%4))*4)) & 0xF;
      hoverFramebufferAddr = addr2;
      hoverProbeText = "Pixel \u00b7 x=" + lx + " y=" + ly + " \u00b7 addr=0x" + hex(addr2) + " \u00b7 word=0x" + hex(word2) + " \u00b7 nibble=" + nibble;
    }
    renderProbe();
  }

  // === Button handlers ===
  assembleBtn.addEventListener("click", assembleAndLoad);
  compileBtn.addEventListener("click", compileAndRun);
  resetBtn.addEventListener("click", function() { clearMachine(); setStatus("Program lastet inn p\u00e5 nytt."); });
  stepBtn.addEventListener("click", function() { emu.postMessage({t:"step",n:1}); });
  runBtn.addEventListener("click", function() {
    if (editorMode === "nexa") { compileAndRun(); }
    else { if (!lastAssembleCode.length) assembleAndLoad(); running = true; screen.focus(); setStatus("Kj\u00f8rer."); emu.postMessage({t:"run",speed:Number(speedEl.value)||50000}); if (!rafId) rafId = requestAnimationFrame(renderFrame); }
  });
  pauseBtn.addEventListener("click", function() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } emu.postMessage({t:"pause"}); setStatus("Pauset."); });

  copyMachineBtn.addEventListener("click", function() {
    var text = Array.from(lastAssembleCode).map(function(w){return "0x"+hex(w);}).join("\n");
    navigator.clipboard.writeText(text); setStatus("Maskinkoden ble kopiert.");
  });
  downloadMachineBtn.addEventListener("click", function() {
    var text = Array.from(lastAssembleCode).map(function(w){return "0x"+hex(w);}).join("\n");
    var blob = new Blob([text], {type:"text/plain"});
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "nexa16_machine_code.txt"; a.click(); URL.revokeObjectURL(a.href);
    setStatus("Maskinkoden ble lagret.");
  });

  uploadDiskBtn.addEventListener("click", function() { uploadDiskFile.click(); });
  uploadDiskFile.addEventListener("change", function() {
    var file = uploadDiskFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function() {
      var text = reader.result;
      var lines = text.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
      var words = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        var val = parseInt(line, line.indexOf("0x") === 0 || line.indexOf("0X") === 0 ? 16 : 10);
        if (isNaN(val)) continue;
        words.push(val & 0xFFFF);
      }
      if (words.length === 0) { setStatus("No valid data in file."); return; }
      // Derive 8.3 filename from uploaded file name
      var rawName = file.name.replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!rawName) rawName = "PROG";
      var name8 = rawName.slice(0, 8);
      while (name8.length < 8) name8 += " ";
      var ext3 = "NXE";
      var nameArr = []; for (var j = 0; j < 8; j++) nameArr.push(name8.charCodeAt(j));
      var extArr = []; for (var j = 0; j < 3; j++) extArr.push(ext3.charCodeAt(j));
      var buf = new Uint16Array(words).buffer;
      emu.postMessage({t: "upload", name: nameArr, ext: extArr, data: buf}, [buf]);
      setStatus("Uploading " + words.length + " words as " + name8.trim() + "." + ext3 + "...");
    };
    reader.readAsText(file);
    uploadDiskFile.value = "";
  });

  loadAluTestBtn.addEventListener("click", function(){loadProgramText(defaultProgram,"ALU-test lastet.");});
  loadMemTestBtn.addEventListener("click", function(){loadProgramText(memTestProgram,"Minnetest lastet.");});
  loadBranchTestBtn.addEventListener("click", function(){loadProgramText(branchTestProgram,"Branch-test lastet.");});
  loadPixelDemoBtn.addEventListener("click", function(){loadProgramText(pixelProgram,"Pikselgradient lastet.");});

  loadNexaHelloBtn.addEventListener("click", function(){loadNexaProgram(nexaHelloDemo,"Nexa Hello World lastet.");});
  loadNexaMathBtn.addEventListener("click", function(){loadNexaProgram(nexaMathDemo,"Nexa Matte-demo lastet.");});
  loadNexaPixelBtn.addEventListener("click", function(){loadNexaProgram(nexaPixelDemo,"Nexa Pikseldemo lastet.");});
  loadNexaClassBtn.addEventListener("click", function(){loadNexaProgram(nexaClassDemo,"Nexa Klassedemo lastet.");});
  loadNexaDemoSceneBtn.addEventListener("click", function(){loadNexaProgram(nexaDemoSceneDemo,"Nexa Demoscene demo lastet.");});
  loadNexaOsBtn.addEventListener("click", function(){loadNexaProgram(nexaOsDemo,"NexaOS lastet.");});

  addBreakpointBtn.addEventListener("click", function() {
    var value = parseFlexibleNumber(breakpointInput.value);
    if (value === null) { setStatus("Ugyldig breakpoint-adresse."); }
    else { breakpoints.add(value); breakpointInput.value = "0x" + hex(value); syncBP(); setStatus("Breakpoint lagt til ved 0x" + hex(value) + "."); }
    renderBreakpoints(); updateListingBPClasses(); renderRegisters();
  });
  clearBreakpointsBtn.addEventListener("click", function() {
    breakpoints.clear(); syncBP(); setStatus("Alle breakpoints fjernet.");
    renderBreakpoints(); updateListingBPClasses(); renderRegisters();
  });

  sendKeyboardBtn.addEventListener("click", function(){ enqueueText(keyboardInput.value,false); keyboardInput.value=""; keyboardInput.focus(); });
  sendEnterBtn.addEventListener("click", function(){ enqueueText(keyboardInput.value,true); keyboardInput.value=""; keyboardInput.focus(); });
  keyboardInput.addEventListener("keydown", function(ev){ if(ev.key==="Enter"){enqueueText(keyboardInput.value,true);keyboardInput.value="";ev.preventDefault();} });

  speedEl.addEventListener("input", function() {
    var sv = Number(speedEl.value);
    speedLabel.textContent = (sv >= 1000000 ? (sv/1000000).toFixed(1) + "M" : sv >= 1000 ? Math.round(sv/1000) + "K" : sv) + " instr./batch";
    emu.postMessage({t:"spd",v:Number(speedEl.value)});
  });

  inspectorTabBtns.forEach(function(btn){btn.addEventListener("click",function(){setInspectorTab(btn.dataset.tab);});});
  memPrevBtn.addEventListener("click", function(){jumpMemoryTo((memPageStart-0x80)&65535);});
  memNextBtn.addEventListener("click", function(){jumpMemoryTo((memPageStart+0x80)&65535);});
  jumpPcBtn.addEventListener("click", function(){jumpMemoryTo(ws.PC);});
  jumpFbBtn.addEventListener("click", function(){jumpMemoryTo(0xEC00);});
  jumpMemoryBtn.addEventListener("click", function(){
    var value = parseFlexibleNumber(memoryAddrInput.value);
    if (value===null) setStatus("Ugyldig minneadresse.");
    else { jumpMemoryTo(value); setStatus("Minnevisning hoppet til 0x"+hex(value)+"."); }
  });

  screen.addEventListener("keydown", function(ev){
    var ascii = asciiFromKey(ev);
    if (ascii !== null) { keyboardQueue.push(ascii); pumpInputQueue(); ev.preventDefault(); }
  });
  screen.addEventListener("click", function(){screen.focus();});
  screen.addEventListener("mousemove", updateProbeFromEvent);
  screen.addEventListener("mouseleave", function(){
    hoverFramebufferAddr = null;
    hoverProbeText = "Ingen piksel/celle valgt enn\u00e5.";
    renderProbe();
  });

  window.addEventListener("beforeunload", function(){ sound.destroy(); emu.terminate(); });

  setInspectorTab("listing");
  // Switch to Nexa mode by default (setEditorMode saves the ASM source first)
  setEditorMode("nexa");
  compileNexaAndLoad();
}
main().catch(function(err) {
  console.error(err);
});
