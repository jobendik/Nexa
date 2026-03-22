// Quick test to verify runFast correctness after performance optimization
const fs = require('fs');
eval(fs.readFileSync('js/emulator/memory.js', 'utf8'));
eval(fs.readFileSync('js/emulator/cpu.js', 'utf8'));

var HALT = 0xE300; // SYS 3
var pass = 0, fail = 0;

function check(name, actual, expected) {
  if (actual === expected) { pass++; }
  else { fail++; console.log('  FAIL: ' + name + ' = ' + actual + ', expected ' + expected); }
}

// Test 1: Basic kernel mode (IE off)
console.log('Test 1: Basic kernel mode');
var mem = new Memory(), cpu = new CPU(mem);
mem.ram[0] = 0x0005; // LDI A, 5
mem.ram[1] = 0x0405; // LDI D, 5
mem.ram[2] = 0x2100; // ADD A, D
mem.ram[3] = HALT;
cpu.runFast(100);
check('A', cpu.A, 10);
check('halted', cpu.halted, true);

// Test 2: Kernel + IE (the critical optimization)
// Step through to understand expected behavior first
console.log('Test 2: Kernel + IE (step-by-step trace)');
mem = new Memory(); cpu = new CPU(mem);
mem.ram[0] = 0x0005; mem.ram[1] = 0x0405; mem.ram[2] = 0x2100;  // ADD A, D
mem.ram[3] = 0x0803; mem.ram[4] = 0x2200; mem.ram[5] = HALT;  // ADD A, B (src=2=B)
cpu.STATUS = 4;
cpu.runFast(100);
check('A (IE)', cpu.A, 13);
check('halted (IE)', cpu.halted, true);

// Test 3: CALL/RET
console.log('Test 3: CALL/RET');
mem = new Memory(); cpu = new CPU(mem);
mem.ram[0] = (0x0C00 | (256 & 0x3FF)); // LDI SP, 256
mem.ram[1] = 0x0004; // LDI A, 4
mem.ram[2] = 0xB000; // CALL
mem.ram[3] = HALT;
mem.ram[4] = 0x040A; // LDI D, 10
mem.ram[5] = 0xF000; // RET
cpu.runFast(100);
check('D', cpu.D, 10);
check('halted', cpu.halted, true);

// Test 4: PUSH/POP
console.log('Test 4: PUSH/POP');
mem = new Memory(); cpu = new CPU(mem);
mem.ram[0] = (0x0C00 | (256 & 0x3FF));
mem.ram[1] = 0x002A; // LDI A, 42
mem.ram[2] = 0xC000; // PUSH A
mem.ram[3] = 0x0000; // LDI A, 0
mem.ram[4] = 0xC800; // POP A
mem.ram[5] = HALT;
cpu.runFast(100);
check('A', cpu.A, 42);

// Test 5: LOAD/STORE
console.log('Test 5: LOAD/STORE');
mem = new Memory(); cpu = new CPU(mem);
mem.ram[0] = 0x0064; // LDI A, 100
mem.ram[1] = 0x042A; // LDI D, 42
mem.ram[2] = 0x8400; // STORE D, [A+0]
mem.ram[3] = 0x0064; // LDI A, 100
mem.ram[4] = 0x7800; // LOAD B, [A+0]
mem.ram[5] = HALT;
cpu.runFast(100);
check('B', cpu.B, 42);

// Test 6: User mode LOAD/STORE
console.log('Test 6: User mode LOAD/STORE');
mem = new Memory(); cpu = new CPU(mem);
// Program at physical address 1000 (BASE=1000, user PC starts at 0)
var BASE = 1000;
mem.ram[BASE + 0] = 0x0005; // LDI A, 5
mem.ram[BASE + 1] = 0x042A; // LDI D, 42
mem.ram[BASE + 2] = 0x8400; // STORE D, [A+0]
mem.ram[BASE + 3] = 0x0005; // LDI A, 5
mem.ram[BASE + 4] = 0x7800; // LOAD B, [A+0]
mem.ram[BASE + 5] = HALT;   // SYS 3 in user mode -> privilege fault
cpu.activeMode = true;
cpu.STATUS = 8; // MODE bit set
cpu.BASE = BASE;
cpu.LIMIT = 100;
cpu.runFast(5); // Run 5 instructions (LDI, LDI, STORE, LDI, LOAD)
check('B (user)', cpu.B, 42);

// Test 7: User mode fetch fault
console.log('Test 7: User mode fetch out-of-bounds');
mem = new Memory(); cpu = new CPU(mem);
mem.ram[1000] = 0x0005; // LDI A, 5
cpu.activeMode = true;
cpu.STATUS = 8;
cpu.BASE = 1000;
cpu.LIMIT = 2; // Only 2 words allowed
cpu.PC = 0;
cpu.runFast(5);
// Should fault at PC=2 (beyond LIMIT)
console.log('  PC=' + cpu.PC + ' (expect fault handler at 12+1=13)');
// After fetch fault at PC=2, raiseFault sets PC=12
check('fault PC', cpu.PC, 12); // raiseFault sets PC=12 (fault vector)

console.log('\n' + pass + ' passed, ' + fail + ' failed');
