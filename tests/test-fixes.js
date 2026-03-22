// Test file to verify all bug fixes
const fs = require('fs');

// Load compiler pipeline
eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

// Load emulator classes (only up to worker handler)
const workerSrc = fs.readFileSync('js/emulator/emu-worker.js', 'utf8');
const markerIdx = workerSrc.indexOf('var cpu, memory');
if (markerIdx < 0) { console.log('ERROR: Cannot find marker in emu-worker.js'); process.exit(1); }
eval(workerSrc.slice(0, markerIdx));

function compileVM(vmCode) {
  const fullVM = STDLIB_VM + '\n' + vmCode;
  const vmt = new VMTranslator();
  const boot = vmt.bootstrap();
  const vmr = vmt.translate(fullVM, 'Main');
  if (vmr.errors.length) throw new Error('VM errors: ' + vmr.errors.join('; '));
  const fullAsm = boot + '\n' + vmr.assembly;
  const asmr = new Assembler().assemble(fullAsm);
  if (asmr.errors.length) throw new Error('ASM errors: ' + asmr.errors.slice(0, 5).join('; '));
  return asmr.code;
}

function compileJack(source) {
  const ast = new Parser(source).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  return compileVM(vm);
}

function runCode(code, maxCycles) {
  maxCycles = maxCycles || 2000000;
  const mem = new Memory();
  mem.loadProgram(code);
  const cpu = new CPU(mem);
  let output = '';
  mem.registerDevice(0xFF20, {
    read(o) { return o === 0 ? 1 : 0; },
    write(o, v) { if (o === 1) output += String.fromCharCode(v); },
    hasPendingRxInterrupt() { return false; },
    hasPendingTxInterrupt() { return false; }
  });
  mem.registerDevice(0xFF00, { read() { return 0; }, write() {}, hasPendingInterrupt() { return false; } });
  mem.registerDevice(0xFF10, { enabled: false, interval: 0, counter: 0, read() { return 0; }, write() {}, tick() { return false; } });
  mem.registerDevice(0xFF30, { mode: 0, read() { return 0; }, write() {}, getMode() { return 0; } });
  mem.registerDevice(0xFF40, {
    regs: [0, 0, 0, 0, 0, 0, 0, 0],
    read(offset) { return this.regs[offset] || 0; },
    write(offset, value) { if (offset >= 0 && offset < 8) this.regs[offset] = value & 0xFFFF; },
    hasPendingInterrupt() { return false; }
  });
  mem.registerDevice(0xFFF0, { pending: 0, mask: 0, read() { return 0; }, write() {}, setInterrupt() {}, hasEnabledInterrupt() { return false; }, highestPriority() { return -1; }, clearInterrupt() {} });
  mem.registerDevice(0xFF50, { read() { return 0; }, write() {}, hasPendingInterrupt() { return false; } });

  for (let i = 0; i < maxCycles; i++) {
    if (cpu.halted) break;
    cpu.step();
  }
  return { output, halted: cpu.halted, cpu, mem };
}

function makeExecMachine() {
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
  memory.registerDevice(0xFF40, {
    read() { return 0; },
    write() {},
    hasPendingInterrupt() { return false; }
  });
  memory.registerDevice(0xFF50, disk);
  memory.registerDevice(0xFFF0, system);
  display.setModeChangeCallback(function() {});
  disk.setDMA(
    function(addr) { return memory.read(addr); },
    function(addr, val) { memory.write(addr, val); }
  );
  uart.setOutputCallback(function() {});

  return { memory, cpu, display, keyboard, system, timer, uart, disk };
}

function runMachine(machine, maxCycles) {
  for (let i = 0; i < maxCycles && !machine.cpu.halted; i++) {
    machine.cpu.step();
    if (machine.timer.tick && machine.timer.tick()) machine.system.setInterrupt(0);
    if (machine.keyboard.hasPendingInterrupt()) machine.system.setInterrupt(1);
    if (machine.disk.hasPendingInterrupt && machine.disk.hasPendingInterrupt()) machine.system.setInterrupt(4);
  }
}

function writeProgramToDisk(disk, code, startSector) {
  const sectors = [];
  const firstSector = startSector || 5;
  const sectorsNeeded = Math.max(1, Math.ceil(code.length / SECTOR_SIZE));
  const fatOff = 1 * SECTOR_SIZE;
  for (let i = 0; i < sectorsNeeded; i++) {
    const sector = firstSector + i;
    sectors.push(sector);
    disk.storage[fatOff + sector] = i === sectorsNeeded - 1 ? 0xFFFF : sector + 1;
    const diskOffset = sector * SECTOR_SIZE;
    for (let j = 0; j < SECTOR_SIZE; j++) {
      disk.storage[diskOffset + j] = (i * SECTOR_SIZE + j < code.length) ? code[i * SECTOR_SIZE + j] : 0;
    }
  }
  return sectors;
}

function countAllocatedDiskSectors(disk) {
  let count = 0;
  const fatOff = 1 * SECTOR_SIZE;
  for (let sector = 5; sector < DISK_SECTORS; sector++) {
    if (disk.storage[fatOff + sector] !== 0) count++;
  }
  return count;
}

function paddedWordBytes(text, length) {
  const out = new Array(length).fill(32);
  for (let i = 0; i < Math.min(text.length, length); i++) out[i] = text.charCodeAt(i);
  return out;
}

function withFakeAudioContext(fn) {
  class FakeParam {
    constructor() { this.value = 0; this.events = []; }
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; this.events.push({ type: 'linear', value }); }
    setTargetAtTime(value) { this.value = value; this.events.push({ type: 'target', value }); }
    cancelScheduledValues() { this.events.push({ type: 'cancel' }); }
  }

  class FakeNode {
    constructor() {
      this.connections = [];
      this.numberOfOutputs = 1;
    }
    connect(target) {
      this.connections.push(target);
      return target;
    }
    disconnect() {
      this.connections = [];
      this.numberOfOutputs = 0;
    }
  }

  class FakeGainNode extends FakeNode {
    constructor() {
      super();
      this.gain = new FakeParam();
    }
  }

  class FakeStereoPannerNode extends FakeNode {
    constructor() {
      super();
      this.pan = new FakeParam();
    }
  }

  class FakeOscillatorNode extends FakeNode {
    constructor() {
      super();
      this.frequency = new FakeParam();
      this.type = 'square';
      this.started = false;
      this.stopped = false;
    }
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }

  class FakeBufferSourceNode extends FakeNode {
    constructor() {
      super();
      this.playbackRate = new FakeParam();
      this.loop = false;
      this.buffer = null;
      this.started = false;
      this.stopped = false;
    }
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }

  class FakeDynamicsCompressorNode extends FakeNode {
    constructor() {
      super();
      this.threshold = new FakeParam();
      this.knee = new FakeParam();
      this.ratio = new FakeParam();
      this.attack = new FakeParam();
      this.release = new FakeParam();
    }
  }

  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = new FakeNode();
      this.closed = false;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createGain() { return new FakeGainNode(); }
    createStereoPanner() { return new FakeStereoPannerNode(); }
    createOscillator() { return new FakeOscillatorNode(); }
    createBufferSource() { return new FakeBufferSourceNode(); }
    createDynamicsCompressor() { return new FakeDynamicsCompressorNode(); }
    createBuffer(_channels, length) {
      return {
        getChannelData() {
          return new Float32Array(length);
        }
      };
    }
  }

  const previousAudioContext = global.AudioContext;
  const previousWebkitAudioContext = global.webkitAudioContext;
  global.AudioContext = FakeAudioContext;
  global.webkitAudioContext = FakeAudioContext;
  try {
    return fn();
  } finally {
    if (previousAudioContext === undefined) delete global.AudioContext;
    else global.AudioContext = previousAudioContext;
    if (previousWebkitAudioContext === undefined) delete global.webkitAudioContext;
    else global.webkitAudioContext = previousWebkitAudioContext;
  }
}

