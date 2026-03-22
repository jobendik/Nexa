const fs = require('fs');
eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));

const source = fs.readFileSync('OS/nexaos.nx', 'utf8');
const parser = new Parser(source);
const ast = parser.parse();
const codegen = new CodeGenerator();
const vmCode = codegen.generate(ast, 'Main');
const fullVM = STDLIB_VM + '\n' + vmCode;

const vmLines = fullVM.split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).filter(l => l);

const RAM = new Int16Array(65536);
const STACK_TOP = 0xEBF0;
let SP = STACK_TOP;

// Simulate the VM bootstrap properly
// Push fake return frame (like the real bootstrap does)
SP--; RAM[SP & 0xFFFF] = 0xDEAD; // return addr placeholder (halt)
SP--; RAM[SP & 0xFFFF] = STACK_TOP & 0xFFFF; // saved LCL
SP--; RAM[SP & 0xFFFF] = STACK_TOP & 0xFFFF; // saved ARG  
SP--; RAM[SP & 0xFFFF] = 0; // saved THIS
SP--; RAM[SP & 0xFFFF] = 0; // saved THAT
// Now SP = 0xEFEB
RAM[2] = (SP + 0 + 4) & 0xFFFF; // ARG = SP + nArgs + 4 (nArgs=0)
RAM[1] = SP & 0xFFFF; // LCL = SP
RAM[3] = 0; // THIS
RAM[4] = 0; // THAT

const funcMap = {};
vmLines.forEach((l, i) => { if (l.startsWith('function ')) { const p = l.split(/\s+/); funcMap[p[1]] = i; } });
const labels = {};
vmLines.forEach((l, i) => { if (l.startsWith('label ')) { labels[l.split(/\s+/)[1]] = i; } });

function push(v) { SP = (SP - 1) & 0xFFFF; RAM[SP] = v; }
function pop() { const v = RAM[SP]; SP = (SP + 1) & 0xFFFF; return v; }
function s16(v) { return v > 32767 ? v - 65536 : v; }
function u16(v) { return v & 0xFFFF; }

let pc = funcMap['Main.main'];
let stepCount = 0;
let maxSteps = 10000000;
let halted = false;

// Function call tracking
let callDepth = 0;
let lastFuncCalls = [];
let fbWriteCount = 0;
let currentFunc = 'Main.main';
let funcCallLog = [];
let funcEntryCount = {};
let traceEveryN = 1000000;

function mathMultiply(a, b) {
  const sa = s16(a), sb = s16(b);
  return u16(sa * sb);
}
function mathDivide(a, b) {
  const sa = s16(a), sb = s16(b);
  if (sb === 0) return 0;
  return u16(Math.trunc(sa / sb));
}
function mathModulo(a, b) {
  const sa = s16(a), sb = s16(b);
  if (sb === 0) return 0;
  return u16(sa - Math.trunc(sa / sb) * sb);
}

