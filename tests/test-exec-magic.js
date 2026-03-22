// Test the exec-magic boot controller mechanism
// 1. Format disk directly
// 2. Write a test program to disk
// 3. Boot NexaOS, simulate RUN by setting up exec magic
// 4. Verify the loaded program runs and writes HELLO to screen
const fs = require('fs');

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

const workerSrc = fs.readFileSync('js/emulator/emu-worker.js', 'utf8');
const handlerIdx = workerSrc.indexOf('// === Worker handler ===');
const classDefs = handlerIdx > 0 ? workerSrc.slice(0, handlerIdx) : workerSrc.slice(0, workerSrc.indexOf('var cpu, memory'));
eval(classDefs);
eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

// === Compile a tiny test program ===
const testSrc = `
fn main() {
    poke(0xFF30, 0);
    poke(0xEC00, 0x0F48);
    poke(0xEC01, 0x0F45);
    poke(0xEC02, 0x0F4C);
    poke(0xEC03, 0x0F4C);
    poke(0xEC04, 0x0F4F);
    halt();
}
`;
const p = new Parser(testSrc);
const ast = p.parse();
const cg = new CodeGenerator();
const vm = cg.generate(ast, 'Main');
const fullVm = STDLIB_VM + '\n' + vm;
const vmt = new VMTranslator();
const boot = vmt.bootstrap();
const vmr = vmt.translate(fullVm, 'Main');
const fullAsm = boot + '\n' + vmr.assembly;
const asmr = new Assembler().assemble(fullAsm);
if (!asmr.success) { console.error('Assembly failed'); process.exit(1); }
const testCode = asmr.code;
console.log('Test program compiled:', testCode.length, 'words');

// === Compile NexaOS ===
const osSrc = fs.readFileSync('OS/nexaos.nx', 'utf8');
const osP = new Parser(osSrc);
const osAst = osP.parse();
const osCg = new CodeGenerator();
const osVm = osCg.generate(osAst, 'Main');
const osFullVm = STDLIB_VM + '\n' + osVm;
const osVmt = new VMTranslator();
const osBoot = osVmt.bootstrap();
const osVmr = osVmt.translate(osFullVm, 'Main');
const osFullAsm = osBoot + '\n' + osVmr.assembly;
const osAsmr = new Assembler().assemble(osFullAsm);
const osCode = osAsmr.code;
console.log('NexaOS compiled:', osCode.length, 'words');

// === Set up machine ===
memory = new Memory();
cpu = new CPU(memory);
display = new DisplayController();
keyboard = new Keyboard();
system = new SystemControl();
timer = new Timer();
uart = new UART();
disk = new DiskController();

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

// === Pre-format disk and write test program ===
console.log('\n--- Formatting disk and writing test program ---');

// Format disk (same as Fs.format() in nexaos.nx)
const SECTOR_SIZE_T = 128;
// Write superblock to sector 0
disk.storage[0] = 0x4844; // magic
disk.storage[1] = 2;      // version
disk.storage[2] = 256;    // total sectors
disk.storage[3] = 1;      // FAT start
disk.storage[4] = 2;      // FAT sectors
disk.storage[5] = 3;      // DIR start
disk.storage[6] = 2;      // DIR sectors
disk.storage[7] = 5;      // data start
disk.storage[8] = 251;    // free sectors

// Initialize FAT (sectors 1-2)
const FAT_OFF = 1 * SECTOR_SIZE_T;
for (let i = 0; i < 256; i++) disk.storage[FAT_OFF + i] = 0;
disk.storage[FAT_OFF + 0] = 0xFFFE; // sector 0 reserved
disk.storage[FAT_OFF + 1] = 0xFFFE; // sector 1 reserved
disk.storage[FAT_OFF + 2] = 0xFFFE; // sector 2 reserved
disk.storage[FAT_OFF + 3] = 0xFFFE; // sector 3 reserved
disk.storage[FAT_OFF + 4] = 0xFFFE; // sector 4 reserved

// Initialize DIR (sectors 3-4) - all zeros
const DIR_OFF = 3 * SECTOR_SIZE_T;
for (let i = 0; i < 256; i++) disk.storage[DIR_OFF + i] = 0;

