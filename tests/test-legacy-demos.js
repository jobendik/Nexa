const fs = require('fs');

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== 'symbol' ? key + '' : key, value);

const workerSrc = fs.readFileSync('js/emulator/emu-worker.js', 'utf8');
const handlerIdx = workerSrc.indexOf('// === Worker handler ===');
const classDefs = handlerIdx > 0 ? workerSrc.slice(0, handlerIdx) : workerSrc.slice(0, workerSrc.indexOf('var cpu, memory'));
eval(classDefs);

eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

function compileFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const vm = new CodeGenerator().generate(new Parser(src).parse(), 'Main');
  const fullVM = STDLIB_VM + '\n' + vm;
  const vmt = new VMTranslator();
  const asm = vmt.bootstrap() + '\n' + vmt.translate(fullVM, 'Main').assembly;
  const out = new Assembler().assemble(asm);
  if (!out.success) throw new Error(file + ': ' + out.errors.join(' | '));
  return out.code;
}

function makeMachine(code) {
  const memory = new Memory();
  const cpu = new CPU(memory);
  const display = new DisplayController();
  const keyboard = new Keyboard();
  const system = new SystemControl();
  const timer = new Timer();
  const uart = new UART();
  const disk = new DiskController();

  memory.registerDevice(0xFF00, keyboard);
  memory.registerDevice(0xFF10, timer);
  memory.registerDevice(0xFF20, uart);
  memory.registerDevice(0xFF30, display);
  memory.registerDevice(0xFF50, disk);
  memory.registerDevice(0xFFF0, system);

  display.setModeChangeCallback(function() {});
  disk.setDMA(
    function(addr) { return memory.read(addr); },
    function(addr, val) { memory.write(addr, val); }
  );
  uart.setOutputCallback(function() {});

  memory.loadProgram(code);
  cpu.PC = 0;
  cpu.SP = 0;

  return { memory, cpu, display, keyboard, system, timer, disk };
}

function step(machine, cycles, inject) {
  for (let i = 0; i < cycles && !machine.cpu.halted; i++) {
    if (inject) inject(i);
    machine.cpu.step();
    if (machine.timer.tick && machine.timer.tick()) machine.system.setInterrupt(0);
    if (machine.keyboard.hasPendingInterrupt()) machine.system.setInterrupt(1);
    if (machine.disk.hasPendingInterrupt && machine.disk.hasPendingInterrupt()) machine.system.setInterrupt(4);
  }
}

function hashRegion(memory, start, len) {
  let hash = 0;
  for (let i = 0; i < len; i++) hash = ((hash * 131) ^ memory.ram[start + i]) >>> 0;
  return hash >>> 0;
}

function countRegion(memory, startRow, endRow, startCol, endCol) {
  let count = 0;
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (memory.ram[0xEC00 + row * 80 + col] !== 0) count++;
    }
  }
  return count;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

console.log('\n--- Test: Breakout runtime smoke ---');
{
  const machine = makeMachine(compileFile('demos/Breakout.txt'));
  step(machine, 300000);
  const hash1 = hashRegion(machine.memory, 0xEC00, 4800);
  step(machine, 300000);
  const hash2 = hashRegion(machine.memory, 0xEC00, 4800);
  machine.keyboard.keyDown('a'.charCodeAt(0));
  step(machine, 200000);
  const hash3 = hashRegion(machine.memory, 0xEC00, 4800);
  machine.keyboard.keyDown('d'.charCodeAt(0));
  step(machine, 200000);
  const hash4 = hashRegion(machine.memory, 0xEC00, 4800);

  assert(machine.display.getMode() === 1, 'Breakout should run in pixel mode');
  assert(!machine.cpu.halted, 'Breakout should still be running');
  assert(hash1 !== hash2, 'Breakout framebuffer should change without input');
  assert(hash2 !== hash3, 'Breakout should react to left input');
  assert(hash3 !== hash4, 'Breakout should react to right input');
  console.log('  PASS: Breakout animates and responds to input');
}

console.log('\n--- Test: Tetris runtime smoke ---');
{
  const machine = makeMachine(compileFile('demos/Tetris.txt'));
  step(machine, 1200000);
  const initialHash = hashRegion(machine.memory, 0xEC00, 2400);

  machine.keyboard.keyDown('s'.charCodeAt(0));
  step(machine, 800000);
  const dropHash = hashRegion(machine.memory, 0xEC00, 2400);

  assert(machine.display.getMode() === 0, 'Tetris should run in text mode');
  assert(!machine.cpu.halted, 'Tetris should still be running');
  assert(initialHash !== 0, 'Tetris should render an initialized HUD/board');
  assert(dropHash !== initialHash, 'Tetris should change after hard drop');
  console.log('  PASS: Tetris renders and responds to input');
}

console.log('\n=== Legacy demo runtime smoke tests passed ===');