function readSignedWord(mem, addr) {
  const value = mem.ram[addr] & 0xFFFF;
  return value > 32767 ? value - 65536 : value;
}

function readTextString(mem, row, col, length) {
  let text = '';
  const base = 0xEC00 + row * 80 + col;
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(mem.ram[base + i] & 0xFF);
  }
  return text;
}

function runJackExpr(expr, setup) {
  const source = [
    'fn main() -> void {',
    setup || '',
    '  poke(60000, ' + expr + ');',
    '  halt();',
    '}'
  ].filter(Boolean).join('\n');
  const code = compileJack(source);
  const result = runCode(code, 500000);
  assert(result.halted, 'Program should halt');
  return readSignedWord(result.mem, 60000);
}

function runJackExprWithVars(expr, vars, extraSetup) {
  const lines = [];
  Object.keys(vars || {}).forEach(function(name) {
    lines.push('  var ' + name + ': int = ' + vars[name] + ';');
  });
  if (extraSetup) lines.push(extraSetup);
  return runJackExpr(expr, lines.join('\n'));
}

function assertExprMatchesReference(optimizedExpr, referenceExpr, cases) {
  cases.forEach(function(testCase) {
    const actual = runJackExprWithVars(optimizedExpr, testCase.vars, testCase.extraSetup);
    const expected = runJackExprWithVars(referenceExpr, testCase.vars, testCase.extraSetup);
    assert(actual === expected, 'Vars ' + JSON.stringify(testCase.vars) + ' expected ' + expected + ', got ' + actual);
    if (testCase.result !== undefined) {
      assert(actual === testCase.result, 'Vars ' + JSON.stringify(testCase.vars) + ' expected concrete result ' + testCase.result + ', got ' + actual);
    }
  });
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  PASS: ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL: ' + name + ' - ' + e.message);
    failed++;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// ============================
// TEST 1: gt/lt overflow safety
// ============================
console.log('\n--- Test: gt/lt overflow safety ---');

function testCmp(name, a, b, op, expected) {
  test(name, function() {
    // Push a, push b, compare, store result in temp 0 (address 5), halt
    const code = compileVM('function Main.main 0\npush constant ' + a + '\npush constant ' + b + '\n' + op + '\npop temp 0\nhalt\nreturn\n');
    const r = runCode(code);
    assert(r.halted, 'Should halt');
    // Read temp 0 (address 5) for result: -1 = true (0xFFFF), 0 = false
    const val = r.mem.ram[5];
    const signed = val > 32767 ? val - 65536 : val;
    assert(signed === expected, 'Expected ' + expected + ', got ' + signed + ' (raw: ' + val + ')');
  });
}

testCmp('32767 > -1 (overflow case)', 32767, 65535, 'gt', -1);
testCmp('-32768 < 1 (overflow case)', 32768, 1, 'lt', -1);
testCmp('5 > 3 (normal)', 5, 3, 'gt', -1);
testCmp('3 > 5 = false', 3, 5, 'gt', 0);
testCmp('3 < 5 (normal)', 3, 5, 'lt', -1);
testCmp('5 < 3 = false', 5, 3, 'lt', 0);
testCmp('7 eq 7', 7, 7, 'eq', -1);
testCmp('7 eq 8 = false', 7, 8, 'eq', 0);
testCmp('0 > -1 (signs differ, x=0)', 0, 65535, 'gt', -1);
testCmp('0 < 1 (same sign)', 0, 1, 'lt', -1);
testCmp('-1 < 0 (signs differ)', 65535, 0, 'lt', -1);
testCmp('-1 > -2', 65535, 65534, 'gt', -1);

// ============================
// TEST 2: halt instruction
// ============================
console.log('\n--- Test: halt instruction ---');

test('Sys.halt properly halts CPU', function() {
  const code = compileVM('function Main.main 0\ncall Sys.halt 0\npop temp 0\nhalt\nreturn\n');
  const r = runCode(code, 100000);
  assert(r.halted, 'CPU should be halted');
});

// ============================
// TEST 3: Negative constant inlining
// ============================
console.log('\n--- Test: negative constant inlining ---');

test('Negative const is inlined', function() {
  const src = 'const NEG_FIVE: int = -5;\nfn main() -> void {\n  var x: int = NEG_FIVE;\n  halt();\n}';
  const p = new Parser(src);
  const ast = p.parse();
  const cg = new CodeGenerator();
  const vm = cg.generate(ast, 'Main');
  // The VM code should contain 'push constant -5' (inlined) instead of a variable reference
  assert(vm.includes('push constant -5'), 'Negative constant should be inlined as push constant -5, got VM:\\n' + vm.slice(0, 500));
});

// ============================
// TEST 4: Undefined bare calls are rejected
// ============================
console.log('\n--- Test: undefined bare call rejection ---');

test('Undefined bare call fails at compile time', function() {
  const src = 'class Main { fn main() { foz(); halt(); } }';
  const p = new Parser(src);
  const ast = p.parse();
  let error = null;
  try {
    new CodeGenerator().generate(ast, 'Main');
  } catch (e) {
    error = e;
  }
  assert(error, 'Compiler should reject unknown bare subroutine calls');
  assert(String(error.message).includes("Unknown subroutine 'Main.foz'"), 'Unexpected error: ' + error.message);
});

test('Unknown qualified static call still fails at compile time', function() {
  const src = 'fn main() { Keyboard.keyState(65); halt(); }';
  const p = new Parser(src);
  const ast = p.parse();
  let error = null;
  try {
    new CodeGenerator().generate(ast, 'Main');
  } catch (e) {
    error = e;
  }
  assert(error, 'Compiler should reject unknown qualified static calls');
  assert(String(error.message).includes("Unknown subroutine 'Keyboard.keyState'"), 'Unexpected error: ' + error.message);
});

test('Legacy bare stdlib aliases are lowered with warnings', function() {
  const src = 'fn main() { clearScreen(); moveCursor(1, 2); printInt(7); println(); halt(); }';
  const cg = new CodeGenerator();
  const vm = cg.generate(new Parser(src).parse(), 'Main');
  assert(vm.includes('call Screen.clearScreen 0'), 'Expected clearScreen alias to lower to Screen.clearScreen');
  assert(vm.includes('call Output.moveCursor 2'), 'Expected moveCursor alias to lower to Output.moveCursor');
  assert(vm.includes('call Output.printInt 1'), 'Expected printInt alias to lower to Output.printInt');
  assert(vm.includes('call Output.println 0'), 'Expected println alias to lower to Output.println');
  assert(cg.warnings.some(function(w) { return w.includes("clearScreen"); }), 'Expected compatibility warning for legacy alias');
});

test('Legacy Keyboard.keyDown(code) is lowered to a keyPressed comparison', function() {
  const src = 'fn main() -> bool { return Keyboard.keyDown(65); }';
  const cg = new CodeGenerator();
  const vm = cg.generate(new Parser(src).parse(), 'Main');
  assert(vm.includes('call Keyboard.keyPressed 0'), 'Expected keyDown alias to use Keyboard.keyPressed');
  assert(vm.includes('push constant 65'), 'Expected keyDown alias to compare against requested key code');
  assert(vm.includes('eq'), 'Expected keyDown alias to emit equality check');
  assert(cg.warnings.some(function(w) { return w.includes("Keyboard.keyDown"); }), 'Expected compatibility warning for Keyboard.keyDown');
});

// ============================
// TEST 5: Chained access through method return values
// ============================
console.log('\n--- Test: chained access through method return values ---');

test('Method return types support chained field access', function() {
  const src = [
    'class B {',
    '  field x: int;',
    '  new(v: int) { this.x = v; }',
    '}',
    'class A {',
    '  field b: B;',
    '  new() { this.b = B.new(7); }',
    '  method getB() -> B { return this.b; }',
    '  fn main() {',
    '    var a: A = A.new();',
    '    var y: int = a.getB().x;',
    '    halt();',
    '  }',
    '}'
  ].join('\n');
  const p = new Parser(src);
  const ast = p.parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(vm.includes('call A.getB 1'), 'Expected chained method call in VM output');
  assert(vm.includes('push that 0'), 'Expected field load after chained call');
});

// ============================
// TEST 6: Static storage and qualified static access
// ============================
console.log('\n--- Test: static storage and qualified access ---');

test('Static fields are allocated uniquely across classes and support qualified access', function() {
  const src = [
    'class A {',
    '  static count: int;',
    '  fn set(v: int) { A.count = v; }',
    '  fn get() -> int { return A.count; }',
    '}',
    'class B {',
    '  static count: int;',
    '  fn set(v: int) { B.count = v; }',
    '  fn get() -> int { return B.count; }',
    '}',
    'fn main() -> int {',
    '  A.set(11);',
    '  B.set(22);',
    '  return B.get() - A.get();',
    '}'
  ].join('\n');
  const p = new Parser(src);
  const ast = p.parse();
  const cg = new CodeGenerator();
  const vm = cg.generate(ast, 'Main');
  assert(vm.includes('pop static 0'), 'Expected first class static slot to be used');
  assert(vm.includes('pop static 1'), 'Expected second class static slot to be unique');
  assert(vm.includes('push static 1'), 'Expected qualified read from second class static slot');
});

// ============================
// TEST 7: Return diagnostics
// ============================
console.log('\n--- Test: return diagnostics ---');

test('Void subroutine returning a value is rejected', function() {
  const src = 'fn main() { return 7; }';
  const ast = new Parser(src).parse();
  let error = null;
  try {
    new CodeGenerator().generate(ast, 'Main');
  } catch (e) {
    error = e;
  }
  assert(error, 'Expected compile-time error for returning a value from void subroutine');
  assert(String(error.message).includes("Void subroutine 'Main.main' cannot return a value"), 'Unexpected error: ' + error.message);
});

test('Non-void fallthrough emits a warning', function() {
  const src = 'fn main() -> int { if (true) { return 1; } }';
  const ast = new Parser(src).parse();
  const cg = new CodeGenerator();
  cg.generate(ast, 'Main');
  assert(cg.warnings.length === 1, 'Expected one warning, got ' + cg.warnings.length);
  assert(cg.warnings[0].includes("Main.main"), 'Warning should name the subroutine');
});

test('Builtin arity mismatches report the resolved callee name', function() {
  const src = 'fn main() { poke(1234); }';
  let error = null;
  try {
    new CodeGenerator().generate(new Parser(src).parse(), 'Main');
  } catch (e) {
    error = e;
  }
  assert(error, 'Expected builtin arity mismatch to fail');
  assert(String(error.message).includes("Builtin 'poke' expects 2 argument(s) but got 1"), 'Unexpected error: ' + error.message);
});

test('Static function calls through instances are rejected', function() {
  const src = [
    'class Counter {',
    '  fn reset() { }',
    '}',
    'fn main() {',
    '  var c: Counter;',
    '  c.reset();',
    '}'
  ].join('\n');
  let error = null;
  try {
    new CodeGenerator().generate(new Parser(src).parse(), 'Main');
  } catch (e) {
    error = e;
  }
  assert(error, 'Expected static-vs-instance misuse to fail');
  assert(String(error.message).includes("Cannot call static function 'Counter.reset' on an instance"), 'Unexpected error: ' + error.message);
});

test('Instance fields cannot be accessed through the class name', function() {
  const src = [
    'class Counter {',
    '  field value: int;',
    '  fn main() {',
    '    var x: int = Counter.value;',
    '  }',
    '}'
  ].join('\n');
  let error = null;
  try {
    new CodeGenerator().generate(new Parser(src).parse(), 'Main');
  } catch (e) {
    error = e;
  }
  assert(error, 'Expected class-qualified instance field access to fail');
  assert(String(error.message).includes("Cannot access instance field 'Counter.value' without an object"), 'Unexpected error: ' + error.message);
});

test('Warning levels can suppress general warnings while keeping compatibility warnings', function() {
  const src = 'fn main() -> int { clearScreen(); if (true) { return 1; } }';
  const cg = new CodeGenerator({ warningLevel: 'compatibility' });
  cg.generate(new Parser(src).parse(), 'Main');
  assert(cg.warnings.length === 1, 'Expected only the compatibility warning, got ' + cg.warnings.length);
  assert(cg.warnings[0].includes('legacy API'), 'Expected compatibility warning, got ' + cg.warnings[0]);
});

test('Ignored non-void call results emit a warning', function() {
  const src = [
    'fn compute() -> int { return 7; }',
    'fn main() {',
    '  compute();',
    '}'
  ].join('\n');
  const cg = new CodeGenerator();
  cg.generate(new Parser(src).parse(), 'Main');
  assert(cg.warnings.some(function(w) { return w.includes("result of non-void call 'Main.compute' is ignored"); }), 'Expected ignored-result warning');
});

test('Screen.clearScreen inside loops emits a performance warning', function() {
  const src = 'fn main() { while (true) { Screen.clearScreen(); return; } }';
  const cg = new CodeGenerator();
  cg.generate(new Parser(src).parse(), 'Main');
  assert(cg.warnings.some(function(w) { return w.includes("'Screen.clearScreen' is called inside a loop"); }), 'Expected loop performance warning');
});

test('Unreachable statements after return are warned and not emitted', function() {
  const src = 'fn main() -> int { return 1; Output.printInt(7); }';
  const cg = new CodeGenerator();
  const vm = cg.generate(new Parser(src).parse(), 'Main');
  assert(cg.warnings.some(function(w) { return w.includes("unreachable ExpressionStatement"); }), 'Expected unreachable-code warning');
  assert(!vm.includes('call Output.printInt 1'), 'Unreachable call should not be emitted');
});

// ============================
// TEST 8: Constant folding and strength reduction
// ============================
console.log('\n--- Test: constant folding and strength reduction ---');

test('Constant expressions fold at compile time', function() {
  const src = 'fn main() -> int { return (2 + 3) * 4 - 5; }';
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(vm.includes('push constant 15'), 'Expected folded constant result in VM output');
  assert(!vm.includes('call Math.multiply 2'), 'Folded expression should not call Math.multiply');
});

test('Left shift by a constant power of two avoids Math.shiftLeft', function() {
  const src = 'fn main() -> int { var x: int = 7; return x << 3; }';
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(!vm.includes('call Math.shiftLeft 2'), 'Shift by constant should use inline doubling');
  assert((vm.match(/add/g) || []).length >= 3, 'Expected repeated add instructions for shift strength reduction');
});

test('Multiply by three avoids Math.multiply', function() {
  const src = 'fn main() -> int { var x: int = 7; return x * 3; }';
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(!vm.includes('call Math.multiply 2'), 'Multiply by three should use inline additions');
  assert((vm.match(/add/g) || []).length >= 2, 'Expected repeated add instructions for multiply-by-three lowering');
});

test('Multiply by five avoids Math.multiply', function() {
  const src = 'fn main() -> int { var x: int = 7; return x * 5; }';
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(!vm.includes('call Math.multiply 2'), 'Multiply by five should use inline additions');
  assert((vm.match(/add/g) || []).length >= 4, 'Expected repeated add instructions for multiply-by-five lowering');
});

test('Multiply by six avoids Math.multiply', function() {
  const src = 'fn main() -> int { var x: int = 7; return x * 6; }';
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(!vm.includes('call Math.multiply 2'), 'Multiply by six should use inline additions');
  assert((vm.match(/add/g) || []).length >= 3, 'Expected repeated add instructions for multiply-by-six lowering');
});

test('Constant boolean short-circuit removes dead rhs calls', function() {
  const src = [
    'fn rhs() -> bool { return true; }',
    'fn main() -> bool {',
    '  var a: bool = false && rhs();',
    '  var b: bool = true || rhs();',
    '  return a || b;',
    '}'
  ].join('\n');
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(!vm.includes('call Main.rhs 0'), 'Dead rhs call should be eliminated for constant short-circuit cases');
});

test('Constant boolean identities avoid short-circuit labels', function() {
  const src = [
    'fn lhs() -> int { return 7; }',
    'fn main() -> void {',
    '  var a: bool = true && lhs();',
    '  var b: bool = lhs() || false;',
    '  halt();',
    '}'
  ].join('\n');
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert((vm.match(/call Main\.lhs 0/g) || []).length === 2, 'Expected lhs to be evaluated exactly once per use');
  assert(!vm.includes('if-goto SC_F'), 'Optimized constant boolean identities should avoid SC_F labels');
  assert(!vm.includes('if-goto OR_T'), 'Optimized constant boolean identities should avoid OR_T labels');
});

test('Identical simple comparisons fold without compare ops', function() {
  const src = [
    'fn main() -> void {',
    '  var x: int = 7;',
    '  var a: bool = (x == x);',
    '  var b: bool = (x != x);',
    '  var c: bool = (x <= x);',
    '  var d: bool = (x > x);',
    '  halt();',
    '}'
  ].join('\n');
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  assert(!vm.includes('\neq\n'), 'Identical simple equality should fold without eq');
  assert(!vm.includes('\nlt\n'), 'Identical simple <= comparison should fold without lt');
  assert(!vm.includes('\ngt\n'), 'Identical simple > comparison should fold without gt');
});

test('Optimized multiply by power-of-two preserves runtime semantics', function() {
  const value = runJackExpr('x * 8', '  var x: int = -3;');
  assert(value === -24, 'Expected -24, got ' + value);
});

test('Optimized left shift preserves runtime semantics', function() {
  const value = runJackExpr('x << 3', '  var x: int = 7;');
  assert(value === 56, 'Expected 56, got ' + value);
});

test('Optimized multiply by negative one preserves runtime semantics', function() {
  const value = runJackExpr('x * -1', '  var x: int = -11;');
  assert(value === 11, 'Expected 11, got ' + value);
});

test('Optimized divide by negative one preserves runtime semantics', function() {
  const value = runJackExpr('x / -1', '  var x: int = 19;');
  assert(value === -19, 'Expected -19, got ' + value);
});

test('Optimized bitwise identity preserves runtime semantics', function() {
  const value = runJackExpr('(x & -1) | 0', '  var x: int = -1234;');
  assert(value === -1234, 'Expected -1234, got ' + value);
});

test('Multiply by power-of-two matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * 8', 'Math.multiply(x, 8)', [
    { vars: { x: -123 }, result: -984 },
    { vars: { x: -3 }, result: -24 },
    { vars: { x: -1 }, result: -8 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: 8 },
    { vars: { x: 7 }, result: 56 },
    { vars: { x: 4095 }, result: 32760 }
  ]);
});