// Write test program to disk as TEST.NXE
const sectorsNeeded = Math.ceil(testCode.length / SECTOR_SIZE_T);
let firstSec = -1, prevSec = -1;
for (let s = 0; s < sectorsNeeded; s++) {
  let freeSec = 5 + s; // start from sector 5
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

// Create dir entry
const de = DIR_OFF + 0 * 16;
const nameChars = [84, 69, 83, 84, 32, 32, 32, 32]; // "TEST    "
const extChars = [78, 88, 69]; // "NXE"
for (let j = 0; j < 8; j++) disk.storage[de + j] = nameChars[j];
for (let j = 0; j < 3; j++) disk.storage[de + 8 + j] = extChars[j];
disk.storage[de + 11] = 1; // active
disk.storage[de + 12] = firstSec;
disk.storage[de + 13] = testCode.length;

console.log('Disk formatted, TEST.NXE written: sectors', firstSec, '-', firstSec + sectorsNeeded - 1, ', size:', testCode.length);

// === Test 1: Direct exec magic (bypassing NexaOS) ===
console.log('\n--- Test 1: Direct exec magic mechanism ---');

// Load NexaOS
memory.loadProgram(osCode);
cpu.PC = 0; cpu.SP = 0;

// Simulate what cmdRun does: write sector list and exec magic
const sectorList = [];
let curSec = firstSec;
while (curSec > 0 && curSec < 256) {
  sectorList.push(curSec);
  let nxt = disk.storage[FAT_OFF + curSec];
  if (nxt === 0xFFFF || nxt === 0 || nxt === 0xFFFE) break;
  curSec = nxt;
}

memory.ram[0xEE00] = sectorList.length;
for (let i = 0; i < sectorList.length; i++) {
  memory.ram[0xEE01 + i] = sectorList[i];
}
memory.ram[0xEEFF] = testCode.length;
memory.ram[0xEEFE] = 0x4558; // exec magic
cpu.halted = true;

console.log('Sector list:', sectorList.length, 'sectors');
console.log('Magic set at 0xEEFE:', '0x' + memory.ram[0xEEFE].toString(16));

// Now simulate checkExecMagic (same logic as in worker)
if (memory.ram[0xEEFE] === 0x4558) {
  const sc = memory.ram[0xEE00];
  const fSize = memory.ram[0xEEFF];
  let dAddr = 0;
  for (let s = 0; s < sc; s++) {
    const sec = memory.ram[0xEE01 + s];
    const diskOff = sec * SECTOR_SIZE_T;
    const remaining = fSize - dAddr;
    const count = remaining < SECTOR_SIZE_T ? remaining : SECTOR_SIZE_T;
    for (let w = 0; w < count; w++) {
      memory.ram[dAddr + w] = disk.storage[diskOff + w];
    }
    dAddr += SECTOR_SIZE_T;
  }
  memory.ram[0xEEFE] = 0;
  memory.ram[60401] = fSize;
  cpu.PC = 0; cpu.SP = 0xEBF0;
  cpu.A = 0; cpu.D = 0; cpu.B = 0;
  cpu.halted = false;
  cpu.flagN = false; cpu.flagZ = false;
  cpu.STATUS = 0;

  console.log('Program loaded from disk to RAM[0]. Running...');

  // Verify RAM[0..4] matches testCode[0..4]
  let codeMatch = true;
  for (let i = 0; i < Math.min(10, testCode.length); i++) {
    if (memory.ram[i] !== testCode[i]) {
      console.log('  MISMATCH at', i, ': expected', '0x' + testCode[i].toString(16), 'got', '0x' + memory.ram[i].toString(16));
      codeMatch = false;
    }
  }
  console.log('Code integrity:', codeMatch ? 'OK' : 'MISMATCH');

  // Run the test program
  let cycles = 0;
  while (cycles < 50000000 && !cpu.halted) {
    cpu.step();
    if (timer.tick && timer.tick()) system.setInterrupt(0);
    if (keyboard.hasPendingInterrupt()) system.setInterrupt(1);
    if (disk.hasPendingInterrupt && disk.hasPendingInterrupt()) system.setInterrupt(4);
    cycles++;
  }

  console.log('Ran', cycles, 'cycles. PC:', cpu.PC.toString(16), 'Halted:', cpu.halted);

  // Check framebuffer
  let hello = '';
  for (let i = 0; i < 5; i++) {
    const word = memory.ram[0xEC00 + i];
    const ch = word & 0xFF;
    hello += String.fromCharCode(ch);
    console.log('  FB[' + i + '] = 0x' + word.toString(16) + " '" + String.fromCharCode(ch) + "'");
  }
  console.log('\nResult:', hello);
  console.log('Test 1:', hello === 'HELLO' ? 'PASS ✓' : 'FAIL ✗');
} else {
  console.log('ERROR: magic not found');
}

// === Test 2: Verify disk persistence across memory clear ===
console.log('\n--- Test 2: Disk persistence ---');
memory.clear();
console.log('After memory.clear():');
console.log('  Disk sector 0 word 0:', '0x' + disk.storage[0].toString(16), disk.storage[0] === 0x4844 ? '(formatted ✓)' : '(lost ✗)');
console.log('  Dir entry 0 name[0]:', disk.storage[DIR_OFF] === 84 ? 'T ✓' : 'LOST ✗');
console.log('  Test 2:', disk.storage[0] === 0x4844 ? 'PASS ✓' : 'FAIL ✗');
