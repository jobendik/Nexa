// Benchmark: measure cycles/sec in different modes
const fs = require('fs');
eval(fs.readFileSync('js/emulator/memory.js', 'utf8'));
eval(fs.readFileSync('js/emulator/cpu.js', 'utf8'));

function bench(name, setup) {
  var mem = new Memory();
  var cpu = new CPU(mem);
  setup(cpu, mem);

  // Warm up
  cpu.runFast(10000);
  cpu.reset();
  setup(cpu, mem);

  // Measure
  var total = 0;
  var start = performance.now();
  for (var i = 0; i < 100; i++) {
    cpu.PC = 0; cpu.halted = false;
    total += cpu.runFast(100000);
  }
  var elapsed = performance.now() - start;
  var mhz = (total / elapsed / 1000).toFixed(1);
  console.log(name + ': ' + mhz + ' MHz (' + total + ' cycles in ' + elapsed.toFixed(1) + 'ms)');
}

// Tight loop: LDI A, 1; ADD D, A; BR -2
// This tests raw decode+execute throughput
function setupLoop(cpu, mem) {
  mem.ram[0] = 0x0001; // LDI A, 1
  mem.ram[1] = 0x2500; // ADD D, A
  mem.ram[2] = (0x9000 | (0x1FE & 0x1FF)); // BR always -2 (offset = -2, encoded)
  // BR offset encoding: 9-bit signed from PC+1. To go back 2 from PC+1=3: offset = -3+0 = ...
  // Actually BR offset = target - (PC+1). Target = 0, PC+1 = 3. offset = 0-3 = -3.
  // 9-bit signed -3 = 0x1FD. nzp = 111 for always.
  mem.ram[2] = (0x9000 | (7 << 9) | ((-3) & 0x1FF)); // BRnzp -3
}

bench('Kernel, IE off', function(cpu, mem) {
  setupLoop(cpu, mem);
});

bench('Kernel, IE on', function(cpu, mem) {
  setupLoop(cpu, mem);
  cpu.STATUS = 4; // IE enabled
});

bench('User mode', function(cpu, mem) {
  // Place loop at physical address 5000
  mem.ram[5000] = 0x0001; // LDI A, 1
  mem.ram[5001] = 0x2500; // ADD D, A
  mem.ram[5002] = (0x9000 | (7 << 9) | ((-3) & 0x1FF)); // BRnzp -3
  cpu.activeMode = true;
  cpu.STATUS = 8;
  cpu.BASE = 5000;
  cpu.LIMIT = 100;
});

console.log('\nDone');