test('Multiply by three matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * 3', 'Math.multiply(x, 3)', [
    { vars: { x: -123 }, result: -369 },
    { vars: { x: -3 }, result: -9 },
    { vars: { x: -1 }, result: -3 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: 3 },
    { vars: { x: 7 }, result: 21 },
    { vars: { x: 10922 }, result: 32766 }
  ]);
});

test('Multiply by five matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * 5', 'Math.multiply(x, 5)', [
    { vars: { x: -123 }, result: -615 },
    { vars: { x: -3 }, result: -15 },
    { vars: { x: -1 }, result: -5 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: 5 },
    { vars: { x: 7 }, result: 35 },
    { vars: { x: 6553 }, result: 32765 }
  ]);
});

test('Multiply by six matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * 6', 'Math.multiply(x, 6)', [
    { vars: { x: -123 }, result: -738 },
    { vars: { x: -3 }, result: -18 },
    { vars: { x: -1 }, result: -6 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: 6 },
    { vars: { x: 7 }, result: 42 },
    { vars: { x: 5461 }, result: 32766 }
  ]);
});

test('Multiply by negative three matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * -3', 'Math.multiply(x, -3)', [
    { vars: { x: -123 }, result: 369 },
    { vars: { x: -3 }, result: 9 },
    { vars: { x: -1 }, result: 3 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: -3 },
    { vars: { x: 7 }, result: -21 },
    { vars: { x: 10922 }, result: -32766 }
  ]);
});

