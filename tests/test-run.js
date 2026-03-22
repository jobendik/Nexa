// Test the RUN command: upload a program to disk, boot NexaOS, FORMAT, MOUNT, RUN
const fs = require('fs');

// Load the emulator worker code (eval into this context)
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// We need the CPU, Memory, DiskController etc from emu-worker
// Parse them out — eval the class definitions only
const workerSrc = fs.readFileSync('js/emulator/emu-worker.js', 'utf8');
// Extract up to "// === Worker handler ===" to get just the class defs
const handlerIdx = workerSrc.indexOf('// === Worker handler ===');
const classDefs = handlerIdx > 0 ? workerSrc.slice(0, handlerIdx) : workerSrc.slice(0, workerSrc.indexOf('var cpu, memory'));
eval(classDefs);

// Load compiler pipeline
eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

// === Compile NexaOS ===
const nexaosSrc = fs.readFileSync('OS/nexaos.nx', 'utf8');
const parser = new Parser(nexaosSrc);
const ast = parser.parse();
const codegen = new CodeGenerator();
const vmCode = codegen.generate(ast, 'Main');
const fullVM = STDLIB_VM + '\n' + vmCode;
const vmt = new VMTranslator();
const bootstrap = vmt.bootstrap();
const vmResult = vmt.translate(fullVM, 'Main');
if (!vmResult.success) { console.error('VM translation failed:', vmResult.errors); process.exit(1); }
const fullAsm = bootstrap + '\n' + vmResult.assembly;
const asmResult = new Assembler().assemble(fullAsm);
if (!asmResult.success) { console.error('Assembly failed:', asmResult.errors); process.exit(1); }
const osCode = asmResult.code;
console.log('NexaOS compiled:', osCode.length, 'words');

// === Create a tiny test program ===
// This program writes "HELLO" to the framebuffer and halts
// Using raw machine instructions:
//   LDA A, 0xEC00     (LDI A, 0 + LDU A, 60)
//   LDA D, 0x0F48     (LDI D, 0x148 + LDU D, 3)   -- 'H' white on black
//   STORE D, [A+0]
//   LDA D, 0x0F45     (LDI D, 0x145 + LDU D, 3)   -- 'E'
//   STORE D, [A+1]
//   LDA D, 0x0F4C     (LDI D, 0x14C + LDU D, 3)   -- 'L'
//   STORE D, [A+2]
//   STORE D, [A+3]                                    -- 'L' again
//   LDA D, 0x0F4F     (LDI D, 0x14F + LDU D, 3)   -- 'O'
//   STORE D, [A+4]
//   HALT

// Actually, let's compile a simple Nexa program instead
const testSrc = `
fn main() {
    // Clear a bit of screen and write HELLO
    poke(0xFF30, 0);  // text mode
    poke(0xEC00, 0x0F48);  // H
    poke(0xEC01, 0x0F45);  // E
    poke(0xEC02, 0x0F4C);  // L
    poke(0xEC03, 0x0F4C);  // L
    poke(0xEC04, 0x0F4F);  // O
    halt();
}
`;
const testParser = new Parser(testSrc);
const testAst = testParser.parse();
const testCg = new CodeGenerator();
const testVm = testCg.generate(testAst, 'Main');
const testFullVm = STDLIB_VM + '\n' + testVm;
const testVmt = new VMTranslator();
const testBoot = testVmt.bootstrap();
const testVmr = testVmt.translate(testFullVm, 'Main');
const testFullAsm = testBoot + '\n' + testVmr.assembly;
const testAsmR = new Assembler().assemble(testFullAsm);
if (!testAsmR.success) { console.error('Test program assembly failed'); process.exit(1); }
const testCode = testAsmR.code;
console.log('Test program compiled:', testCode.length, 'words');

// === Set up emulated machine ===
const memory = new Memory();
const cpu = new CPU(memory);
const display = new DisplayController();
const keyboard = new Keyboard();
const system = new SystemControl();
const timer = new Timer();
const uart = new UART();
const disk = new DiskController();

