// Full pipeline test: Nexa → VM → Assembly → Machine code → CPU emulation
const fs = require('fs');

// Load all pipeline components
eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));

// Polyfill for assembler's class syntax
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// Load assembler
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

// Compile Nexa to VM
const source = fs.readFileSync('OS/nexaos.nx', 'utf8');
const parser = new Parser(source);
const ast = parser.parse();
const codegen = new CodeGenerator();
const vmCode = codegen.generate(ast, 'Main');
const fullVM = STDLIB_VM + '\n' + vmCode;
console.log('VM lines:', fullVM.split('\n').length);

// VM to Assembly
const vmTranslator = new VMTranslator();
const bootstrap = vmTranslator.bootstrap();
const vmResult = vmTranslator.translate(fullVM, 'Main');
if (!vmResult.success) { console.error('VM errors:', vmResult.errors); process.exit(1); }
const fullAssembly = bootstrap + '\n' + vmResult.assembly;
console.log('Assembly lines:', fullAssembly.split('\n').length);

// Assembly to machine code
const assembler = new Assembler();
const asmResult = assembler.assemble(fullAssembly);
if (!asmResult.success) { console.error('ASM errors:', asmResult.errors); process.exit(1); }
const code = asmResult.code; // Uint16Array
console.log('Machine code words:', code.length);

// --- Minimal CPU emulator ---
const RAM = new Uint16Array(65536);
// Load program
for (let i = 0; i < code.length; i++) RAM[i] = code[i];
// Set heap pointer after code (like loadProgram does)
if (code.length < 60401) RAM[60401] = code.length;

let A = 0, D = 0, B = 0, SP = 0, PC = 0;
let fN = false, fZ = false;
let halted = false;
let cycles = 0;
const maxCycles = 50000000;

function s16(v) { return (v & 0x8000) ? (v | ~0xFFFF) : v; }