test('Multiply by negative five matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * -5', 'Math.multiply(x, -5)', [
    { vars: { x: -123 }, result: 615 },
    { vars: { x: -3 }, result: 15 },
    { vars: { x: -1 }, result: 5 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: -5 },
    { vars: { x: 7 }, result: -35 },
    { vars: { x: 6553 }, result: -32765 }
  ]);
});

test('Multiply by negative six matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * -6', 'Math.multiply(x, -6)', [
    { vars: { x: -123 }, result: 738 },
    { vars: { x: -3 }, result: 18 },
    { vars: { x: -1 }, result: 6 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: -6 },
    { vars: { x: 7 }, result: -42 },
    { vars: { x: 5461 }, result: -32766 }
  ]);
});

test('Constant left shift matches Math.shiftLeft across signed cases', function() {
  assertExprMatchesReference('x << 3', 'Math.shiftLeft(x, 3)', [
    { vars: { x: -123 }, result: -984 },
    { vars: { x: -3 }, result: -24 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: 8 },
    { vars: { x: 7 }, result: 56 },
    { vars: { x: 4095 }, result: 32760 }
  ]);
});

test('Multiply by negative one matches Math.multiply across signed cases', function() {
  assertExprMatchesReference('x * -1', 'Math.multiply(x, -1)', [
    { vars: { x: -123 }, result: 123 },
    { vars: { x: -11 }, result: 11 },
    { vars: { x: -1 }, result: 1 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: -1 },
    { vars: { x: 19 }, result: -19 },
    { vars: { x: 123 }, result: -123 }
  ]);
});

