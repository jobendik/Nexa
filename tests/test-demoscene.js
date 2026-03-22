const fs = require('fs');

// Load compiler and tools
eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

// Load demos
eval(fs.readFileSync('js/data/demos.js', 'utf8'));

// Compile the demoscene
const src = nexaDemoSceneDemo;
const p = new Parser(src);
const ast = p.parse();
const cg = new CodeGenerator();
const vm = cg.generate(ast, 'Main');
const fullVM = STDLIB_VM + '\n' + vm;
const vmt = new VMTranslator();
const boot = vmt.bootstrap();
const vmr = vmt.translate(fullVM, 'Main');
const fullAsm = boot + '\n' + vmr.assembly;
const asmr = new Assembler().assemble(fullAsm);
const code = asmr.code;
console.log('Code size:', code.length, 'words');

// Build minimal emulator (extract CPU and Memory from emu-worker.js)
const emuSrc = fs.readFileSync('js/emulator/emu-worker.js', 'utf8');
// Extract just the class definitions, skip the global init and onmessage
const trimmed = emuSrc
  .replace(/var cpu, memory[\s\S]*$/, '// globals removed');
eval(trimmed);

// Set up CPU and Memory
var memory = new Memory();
var cpu = new CPU(memory);

// Set up minimal I/O devices
var display = new DisplayController();
memory.registerDevice(0xFF30, display);
var keyboard = new Keyboard();
memory.registerDevice(0xFF00, keyboard);
var timer = new Timer();
memory.registerDevice(0xFF10, timer);
var system = new SystemControl();
memory.registerDevice(0xFFF0, system);
var soundDev = {
  regs: [0, 0, 0, 0, 0, 0, 0, 0],
  writes: 0,
  read(offset) {
    return this.regs[offset] || 0;
  },
  write(offset, value) {
    if (offset >= 0 && offset < 8) this.regs[offset] = value & 0xFFFF;
    this.writes++;
  }
};
memory.registerDevice(0xFF40, soundDev);

// Load the program
memory.loadProgram(new Uint16Array(code));
cpu.SP = 0xEBF0;

// Run in batches
const MAX_CYCLES = 10_000_000_000; // 10B cycles max
const BATCH = 10_000_000;
let totalCycles = 0;
let lastPC = -1;
let stuckCount = 0;

// Track scene transitions by monitoring display mode and FB changes
let lastMode = display.getMode();
let sceneChanges = 0;

console.log('Running demoscene...');
const t0 = Date.now();

while (totalCycles < MAX_CYCLES && !cpu.halted) {
  const ran = cpu.runFast(BATCH);
  totalCycles += ran;
  if (timer.advance(ran, 25_000_000)) system.setInterrupt(0);
  if (keyboard.hasPendingInterrupt()) system.setInterrupt(1);
  
  const curMode = display.getMode();
  if (curMode !== lastMode) {
    sceneChanges++;
    console.log(`  Scene change #${sceneChanges} at cycle ${totalCycles}: mode ${lastMode} -> ${curMode}`);
    lastMode = curMode;
  }
  
  // Check if FB has non-zero content (sampling a few addresses)
  const fb0 = memory.ram[0xEC00];
  const fb100 = memory.ram[0xEC00 + 100];
  const fb2000 = memory.ram[0xEC00 + 2000];
  
  if (totalCycles % 100_000_000 === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${totalCycles/1e6}M cycles (${elapsed}s), PC=${cpu.PC}, mode=${curMode}, FB[0]=${fb0}, FB[100]=${fb100}, FB[2000]=${fb2000}`);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Done: ${totalCycles} cycles (${elapsed}s), halted=${cpu.halted}, PC=${cpu.PC}`);
console.log(`Scene changes: ${sceneChanges}`);
console.log(`Sound writes: ${soundDev.writes}`);

if (sceneChanges < 5) {
  throw new Error(`Expected at least 5 scene transitions, saw ${sceneChanges}`);
}

if (soundDev.writes < 50) {
  throw new Error(`Expected soundtrack activity, saw only ${soundDev.writes} sound writes`);
}

// Check final FB content
let nonZero = 0;
for (let i = 0; i < 4800; i++) {
  if (memory.ram[0xEC00 + i] !== 0) nonZero++;
}
console.log(`FB non-zero words: ${nonZero} / 4800`);

if (nonZero < 200) {
  throw new Error(`Expected substantial framebuffer output, saw only ${nonZero} non-zero words`);
}
