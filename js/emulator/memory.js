// ============================================================
// Memory — 64K address space with memory-mapped I/O
// ============================================================

function setInitialHeapBreak(ram, programWords) {
  if (programWords <= 60400) {
    ram[60401] = Math.max(programWords, 8192);
  }
}

var Memory = class {
  constructor() {
    this.ram = new Uint16Array(65536);
    this.ioDevices = new Map();
    this.onWriteCallback = null;
  }

  read(address) {
    var addr = address & 0xFFFF;
    if (addr >= 0xFF00) {
      var base = addr & 0xFFF0;
      var device = this.ioDevices.get(base);
      if (device) return device.read(addr - base);
      return 0;
    }
    return this.ram[addr];
  }

  write(address, value) {
    var addr = address & 0xFFFF;
    var val = value & 0xFFFF;
    if (addr >= 0xFF00) {
      var base = addr & 0xFFF0;
      var device = this.ioDevices.get(base);
      if (device) device.write(addr - base, val);
      return;
    }
    this.ram[addr] = val;
    if (this.onWriteCallback) this.onWriteCallback(addr, val);
  }

  loadProgram(code) {
    for (var i = 0; i < code.length && i < this.ram.length; i++) {
      this.ram[i] = code[i];
    }
    // Keep the bump heap above the reserved low-memory area even for tiny programs.
    setInitialHeapBreak(this.ram, code.length);
  }

  clear() { this.ram.fill(0); }

  registerDevice(baseAddress, device) {
    this.ioDevices.set(baseAddress & 0xFFF0, device);
  }

  onWrite(callback) { this.onWriteCallback = callback; }
};