test('Divide by negative one matches Math.divide across signed cases', function() {
  assertExprMatchesReference('x / -1', 'Math.divide(x, -1)', [
    { vars: { x: -123 }, result: 123 },
    { vars: { x: -1 }, result: 1 },
    { vars: { x: 0 }, result: 0 },
    { vars: { x: 1 }, result: -1 },
    { vars: { x: 19 }, result: -19 },
    { vars: { x: 123 }, result: -123 }
  ]);
});

test('Division by zero returns zero instead of recursing forever', function() {
  const value = runJackExpr('7 / 0');
  assert(value === 0, 'Expected divide-by-zero to return 0, got ' + value);
});

test('Modulo by zero returns zero instead of recursing forever', function() {
  const value = runJackExpr('7 % 0');
  assert(value === 0, 'Expected modulo-by-zero to return 0, got ' + value);
});

test('Identity and annihilator rewrites match variable-based references', function() {
  assertExprMatchesReference('(x + 0) - 0', '(x + zero) - zero', [
    { vars: { x: -55, zero: 0 }, result: -55 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 89, zero: 0 }, result: 89 }
  ]);
  assertExprMatchesReference('(x | 0) ^ 0', '(x | zero) ^ zero', [
    { vars: { x: -55, zero: 0 }, result: -55 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 89, zero: 0 }, result: 89 }
  ]);
  assertExprMatchesReference('x & 0', 'x & zero', [
    { vars: { x: -55, zero: 0 }, result: 0 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 89, zero: 0 }, result: 0 }
  ]);
  assertExprMatchesReference('(x & -1) | 0', '(x & allBits) | zero', [
    { vars: { x: -1234, allBits: -1, zero: 0 }, result: -1234 },
    { vars: { x: 0, allBits: -1, zero: 0 }, result: 0 },
    { vars: { x: 4321, allBits: -1, zero: 0 }, result: 4321 }
  ]);
});

test('Shift-by-zero and trivial arithmetic rewrites match references', function() {
  assertExprMatchesReference('x << 0', 'Math.shiftLeft(x, zero)', [
    { vars: { x: -42, zero: 0 }, result: -42 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 77, zero: 0 }, result: 77 }
  ]);
  assertExprMatchesReference('x >> 0', 'Math.shiftRight(x, zero)', [
    { vars: { x: -42, zero: 0 }, result: -42 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 77, zero: 0 }, result: 77 }
  ]);
  assertExprMatchesReference('x * 1', 'Math.multiply(x, one)', [
    { vars: { x: -42, one: 1 }, result: -42 },
    { vars: { x: 0, one: 1 }, result: 0 },
    { vars: { x: 77, one: 1 }, result: 77 }
  ]);
  assertExprMatchesReference('x * 0', 'Math.multiply(x, zero)', [
    { vars: { x: -42, zero: 0 }, result: 0 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 77, zero: 0 }, result: 0 }
  ]);
  assertExprMatchesReference('x / 1', 'Math.divide(x, one)', [
    { vars: { x: -42, one: 1 }, result: -42 },
    { vars: { x: 0, one: 1 }, result: 0 },
    { vars: { x: 77, one: 1 }, result: 77 }
  ]);
  assertExprMatchesReference('x % 1', 'Math.modulo(x, one)', [
    { vars: { x: -42, one: 1 }, result: 0 },
    { vars: { x: 0, one: 1 }, result: 0 },
    { vars: { x: 77, one: 1 }, result: 0 }
  ]);
});

test('Comparison lowerings match reference forms across signed cases', function() {
  assertExprMatchesReference('x != y', '~(x == y)', [
    { vars: { x: -7, y: -7 }, result: 0 },
    { vars: { x: -7, y: 7 }, result: -1 },
    { vars: { x: 0, y: 0 }, result: 0 },
    { vars: { x: 12, y: 3 }, result: -1 }
  ]);
  assertExprMatchesReference('x <= y', '~(x > y)', [
    { vars: { x: -7, y: -7 }, result: -1 },
    { vars: { x: -7, y: 7 }, result: -1 },
    { vars: { x: 8, y: 3 }, result: 0 },
    { vars: { x: 3, y: 8 }, result: -1 }
  ]);
  assertExprMatchesReference('x >= y', '~(x < y)', [
    { vars: { x: -7, y: -7 }, result: -1 },
    { vars: { x: -7, y: 7 }, result: 0 },
    { vars: { x: 8, y: 3 }, result: -1 },
    { vars: { x: 3, y: 8 }, result: 0 }
  ]);
  assertExprMatchesReference('x == x', 'same', [
    { vars: { x: -7, same: -1 }, result: -1 },
    { vars: { x: 0, same: -1 }, result: -1 },
    { vars: { x: 12, same: -1 }, result: -1 }
  ]);
  assertExprMatchesReference('x != x', 'zero', [
    { vars: { x: -7, zero: 0 }, result: 0 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 12, zero: 0 }, result: 0 }
  ]);
  assertExprMatchesReference('x <= x', 'same', [
    { vars: { x: -7, same: -1 }, result: -1 },
    { vars: { x: 0, same: -1 }, result: -1 },
    { vars: { x: 12, same: -1 }, result: -1 }
  ]);
  assertExprMatchesReference('x > x', 'zero', [
    { vars: { x: -7, zero: 0 }, result: 0 },
    { vars: { x: 0, zero: 0 }, result: 0 },
    { vars: { x: 12, zero: 0 }, result: 0 }
  ]);
});

test('Boolean lowerings match reference forms across signed cases', function() {
  assertExprMatchesReference('x && y', '((x == 0) | (y == 0)) == 0', [
    { vars: { x: 0, y: 0 }, result: 0 },
    { vars: { x: 0, y: 5 }, result: 0 },
    { vars: { x: -3, y: 0 }, result: 0 },
    { vars: { x: -3, y: 9 }, result: -1 }
  ]);
  assertExprMatchesReference('x || y', '((x == 0) & (y == 0)) == 0', [
    { vars: { x: 0, y: 0 }, result: 0 },
    { vars: { x: 0, y: 5 }, result: -1 },
    { vars: { x: -3, y: 0 }, result: -1 },
    { vars: { x: -3, y: 9 }, result: -1 }
  ]);
  assertExprMatchesReference('!x', 'x == 0', [
    { vars: { x: 0 }, result: -1 },
    { vars: { x: 1 }, result: 0 },
    { vars: { x: -1 }, result: 0 },
    { vars: { x: 27 }, result: 0 }
  ]);
});

// ============================
// TEST 9: Assembler structured listing
// ============================
console.log('\n--- Test: assembler structured listing ---');

test('Assembler returns label-aware listing entries', function() {
  const asmr = new Assembler().assemble('start:\nLDI A, 1\nJMP\n');
  assert(asmr.success, 'Assembly should succeed');
  assert(Array.isArray(asmr.listing), 'Listing should be returned');
  assert(asmr.listing.length >= 2, 'Expected listing entries for emitted words');
  assert(asmr.listing[0].labels.includes('start'), 'Expected label annotation on first listing entry');
});