while (cycles < maxCycles && !halted) {
  const instr = RAM[PC];
  PC = (PC + 1) & 0xFFFF;
  const op = (instr >> 12) & 0xF;
  
  switch (op) {
    case 0: { // LDI - load immediate (sign-extended 10-bit)
      const dst = (instr >> 10) & 3;
      const imm10 = instr & 0x3FF;
      const val = ((imm10 ^ 0x200) - 0x200) & 0xFFFF;
      if (dst === 0) A = val; else if (dst === 1) D = val; else if (dst === 2) B = val; else SP = val;
      break;
    }
    case 1: { // LDU - load upper (replace upper 6 bits, keep lower 10)
      const dst = (instr >> 10) & 3;
      const imm6 = instr & 0x3F;
      let cur = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
      const res = (cur & 0x3FF) | ((imm6 & 0x3F) << 10);
      if (dst === 0) A = res; else if (dst === 1) D = res; else if (dst === 2) B = res; else SP = res;
      break;
    }
    case 2: { // ADD
      const dst = (instr >> 10) & 3;
      const src = (instr >> 8) & 3;
      let a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
      let b = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
      const r = (a + b) & 0xFFFF;
      if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
      fZ = r === 0; fN = !!(r & 0x8000);
      break;
    }
    case 3: { // SUB
      const dst = (instr >> 10) & 3;
      const src = (instr >> 8) & 3;
      let a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
      let b = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
      const r = (a - b) & 0xFFFF;
      if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
      fZ = r === 0; fN = !!(r & 0x8000);
      break;
    }
    case 4: { // AND
      const dst = (instr >> 10) & 3;
      const src = (instr >> 8) & 3;
      let a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
      let b = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
      const r = a & b;
      if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
      fZ = r === 0; fN = !!(r & 0x8000);
      break;
    }
    case 5: { // OR
      const dst = (instr >> 10) & 3;
      const src = (instr >> 8) & 3;
      let a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
      let b = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
      const r = a | b;
      if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
      fZ = r === 0; fN = !!(r & 0x8000);
      break;
    }
    case 6: { // ALU2
      const dst = (instr >> 10) & 3;
      const subOp = (instr >> 7) & 7;
      const src = (instr >> 5) & 3;
      let a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
      let r;
      switch (subOp) {
        case 0: r = (~a) & 0xFFFF; break; // NOT
        case 1: r = (a << 1) & 0xFFFF; break; // SHL
        case 2: { const s = (a & 0x8000) ? (a | ~0xFFFF) : a; r = (s >> 1) & 0xFFFF; break; } // ASR
        case 3: { let sv = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP; r = sv & 0xFFFF; break; } // MOV
        case 4: { let sv = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP; r = (a ^ sv) & 0xFFFF; break; } // XOR
        default: r = 0;
      }
      if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
      fZ = r === 0; fN = !!(r & 0x8000);
      break;
    }
    case 7: { // LOAD
      const dst = (instr >> 10) & 3;
      const off8 = instr & 0xFF;
      const offset = ((off8 ^ 0x80) - 0x80);
      const addr = (A + offset) & 0xFFFF;
      const val = RAM[addr];
      if (dst === 0) A = val; else if (dst === 1) D = val; else if (dst === 2) B = val; else SP = val;
      break;
    }
    case 8: { // STORE
      const src = (instr >> 10) & 3;
      const off8 = instr & 0xFF;
      const offset = ((off8 ^ 0x80) - 0x80);
      const addr = (A + offset) & 0xFFFF;
      const sv = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
      RAM[addr] = sv & 0xFFFF;
      break;
    }
    case 9: { // BR (conditional branch)
      const nzp = (instr >> 9) & 7;
      const off9 = instr & 0x1FF;
      const offset = ((off9 ^ 0x100) - 0x100);
      const n = (nzp & 4) ? fN : false;
      const z = (nzp & 2) ? fZ : false;
      const p = (nzp & 1) ? (!fN && !fZ) : false;
      if (n || z || p) PC = (PC + offset) & 0xFFFF;
      break;
    }
    case 10: { // JMP
      PC = A & 0xFFFF;
      break;
    }
    case 11: { // CALL
      SP = (SP - 1) & 0xFFFF;
      RAM[SP] = PC;
      PC = A & 0xFFFF;
      break;
    }
    case 12: { // STACK (PUSH/POP)
      const dir = (instr >> 11) & 1;
      const reg = (instr >> 9) & 3;
      if (dir === 0) { // PUSH
        let v = reg === 0 ? A : reg === 1 ? D : reg === 2 ? B : SP;
        SP = (SP - 1) & 0xFFFF;
        RAM[SP] = v;
      } else { // POP
        const v = RAM[SP];
        if (reg === 3) { SP = v; } // POP SP
        else {
          if (reg === 0) A = v; else if (reg === 1) D = v; else B = v;
          SP = (SP + 1) & 0xFFFF;
        }
      }
      break;
    }
    case 13: // TRAP - just halt for simplicity
    case 14: { // SYS
      halted = true;
      break;
    }
    case 15: { // RET
      PC = RAM[SP];
      SP = (SP + 1) & 0xFFFF;
      break;
    }
  }
  cycles++;
}

console.log('Cycles:', cycles, 'Halted:', halted, 'PC:', PC.toString(16));
console.log('SP:', SP.toString(16), 'A:', A.toString(16), 'D:', D.toString(16), 'B:', B.toString(16));
console.log('RAM[1] (LCL):', RAM[1].toString(16), 'RAM[2] (ARG):', RAM[2].toString(16));
console.log('Heap ptr (0xEFF1):', RAM[0xEFF1]);

// Show framebuffer
for (let row = 0; row < 15; row++) {
  let s = '';
  for (let col = 0; col < 80; col++) {
    const w = RAM[0xEC00 + row * 80 + col];
    if (w === 0) s += '.';
    else { const ch = w & 0xFF; s += (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : '#'; }
  }
  console.log('R' + (row < 10 ? '0' : '') + row + '|' + s + '|');
}

// Show hex of first 50 non-zero fb cells
console.log('\nNon-zero framebuffer cells:');
let count = 0;
for (let i = 0; i < 2400 && count < 50; i++) {
  const w = RAM[0xEC00 + i];
  if (w !== 0) {
    const row = Math.floor(i / 80), col = i % 80;
    const bg = (w >> 12) & 0xF, fg = (w >> 8) & 0xF, ch = w & 0xFF;
    console.log(`  [${row},${col}] = 0x${w.toString(16).padStart(4,'0')} bg=${bg} fg=${fg} ch='${ch >= 32 && ch < 127 ? String.fromCharCode(ch) : '?'}' (${ch})`);
    count++;
  }
}