memory.registerDevice(65280, keyboard);
memory.registerDevice(65296, timer);
memory.registerDevice(65312, uart);
memory.registerDevice(65328, display);
memory.registerDevice(65360, disk);
memory.registerDevice(65520, system);
display.setModeChangeCallback(function(){});
disk.setDMA(
  function(addr) { return memory.read(addr); },
  function(addr, val) { memory.write(addr, val); }
);
uart.setOutputCallback(function(){});

// Load NexaOS
memory.loadProgram(osCode);
cpu.reset();
cpu.PC = 0;
cpu.SP = 0;

// Helper to run until halted or waiting for keyboard
function runUntilIdle(maxCycles) {
  let ran = 0;
  while (ran < maxCycles && !cpu.halted) {
    cpu.step();
    // Service timer/interrupts
    if (timer.tick && timer.tick()) system.setInterrupt(0);
    if (keyboard.hasPendingInterrupt()) system.setInterrupt(1);
    if (disk.hasPendingInterrupt && disk.hasPendingInterrupt()) system.setInterrupt(4);
    ran++;
    // Check if CPU is waiting for keyboard input (stuck in a read loop)
    // The keyboard read polls 0xFF00, if keyboard.status == 0, it loops
    if (ran > 1000000 && keyboard.status === 0) {
      // Check if we're in a tight loop (PC hasn't moved much)
      break;
    }
  }
  return ran;
}

// Helper to type a string and press Enter
function typeAndEnter(str) {
  for (let i = 0; i < str.length; i++) {
    keyboard.keyDown(str.charCodeAt(i));
    runUntilIdle(500000);
  }
  keyboard.keyDown(10); // Enter
  runUntilIdle(5000000);
}

// === Boot NexaOS ===
console.log('\n--- Booting NexaOS ---');
runUntilIdle(50000000);
console.log('Boot done. PC:', cpu.PC.toString(16), 'Halted:', cpu.halted);

// Check banner is showing
let row2 = '';
for (let i = 0; i < 30; i++) {
  let ch = memory.ram[0xEC00 + 160 + i] & 0xFF;
  if (ch >= 32 && ch < 127) row2 += String.fromCharCode(ch);
}
console.log('Row 2:', row2.trim());

// === Type FORMAT ===
console.log('\n--- Typing FORMAT ---');
typeAndEnter('FORMAT');
// Confirm with Y
keyboard.keyDown(89); // 'Y'
runUntilIdle(10000000);
console.log('After FORMAT. PC:', cpu.PC.toString(16));

// Check disk is formatted
console.log('Disk sector 0 word 0:', '0x' + disk.storage[0].toString(16));
console.log('Disk formatted:', disk.storage[0] === 0x4844 ? 'YES' : 'NO');

// === Upload test program to disk ===
console.log('\n--- Uploading test program to disk ---');
const SECTOR_SIZE_T = 128;
const FAT_OFF = 1 * SECTOR_SIZE_T;
const DIR_OFF = 3 * SECTOR_SIZE_T;

// Write test program as file "TEST.NXE" to disk
// (Same logic as the worker upload handler)
const fileName = [84, 69, 83, 84, 32, 32, 32, 32]; // "TEST    "
const fileExt = [78, 88, 69]; // "NXE"

// Find free dir entry
let dirIdx = -1;
for (let i = 0; i < 16; i++) {
  if (!(disk.storage[DIR_OFF + i * 16 + 11] & 1)) { dirIdx = i; break; }
}
console.log('Dir entry:', dirIdx);

// Allocate sectors
const sectorsNeeded = Math.ceil(testCode.length / SECTOR_SIZE_T);
console.log('Sectors needed:', sectorsNeeded);

let firstSec = -1, prevSec = -1;
for (let s = 0; s < sectorsNeeded; s++) {
  let freeSec = -1;
  for (let k = 5; k < 256; k++) {
    if (disk.storage[FAT_OFF + k] === 0) { freeSec = k; break; }
  }
  if (freeSec < 0) { console.error('DISK FULL'); process.exit(1); }
  disk.storage[FAT_OFF + freeSec] = 0xFFFF;
  if (prevSec >= 0) disk.storage[FAT_OFF + prevSec] = freeSec;
  if (firstSec < 0) firstSec = freeSec;
  prevSec = freeSec;
  const soff = freeSec * SECTOR_SIZE_T;
  const doff = s * SECTOR_SIZE_T;
  for (let w = 0; w < SECTOR_SIZE_T; w++) {
    disk.storage[soff + w] = (doff + w < testCode.length) ? testCode[doff + w] : 0;
  }
}