test('Assembler returns symbol summaries without treating equates as labels', function() {
  const asmr = new Assembler().assemble('CONST: .word 1\n.equ LIMIT 42\nBRA CONST\n');
  assert(asmr.success, 'Assembly should succeed');
  assert(asmr.symbolSummary.total === 2, 'Expected two summary symbols');
  assert(asmr.symbolSummary.labels.some(function(entry) { return entry.name === 'CONST'; }), 'Expected label summary entry');
  assert(asmr.symbolSummary.equates.some(function(entry) { return entry.name === 'LIMIT' && entry.value === 42; }), 'Expected equate summary entry');
  assert(!asmr.listing[42], 'Equates should not create listing rows');
});

test('Assembler unresolved-symbol diagnostics distinguish symbol lookups', function() {
  const asmr = new Assembler().assemble('BRA missingLabel\n');
  assert(!asmr.success, 'Assembly should fail for missing label');
  assert(asmr.errors.some(function(err) { return err.includes("Ukjent offset: 'missingLabel'") || err.includes("Ukjent offset: 'missingLabel'."); }), 'Expected clearer unresolved-offset error, got ' + asmr.errors.join('; '));
});

test('Assembler warns when branch offsets approach encoding limits', function() {
  const lines = ['BRA nearLimit'];
  for (let i = 0; i < 248; i++) lines.push('NOP');
  lines.push('nearLimit:');
  lines.push('HALT');
  const asmr = new Assembler().assemble(lines.join('\n'));
  assert(asmr.success, 'Assembly should succeed');
  assert(asmr.warnings.some(function(w) { return w.includes('nær kodingsgrensen'); }), 'Expected near-limit offset warning');
});

test('Array indexing traps on out-of-bounds access', function() {
  const src = [
    'fn main() {',
    '  var arr: Array = Array.new(2);',
    '  poke(60000, arr[2]);',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 200000);
  assert(!result.halted, 'Bounds violation should trap into Sys.error');
  assert(readTextString(result.mem, 0, 0, 6) === 'ERR206', 'Expected ERR206 on array bounds trap');
});

test('Array bounds helper routes through Sys.error instead of hard-coded framebuffer writes', function() {
  const src = [
    'fn main() {',
    '  var arr: Array = Array.new(1);',
    '  poke(60000, arr[2]);',
    '}'
  ].join('\n');
  const ast = new Parser(src).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  const fullVM = STDLIB_VM + '\n' + vm;
  const vmr = new VMTranslator().translate(fullVM, 'Main');
  assert(vmr.success, 'Translation should succeed');
  assert(vmr.assembly.includes('LDA A, Sys.error'), 'Expected array bounds helper to call Sys.error');
  assert(!vmr.assembly.includes('LDA A, 60416'), 'Array bounds helper should no longer hard-code framebuffer writes');
});

test('String charAt traps on out-of-bounds access', function() {
  const src = [
    'fn main() {',
    '  var s: String = "A";',
    '  poke(60000, s.charAt(1));',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 200000);
  assert(!result.halted, 'Bounds violation should trap into Sys.error');
  assert(readTextString(result.mem, 0, 0, 6) === 'ERR205', 'Expected ERR205 on string bounds trap');
});

test('Memory.alloc rejects zero-sized allocations', function() {
  const src = 'fn main() { Memory.alloc(0); }';
  const result = runCode(compileJack(src), 200000);
  assert(!result.halted, 'Invalid alloc should trap into Sys.error');
  assert(readTextString(result.mem, 0, 0, 6) === 'ERR202', 'Expected ERR202 for invalid allocation size');
});

test('Memory.deAlloc rejects invalid pointers', function() {
  const src = 'fn main() { Memory.deAlloc(1234); }';
  const result = runCode(compileJack(src), 200000);
  assert(!result.halted, 'Invalid free should trap into Sys.error');
  assert(readTextString(result.mem, 0, 0, 6) === 'ERR204', 'Expected ERR204 for invalid free');
});

test('Memory.deAlloc accepts valid high-address pointers', function() {
  const src = [
    'fn main() {',
    '  poke(60401, 60000);',
    '  poke(49999, 16);',
    '  Memory.deAlloc(50000);',
    '  halt();',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 200000);
  assert(result.halted, 'Valid high-address free should not trap');
  assert(result.mem.ram[60404] === 49999, 'Free-list head should point at the freed block header');
  assert(result.mem.ram[50000] === 0, 'Freed block should terminate the free list');
});

test('Memory.alloc splits oversized free blocks', function() {
  const src = [
    'fn main() {',
    '  poke(60404, 8192);',
    '  poke(8192, 10);',
    '  poke(8193, 0);',
    '  poke(60000, Memory.alloc(4));',
    '  halt();',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 200000);
  assert(result.halted, 'Program should halt after split allocation');
  assert(result.mem.ram[60000] === 8193, 'Expected allocation to reuse the free block payload');
  assert(result.mem.ram[8192] === 4, 'Allocated block header should be rewritten to the requested size');
  assert(result.mem.ram[60404] === 8197, 'Free-list head should advance to the split remainder block');
  assert(result.mem.ram[8197] === 5, 'Split remainder should keep the leftover payload size');
  assert(result.mem.ram[8198] === 0, 'Split remainder should preserve the original next pointer');
});

test('Memory.deAlloc coalesces adjacent free blocks', function() {
  const src = [
    'fn main() {',
    '  poke(60401, 9000);',
    '  poke(60404, 8192);',
    '  poke(8192, 4);',
    '  poke(8193, 8201);',
    '  poke(8201, 4);',
    '  poke(8202, 0);',
    '  poke(8197, 3);',
    '  Memory.deAlloc(8198);',
    '  halt();',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 200000);
  assert(result.halted, 'Program should halt after coalescing free blocks');
  assert(result.mem.ram[60404] === 8192, 'Coalesced block should retain the original predecessor header');
  assert(result.mem.ram[8192] === 13, 'Coalesced block should absorb both adjacent free regions');
  assert(result.mem.ram[8193] === 0, 'Coalesced block should terminate the free list');
});

test('Allocator survives long-running heap churn near the heap ceiling', function() {
  const src = [
    'fn main() {',
    '  var i: int = 0;',
    '  var p: int = 0;',
    '  poke(60401, 60320);',
    '  while (i < 24) {',
    '    p = Memory.alloc(4);',
    '    Memory.deAlloc(p);',
    '    i = i + 1;',
    '  }',
    '  poke(60000, Memory.alloc(8));',
    '  halt();',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 400000);
  assert(result.halted, 'Allocator should keep reusing freed blocks instead of exhausting the heap');
  assert(result.mem.ram[60000] !== 0, 'Final allocation after churn should succeed');
});

test('Array.new supports zero-length arrays without corrupting the heap', function() {
  const src = [
    'fn main() -> int {',
    '  var arr: Array = Array.new(0);',
    '  arr.dispose();',
    '  return 1;',
    '}'
  ].join('\n');
  const vm = new CodeGenerator().generate(new Parser(src).parse(), 'Main');
  assert(vm.includes('call Array.new 1'), 'Expected Array.new call to remain available');
});