while (pc < vmLines.length && stepCount < maxSteps && !halted) {
  const line = vmLines[pc];
  stepCount++;
  
  if (stepCount % traceEveryN === 0) {
    console.log(`--- Step ${stepCount}: pc=${pc} func=${currentFunc} SP=0x${SP.toString(16)} line="${vmLines[pc]}"`);
  }
  
  if (line.startsWith('function ')) {
    const parts = line.split(/\s+/);
    const nLocals = parseInt(parts[2]);
    currentFunc = parts[1];
    funcEntryCount[currentFunc] = (funcEntryCount[currentFunc] || 0) + 1;
    if (funcEntryCount[currentFunc] <= 3) {
      console.log(`ENTER ${currentFunc} at step ${stepCount} SP=${SP.toString(16)} LCL=${u16(RAM[1]).toString(16)} ARG=${u16(RAM[2]).toString(16)}`);
    }
    for (let i = 0; i < nLocals; i++) push(0);
    pc++; 
    continue;
  }
  if (line.startsWith('label ')) { pc++; continue; }
  
  const parts = line.split(/\s+/);
  const cmd = parts[0];
  
  if (cmd === 'push') {
    const seg = parts[1], idx = parseInt(parts[2]);
    if (seg === 'constant') push(u16(idx));
    else if (seg === 'local') push(RAM[u16(RAM[1] - idx - 1)]);
    else if (seg === 'argument') push(RAM[u16(RAM[2] - idx)]);
    else if (seg === 'this') push(RAM[u16(RAM[3] + idx)]);
    else if (seg === 'that') push(RAM[u16(RAM[4] + idx)]);
    else if (seg === 'temp') push(RAM[5 + idx]);
    else if (seg === 'pointer') push(RAM[idx === 0 ? 3 : 4]);
    else if (seg === 'static') push(RAM[16 + idx]);
  } else if (cmd === 'pop') {
    const seg = parts[1], idx = parseInt(parts[2]);
    const v = pop();
    if (seg === 'local') RAM[u16(RAM[1] - idx - 1)] = v;
    else if (seg === 'argument') RAM[u16(RAM[2] - idx)] = v;
    else if (seg === 'this') RAM[u16(RAM[3] + idx)] = v;
    else if (seg === 'that') {
      RAM[u16(RAM[4] + idx)] = v;
      const addr = u16(RAM[4] + idx);
      if (addr >= 0xEC00 && addr < 0xF560 && fbWriteCount < 300) {
        fbWriteCount++;
        const row = Math.floor((addr - 0xEC00) / 80), col = (addr - 0xEC00) % 80;
        const uv = u16(v);
        const bg = (uv >> 12) & 0xF, fg = (uv >> 8) & 0xF, ch = uv & 0xFF;
        const cch = (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : '?';
        console.log(`FB[${row},${col}] <- 0x${uv.toString(16).padStart(4,'0')} '${cch}' bg=${bg} fg=${fg}`);
      }
    }
    else if (seg === 'temp') RAM[5 + idx] = v;
    else if (seg === 'pointer') RAM[idx === 0 ? 3 : 4] = v;
    else if (seg === 'static') RAM[16 + idx] = v;
  } else if (cmd === 'add') { const b = pop(), a = pop(); push(u16(a + b)); }
  else if (cmd === 'sub') { const b = pop(), a = pop(); push(u16(a - b)); }
  else if (cmd === 'neg') { push(u16(-pop())); }
  else if (cmd === 'and') { const b = pop(), a = pop(); push(u16(a & b)); }
  else if (cmd === 'or') { const b = pop(), a = pop(); push(u16(a | b)); }
  else if (cmd === 'not') { push(u16(~pop())); }
  else if (cmd === 'eq') { const b = pop(), a = pop(); push(a === b ? 0xFFFF : 0); }
  else if (cmd === 'lt') { const b = pop(), a = pop(); push(s16(a) < s16(b) ? 0xFFFF : 0); }
  else if (cmd === 'gt') { const b = pop(), a = pop(); push(s16(a) > s16(b) ? 0xFFFF : 0); }
  else if (cmd === 'goto') { pc = labels[parts[1]]; continue; }
  else if (cmd === 'if-goto') { if (pop() !== 0) { pc = labels[parts[1]]; continue; } }
  else if (cmd === 'call') {
    const fname = parts[1], nArgs = parseInt(parts[2]);
    if (fname === 'Sys.halt') { halted = true; pc++; continue; }
    if (fname === 'Keyboard.readChar' || fname === 'Keyboard.keyPressed') { 
      push(0); // return 0 (no key)
      halted = true; pc++; continue; 
    }
    // Inline math for speed
    if (fname === 'Math.multiply' && nArgs === 2) { const b = pop(), a = pop(); push(mathMultiply(a,b)); pc++; continue; }
    if (fname === 'Math.divide' && nArgs === 2) { const b = pop(), a = pop(); push(mathDivide(a,b)); pc++; continue; }
    if (fname === 'Math.modulo' && nArgs === 2) { const b = pop(), a = pop(); push(mathModulo(a,b)); pc++; continue; }
    if (fname === 'Math.shiftLeft' && nArgs === 2) { const n = pop(), x = pop(); push(u16(s16(x) << s16(n))); pc++; continue; }
    if (fname === 'Math.shiftRight' && nArgs === 2) { const n = pop(), x = pop(); push(u16(s16(x) >> s16(n))); pc++; continue; }
    if (fname === 'Math.xor' && nArgs === 2) { const b = pop(), a = pop(); push(u16(a ^ b)); pc++; continue; }
    if (fname === 'Sys.wait') { pop(); push(0); pc++; continue; }
    
    if (!funcMap.hasOwnProperty(fname)) {
      console.error('Unknown function:', fname, 'at step', stepCount);
      halted = true; pc++; continue;
    }
    
    push(pc + 1);
    push(RAM[1]); push(RAM[2]); push(RAM[3]); push(RAM[4]);
    RAM[2] = u16(SP + nArgs + 4);
    RAM[1] = u16(SP);
    pc = funcMap[fname];
    continue;
  }
  else if (cmd === 'return') {
    const frame = u16(RAM[1]);
    const retAddr = RAM[u16(frame + 4)];
    const retVal = pop();
    RAM[u16(RAM[2])] = retVal;
    SP = u16(RAM[2]);
    RAM[4] = RAM[u16(frame + 0)];
    RAM[3] = RAM[u16(frame + 1)];
    RAM[2] = RAM[u16(frame + 2)];
    RAM[1] = RAM[u16(frame + 3)];
    pc = retAddr;
    continue;
  }
  pc++;
}

console.log('Steps:', stepCount, 'Halted:', halted);
console.log('Cursor pos (0xEFF2):', RAM[0xEFF2]);

// Show framebuffer
for (let row = 0; row < 15; row++) {
  let s = '';
  for (let col = 0; col < 80; col++) {
    const w = u16(RAM[0xEC00 + row * 80 + col]);
    if (w === 0) s += '.';
    else { const ch = w & 0xFF; s += (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : '#'; }
  }
  console.log('R' + (row < 10 ? '0' : '') + row + '|' + s + '|');
}

// Show hex of first few non-zero fb cells
console.log('\nNon-zero framebuffer cells:');
let count = 0;
for (let i = 0; i < 2400 && count < 50; i++) {
  const w = u16(RAM[0xEC00 + i]);
  if (w !== 0) {
    const row = Math.floor(i / 80), col = i % 80;
    const bg = (w >> 12) & 0xF, fg = (w >> 8) & 0xF, ch = w & 0xFF;
    console.log(`  [${row},${col}] = 0x${w.toString(16).padStart(4,'0')} bg=${bg} fg=${fg} ch='${ch >= 32 && ch < 127 ? String.fromCharCode(ch) : '?'}' (${ch})`);
    count++;
  }
}