// Write dir entry
const de = DIR_OFF + dirIdx * 16;
for (let j = 0; j < 8; j++) disk.storage[de + j] = fileName[j];
for (let j = 0; j < 3; j++) disk.storage[de + 8 + j] = fileExt[j];
disk.storage[de + 11] = 1;
disk.storage[de + 12] = firstSec;
disk.storage[de + 13] = testCode.length;

console.log('File written: TEST.NXE, firstSec:', firstSec, 'size:', testCode.length);

// === Type MOUNT to refresh filesystem ===
console.log('\n--- Typing MOUNT ---');
typeAndEnter('MOUNT');
console.log('After MOUNT. PC:', cpu.PC.toString(16));

// === Type DIR to verify ===
console.log('\n--- Typing DIR ---');
typeAndEnter('DIR');

// Read screen rows for DIR output
for (let r = 0; r < 15; r++) {
  let row = '';
  for (let c = 0; c < 40; c++) {
    let ch = memory.ram[0xEC00 + r * 80 + c] & 0xFF;
    if (ch >= 32 && ch < 127) row += String.fromCharCode(ch);
  }
  let trimmed = row.trim();
  if (trimmed && trimmed.includes('TEST')) console.log('  DIR row', r, ':', trimmed);
}

// === Type RUN TEST.NXE ===
console.log('\n--- Typing RUN TEST.NXE ---');
typeAndEnter('RUN TEST.NXE');

// After RUN, NexaOS writes exec magic and halts.
// In the real worker, checkExecMagic() runs. We simulate it here.
console.log('CPU halted:', cpu.halted);
console.log('Magic at 0xEEFE:', '0x' + memory.ram[0xEEFE].toString(16));
console.log('Sector count at 0xEE00:', memory.ram[0xEE00]);
console.log('File size at 0xEEFF:', memory.ram[0xEEFF]);

// Simulate checkExecMagic
if (memory.ram[0xEEFE] === 0x4558) {
  console.log('\n--- Exec magic detected! Loading program... ---');
  const sectorCount = memory.ram[0xEE00];
  const fileSize = memory.ram[0xEEFF];
  let destAddr = 0;
  for (let s = 0; s < sectorCount; s++) {
    const sector = memory.ram[0xEE01 + s];
    const diskOffset = sector * SECTOR_SIZE_T;
    const remaining = fileSize - destAddr;
    const count = remaining < SECTOR_SIZE_T ? remaining : SECTOR_SIZE_T;
    for (let w = 0; w < count; w++) {
      memory.ram[destAddr + w] = disk.storage[diskOffset + w];
    }
    destAddr += SECTOR_SIZE_T;
  }
  memory.ram[0xEEFE] = 0;
  memory.ram[60401] = fileSize;
  cpu.PC = 0; cpu.SP = 0xEBF0;
  cpu.A = 0; cpu.D = 0; cpu.B = 0;
  cpu.halted = false; cpu.doubleFault = false;
  cpu.flagN = false; cpu.flagZ = false;
  cpu.STATUS = 0;
  if (cpu.ie !== undefined) cpu.ie = false;
  if (cpu.mode !== undefined) cpu.mode = false;
  if (cpu.activeMode !== undefined) cpu.activeMode = false;
  
  console.log('Program loaded. Running...');
  runUntilIdle(50000000);
  console.log('After run. PC:', cpu.PC.toString(16), 'Halted:', cpu.halted);
  
  // Check framebuffer for HELLO
  let hello = '';
  for (let i = 0; i < 5; i++) {
    hello += String.fromCharCode(memory.ram[0xEC00 + i] & 0xFF);
  }
  console.log('\nFramebuffer[0..4]:', hello);
  console.log('Test:', hello === 'HELLO' ? 'PASS ✓' : 'FAIL ✗');
} else {
  console.log('ERROR: exec magic not found!');
}