test('Empty class constructors still allocate a valid object', function() {
  const src = [
    'class Box {',
    '  new() {}',
    '  method ping() -> int { return 888; }',
    '}',
    'class Main {',
    'fn main() -> void {',
    '  var box: Box = Box.new();',
    '  poke(60000, box.ping());',
    '  halt();',
    '}',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 400000);
  assert(result.halted, 'Program using an empty class constructor should halt');
  assert(result.mem.ram[60000] === 888, 'Expected method call on empty class instance to succeed');
});

test('Empty structs still allocate and dispose cleanly', function() {
  const src = [
    'struct Empty {',
    '}',
    'fn main() -> void {',
    '  var item: Empty = Empty.new();',
    '  item.dispose();',
    '  poke(60000, 321);',
    '  halt();',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 400000);
  assert(result.halted, 'Program using an empty struct should halt');
  assert(result.mem.ram[60000] === 321, 'Expected empty struct allocation/disposal to succeed');
});

test('Input helper APIs are available in the compiler surface', function() {
  const vmRead = new CodeGenerator().generate(new Parser('fn main() -> int { return Input.readKey(); }').parse(), 'Main');
  assert(vmRead.includes('call Keyboard.keyPressed 0'), 'Expected Input.readKey lowering to Keyboard.keyPressed');
  assert(!vmRead.includes('call Input.readKey 0'), 'Input.readKey should lower directly and avoid stdlib linkage');
  const vmDown = new CodeGenerator().generate(new Parser('fn main() -> bool { return Input.isKeyDown(65); }').parse(), 'Main');
  assert(vmDown.includes('call Keyboard.keyPressed 0'), 'Expected Input.isKeyDown lowering to Keyboard.keyPressed');
  assert(!vmDown.includes('call Input.isKeyDown 1'), 'Input.isKeyDown should lower directly and avoid stdlib linkage');
});

test('Sound helper APIs are available in the compiler surface', function() {
  const src = [
    'fn main() {',
    '  Sound.setVoice(1, 220, 12, 3);',
    '  poke(60000, peek(0xFF42));',
    '  poke(60001, peek(0xFF43));',
    '  Sound.setVoice(3, 77, 9, 2);',
    '  poke(60004, peek(0xFF46));',
    '  poke(60005, peek(0xFF47));',
    '  Sound.silence();',
    '  poke(60002, peek(0xFF41));',
    '  poke(60003, peek(0xFF43));',
    '  poke(60006, peek(0xFF45));',
    '  poke(60007, peek(0xFF47));',
    '  halt();',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 500000);
  assert(result.halted, 'Program should halt');
  assert(result.mem.ram[60000] === 220, 'Expected voice period register to be written');
  assert(result.mem.ram[60001] === 968, 'Expected control register to contain waveform, volume, and gate bits');
  assert(result.mem.ram[60004] === 77, 'Expected noise voice rate register to be written');
  assert(result.mem.ram[60005] === 664, 'Expected noise control register to contain mode, volume, and gate bits');
  assert(result.mem.ram[60002] === 0, 'Expected silence() to clear channel 0 control register');
  assert(result.mem.ram[60003] === 0, 'Expected silence() to clear channel 1 control register');
  assert(result.mem.ram[60006] === 0, 'Expected silence() to clear channel 2 control register');
  assert(result.mem.ram[60007] === 0, 'Expected silence() to clear channel 3 control register');
});

test('Sound helpers preserve earlier arguments when later arguments have side effects', function() {
  const src = [
    'fn wave() -> int {',
    '  poke(60010, 99);',
    '  return 3;',
    '}',
    'fn main() {',
    '  Sound.setVoice(1, 220, 12, wave());',
    '  poke(60000, peek(0xFF42));',
    '  poke(60001, peek(0xFF43));',
    '  poke(60002, peek(60010));',
    '  halt();',
    '}'
  ].join('\n');
  const result = runCode(compileJack(src), 500000);
  assert(result.halted, 'Program should halt');
  assert(result.mem.ram[60000] === 220, 'Expected voice-1 period write to survive nested argument evaluation');
  assert(result.mem.ram[60001] === 968, 'Expected voice-1 control write to survive nested argument evaluation');
  assert(result.mem.ram[60002] === 99, 'Expected nested side effect to still run');
});

test('Time.sleep uses timer-backed milliseconds', function() {
  const src = [
    'fn main() {',
    '  Time.sleep(5);',
    '  poke(60000, Time.millis());',
    '  halt();',
    '}'
  ].join('\n');
  const machine = makeExecMachine();
  machine.memory.loadProgram(compileJack(src));
  runMachine(machine, 300000);
  assert(machine.cpu.halted, 'Program should halt after sleeping');
  assert(machine.memory.ram[60000] >= 4, 'Expected Time.millis() to advance by at least 4 ms');
  assert(machine.memory.ram[60000] <= 12, 'Expected Time.millis() to stay in a tight range around 5 ms');
  assert(machine.cpu.cycleCount >= 100000, 'Expected Time.sleep to consume emulated time, not return immediately');
});

test('FrameClock.waitNextFrame targets a stable 60 Hz cadence', function() {
  const src = [
    'fn main() {',
    '  FrameClock.init(60);',
    '  FrameClock.waitNextFrame();',
    '  poke(60000, FrameClock.deltaMillis());',
    '  poke(60001, Time.millis());',
    '  halt();',
    '}'
  ].join('\n');
  const machine = makeExecMachine();
  machine.memory.loadProgram(compileJack(src));
  runMachine(machine, 600000);
  assert(machine.cpu.halted, 'Program should halt after waiting one frame');
  assert(machine.memory.ram[60000] >= 15 && machine.memory.ram[60000] <= 17, 'Expected FrameClock delta to be about 16 ms');
  assert(machine.memory.ram[60001] >= 15 && machine.memory.ram[60001] <= 20, 'Expected one frame wait to advance Time.millis by about 16 ms');
});

test('SoundGenerator ignores invalid MMIO offsets', function() {
  eval(fs.readFileSync('js/emulator/sound.js', 'utf8'));
  const sound = new SoundGenerator();
  sound.write(7, 0x28);
  sound.write(8, 1234);
  assert(sound.channels[3].control === 0x28, 'Expected channel 3 control register to be writable');
  assert(sound.channels[0].frequency === 0, 'Invalid sound offset should not alias into channel 0');
  sound.destroy();
});

test('SoundGenerator restarts channels cleanly after stop/start cycles', function() {
  eval(fs.readFileSync('js/emulator/sound.js', 'utf8'));
  withFakeAudioContext(function() {
    const sound = new SoundGenerator();
    sound.write(0, 2273);
    sound.write(1, 0x98);
    const firstPan = sound.panners[0];
    assert(firstPan, 'Expected channel panner to be created on first note');
    assert(firstPan.connections.includes(sound.masterGain), 'Expected active channel to feed the master gain');

    sound.write(1, 0);
    sound.write(0, 1911);
    sound.write(1, 0xA8);

    assert(sound.sources[0], 'Expected channel source to be recreated after restart');
    assert(sound.panners[0], 'Expected restarted channel to keep a panner');
    assert(sound.panners[0].connections.includes(sound.masterGain), 'Restarted channel must remain connected to the master gain');
    sound.destroy();
  });
});

test('SoundGenerator maps documented tone waveforms correctly', function() {
  eval(fs.readFileSync('js/emulator/sound.js', 'utf8'));
  withFakeAudioContext(function() {
    const sound = new SoundGenerator();
    sound.write(0, 2273);

    sound.write(1, (1 << 8) | (9 << 4) | 8);
    assert(sound.sources[0].type === 'triangle', 'Waveform 1 should map to triangle');

    sound.write(1, (2 << 8) | (9 << 4) | 8);
    assert(sound.sources[0].type === 'sawtooth', 'Waveform 2 should map to sawtooth');

    sound.write(1, (3 << 8) | (9 << 4) | 8);
    assert(sound.sources[0].type === 'sawtooth', 'Waveform 3 should map to sawtooth');
    sound.destroy();
  });
});

test('NexaOS exec-magic launches keep the heap break above the reserved base', function() {
  const src = [
    'fn main() -> void {',
    '  var arr: Array = Array.new(1);',
    '  arr[0] = 321;',
    '  poke(60000, arr[0]);',
    '  Memory.deAlloc(arr);',
    '  halt();',
    '}'
  ].join('\n');
  const code = compileJack(src);
  const machine = makeExecMachine();
  machine.disk.storage[0] = 0x4844;
  const sectors = writeProgramToDisk(machine.disk, code, 5);
  loadExecProgramFromDisk(machine.memory, machine.cpu, machine.disk, sectors, code.length);
  assert(machine.memory.ram[60401] >= 8192, 'Expected exec loader to clamp heap break above low memory, got ' + machine.memory.ram[60401]);
  runMachine(machine, 500000);
  assert(machine.cpu.halted, 'Expected launched program to halt cleanly');
  assert(machine.memory.ram[60000] === 321, 'Expected launched program to allocate, free, and preserve its result');
});

test('Worker upload failures do not leak FAT sectors', function() {
  const disk = new DiskController();
  const fatOff = 1 * SECTOR_SIZE;
  disk.storage[0] = 0x4844;
  for (let sector = 5; sector < DISK_SECTORS; sector++) disk.storage[fatOff + sector] = 0xFFFF;
  disk.storage[fatOff + 5] = 0;
  disk.storage[fatOff + 6] = 0;
  const before = countAllocatedDiskSectors(disk);
  const result = uploadFileToDisk(disk, new Uint16Array(3 * SECTOR_SIZE), paddedWordBytes('LEAK', 8), paddedWordBytes('NXE', 3));
  const after = countAllocatedDiskSectors(disk);
  assert(!result.ok, 'Expected upload to fail when disk lacks enough sectors');
  assert(result.err === 'Disk full.', 'Unexpected error: ' + result.err);
  assert(after === before, 'Expected failed upload to leave FAT unchanged, before=' + before + ', after=' + after);
});

test('Worker upload preserves an existing file when replacement allocation fails', function() {
  const disk = new DiskController();
  const fatOff = 1 * SECTOR_SIZE;
  const dirOff = 3 * SECTOR_SIZE;
  const name = paddedWordBytes('TEST', 8);
  const ext = paddedWordBytes('NXE', 3);
  disk.storage[0] = 0x4844;
  for (let i = 0; i < 8; i++) disk.storage[dirOff + i] = name[i];
  for (let i = 0; i < 3; i++) disk.storage[dirOff + 8 + i] = ext[i];
  disk.storage[dirOff + 11] = 1;
  disk.storage[dirOff + 12] = 5;
  disk.storage[dirOff + 13] = 200;
  for (let sector = 5; sector < DISK_SECTORS; sector++) disk.storage[fatOff + sector] = 0xFFFF;
  disk.storage[fatOff + 5] = 6;
  disk.storage[fatOff + 6] = 0xFFFF;

  const result = uploadFileToDisk(disk, new Uint16Array(4 * SECTOR_SIZE), name, ext);
  assert(!result.ok, 'Expected oversized replacement to fail');
  assert(result.err === 'Disk full.', 'Unexpected error: ' + result.err);
  assert(disk.storage[dirOff + 12] === 5, 'Expected directory entry to keep original first sector');
  assert(disk.storage[dirOff + 13] === 200, 'Expected directory entry to keep original size');
  assert(disk.storage[fatOff + 5] === 6, 'Expected first sector link to stay intact after failed replacement');
  assert(disk.storage[fatOff + 6] === 0xFFFF, 'Expected final sector marker to stay intact after failed replacement');
});

test('VM translator prunes unreachable functions by default', function() {
  const vm = [
    'function Main.main 0',
    'call Helper.used 0',
    'return',
    'function Helper.used 0',
    'push constant 1',
    'return',
    'function Helper.unused 0',
    'push constant 2',
    'return'
  ].join('\n');
  const vmr = new VMTranslator().translate(vm, 'Main');
  assert(vmr.success, 'Translation should succeed');
  assert(vmr.assembly.includes('Main.main:'), 'Expected Main.main in assembly');
  assert(vmr.assembly.includes('Helper.used:'), 'Expected reachable helper in assembly');
  assert(!vmr.assembly.includes('Helper.unused:'), 'Expected unreachable helper to be pruned by default');
});

test('VM translator can preserve all functions when pruning is disabled', function() {
  const vm = [
    'function Main.main 0',
    'call Helper.used 0',
    'return',
    'function Helper.used 0',
    'push constant 1',
    'return',
    'function Helper.unused 0',
    'push constant 2',
    'return'
  ].join('\n');
  const vmr = new VMTranslator().translate(vm, 'Main', { pruneUnreachable: false });
  assert(vmr.success, 'Translation should succeed');
  assert(vmr.assembly.includes('Helper.unused:'), 'Expected unreachable helper to remain when pruning is disabled');
});

test('VM translator keeps additional explicit reachability roots', function() {
  const vm = [
    'function Main.main 0',
    'call Helper.used 0',
    'return',
    'function Helper.used 0',
    'push constant 1',
    'return',
    'function Helper.altEntry 0',
    'push constant 2',
    'return'
  ].join('\n');
  const vmr = new VMTranslator().translate(vm, 'Main', { reachabilityRoots: ['Main.main', 'Helper.altEntry'] });
  assert(vmr.success, 'Translation should succeed');
  assert(vmr.assembly.includes('Helper.used:'), 'Expected called helper to remain');
  assert(vmr.assembly.includes('Helper.altEntry:'), 'Expected explicit alternate root to remain');
});

// ============================
// TEST 10: Full pipeline (NexaOS compilation)
// ============================
console.log('\n--- Test: NexaOS full pipeline ---');

test('NexaOS compiles without errors', function() {
  const src = fs.readFileSync('OS/nexaos.nx', 'utf8');
  const p = new Parser(src);
  const ast = p.parse();
  const cg = new CodeGenerator();
  const vm = cg.generate(ast, 'Main');
  const fullVM = STDLIB_VM + '\n' + vm;
  const vmt = new VMTranslator();
  const boot = vmt.bootstrap();
  const vmr = vmt.translate(fullVM, 'Main');
  assert(vmr.errors.length === 0, 'VM translation errors: ' + vmr.errors.join('; '));
  const fullAsm = boot + '\n' + vmr.assembly;
  const asmr = new Assembler().assemble(fullAsm);
  assert(asmr.errors.length === 0, 'Assembly errors: ' + asmr.errors.join('; '));
  assert(asmr.code.length <= 0xEBF0, 'Code too large: ' + asmr.code.length + ' words (max 60400)');
  console.log('    Code size: ' + asmr.code.length + ' words');
});

// ============================
// Summary
// ============================
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
