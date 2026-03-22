// ============================================================
// NexaOS Emulator Worker
// Self-contained: includes CPU, Memory, and all I/O devices.
// Runs in a Web Worker context — no DOM access.
//
// The individual source modules live in js/core/ for editing:
//   cpu.js, memory.js, devices.js
// This file combines them for the worker's isolated scope.
// ============================================================

// ============================================================
// CPU — 16-bit Nexa-16 RISC processor
// ============================================================

var FAULT_FETCH = 16;
var FAULT_LOAD = 17;
var FAULT_STORE = 18;
var FAULT_STACK = 19;
var FAULT_PRIVILEGE = 20;
var FAULT_IO = 21;

var CPU = class {
  constructor(memory) {
    this.memory = memory;

    // General-purpose registers
    this.A = 0;
    this.D = 0;
    this.B = 0;
    this.SP = 0;
    this.PC = 0;

    // Control registers
    this.STATUS = 0;   // [15..4: reserved][3: MODE][2: IE][1: N][0: Z]
    this.EPC = 0;
    this.CAUSE = 0;
    this.BASE = 0;
    this.LIMIT = 65535;
    this.KSP = 0;

    // Execution state
    this.halted = false;
    this.doubleFault = false;
    this.cycleCount = 0;
    this.activeMode = false;  // false=kernel, true=user
    this.flagN = false;
    this.flagZ = false;
    this.inFaultHandler = false;
  }

  get ie() { return !!(this.STATUS & 4); }
  get mode() { return this.activeMode; }

  reset() {
    this.A = 0; this.D = 0; this.B = 0;
    this.SP = 0; this.KSP = 0; this.PC = 0;
    this.STATUS = 0; this.EPC = 0; this.CAUSE = 0;
    this.BASE = 0; this.LIMIT = 65535;
    this.flagN = false; this.flagZ = false;
    this.halted = false; this.doubleFault = false;
    this.inFaultHandler = false; this.cycleCount = 0;
    this.activeMode = false;
  }

  step() {
    if (this.halted) return false;
    this.checkInterrupts();
    var fetchResult = this.translate(this.PC, 'fetch');
    if (fetchResult === null) return true;
    var instruction = this.memory.read(fetchResult);
    this.PC = (this.PC + 1) & 0xFFFF;
    this.execute(instruction);
    this.cycleCount++;
    return !this.halted;
  }

  runFast(maxCycles) {
    if (this.halted) return 0;
    var ram = this.memory.ram;
    var A = this.A, D = this.D, B = this.B, SP = this.SP, PC = this.PC;
    var fN = this.flagN, fZ = this.flagZ;
    var cycles = 0;
    var isUser = this.activeMode;
    var BASE = this.BASE, LIMIT = this.LIMIT;

    // Service any pending interrupts before entering the hot loop
    if (this.STATUS & 4) {
      this.checkInterrupts();
      if (this.halted) return 0;
      A = this.A; D = this.D; B = this.B; SP = this.SP; PC = this.PC;
      fN = this.flagN; fZ = this.flagZ;
      isUser = this.activeMode;
      BASE = this.BASE; LIMIT = this.LIMIT;
    }

    var fault = 0;
    while (cycles < maxCycles) {
      // Fetch — with user mode address translation
      if (isUser && (PC >= LIMIT || PC >= 0xFF00)) {
        fault = PC >= 0xFF00 ? FAULT_IO : FAULT_FETCH;
        break;
      }
      var instr = isUser ? ram[(BASE + PC) & 0xFFFF] : ram[PC];
      PC = (PC + 1) & 0xFFFF;
      var op = (instr >> 12) & 0xF;

      switch (op) {
        case 0: { // LDI — does not update flags
          var dst = (instr >> 10) & 3;
          var val = (((instr & 0x3FF) ^ 0x200) - 0x200) & 0xFFFF;
          if (dst === 0) A = val; else if (dst === 1) D = val; else if (dst === 2) B = val; else SP = val;
          break;
        }
        case 1: { // LDU — does not update flags
          var dst = (instr >> 10) & 3;
          var imm6 = instr & 0x3F;
          var cur = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
          var res = (cur & 0x3FF) | ((imm6 & 0x3F) << 10);
          if (dst === 0) A = res; else if (dst === 1) D = res; else if (dst === 2) B = res; else SP = res;
          break;
        }
        case 2: case 3: case 4: case 5: { // ADD, SUB, AND, OR
          var dst = (instr >> 10) & 3;
          var src = (instr >> 8) & 3;
          var a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
          var b = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
          var r;
          if (op === 2) r = (a + b) & 0xFFFF;
          else if (op === 3) r = (a - b) & 0xFFFF;
          else if (op === 4) r = a & b;
          else r = a | b;
          if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
          fZ = r === 0; fN = !!(r & 0x8000);
          break;
        }
        case 6: { // ALU2 (NOT, SHL, ASR, MOV, XOR)
          var dst = (instr >> 10) & 3;
          var subOp = (instr >> 7) & 7;
          var src = (instr >> 5) & 3;
          var a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
          var r;
          switch (subOp) {
            case 0: r = ~a & 0xFFFF; break;
            case 1: r = (a << 1) & 0xFFFF; break;
            case 2: { var s = (a & 0x8000) ? (a | ~0xFFFF) : a; r = (s >> 1) & 0xFFFF; break; }
            case 3: r = (src === 0 ? A : src === 1 ? D : src === 2 ? B : SP) & 0xFFFF; break;
            case 4: { var sv = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP; r = (a ^ sv) & 0xFFFF; break; }
            default: r = 0;
          }
          if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
          fZ = r === 0; fN = !!(r & 0x8000);
          break;
        }
        case 7: { // LOAD
          var dst = (instr >> 10) & 3;
          var offset = ((instr & 0xFF) ^ 0x80) - 0x80;
          var vaddr = (A + offset) & 0xFFFF;
          var val;
          if (isUser) {
            if (vaddr >= 0xFF00) { fault = FAULT_IO; break; }
            if (vaddr >= LIMIT) { fault = FAULT_LOAD; break; }
            val = ram[(BASE + vaddr) & 0xFFFF];
          } else {
            val = vaddr >= 0xFF00 ? this.memory.read(vaddr) : ram[vaddr];
          }
          if (dst === 0) A = val; else if (dst === 1) D = val; else if (dst === 2) B = val; else SP = val;
          break;
        }
        case 8: { // STORE
          var src = (instr >> 10) & 3;
          var offset = ((instr & 0xFF) ^ 0x80) - 0x80;
          var vaddr = (A + offset) & 0xFFFF;
          var sv = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
          if (isUser) {
            if (vaddr >= 0xFF00) { fault = FAULT_IO; break; }
            if (vaddr >= LIMIT) { fault = FAULT_STORE; break; }
            ram[(BASE + vaddr) & 0xFFFF] = sv;
          } else {
            if (vaddr >= 0xFF00) this.memory.write(vaddr, sv); else ram[vaddr] = sv;
          }
          break;
        }
        case 9: { // BR
          var nzp = (instr >> 9) & 7;
          var offset = ((instr & 0x1FF) ^ 0x100) - 0x100;
          var n = (nzp & 4) ? fN : false;
          var z = (nzp & 2) ? fZ : false;
          var p = (nzp & 1) ? (!fN && !fZ) : false;
          if (n || z || p) PC = (PC + offset) & 0xFFFF;
          break;
        }
        case 10: PC = A & 0xFFFF; break; // JMP
        case 11: { // CALL
          SP = (SP - 1) & 0xFFFF;
          if (isUser) {
            if (SP >= 0xFF00) { fault = FAULT_IO; break; }
            if (SP >= LIMIT) { fault = FAULT_STACK; break; }
          }
          var pa = isUser ? (BASE + SP) & 0xFFFF : SP;
          if (pa >= 0xFF00) this.memory.write(pa, PC); else ram[pa] = PC;
          PC = A & 0xFFFF; break;
        }
        case 12: { // PUSH/POP
          var dir = (instr >> 11) & 1;
          var reg = (instr >> 9) & 3;
          if (dir === 0) { // PUSH
            var v = reg === 0 ? A : reg === 1 ? D : reg === 2 ? B : SP;
            SP = (SP - 1) & 0xFFFF;
            if (isUser) {
              if (SP >= 0xFF00) { fault = FAULT_IO; break; }
              if (SP >= LIMIT) { fault = FAULT_STACK; break; }
            }
            var pa = isUser ? (BASE + SP) & 0xFFFF : SP;
            if (pa >= 0xFF00) this.memory.write(pa, v); else ram[pa] = v;
          } else { // POP
            if (isUser) {
              if (SP >= 0xFF00) { fault = FAULT_IO; break; }
              if (SP >= LIMIT) { fault = FAULT_STACK; break; }
            }
            var pa = isUser ? (BASE + SP) & 0xFFFF : SP;
            var v = pa >= 0xFF00 ? this.memory.read(pa) : ram[pa];
            if (reg === 3) { SP = v; }
            else { if (reg === 0) A = v; else if (reg === 1) D = v; else B = v; SP = (SP + 1) & 0xFFFF; }
          }
          break;
        }
        case 13: // TRAP
        case 14: { // SYS — delegate to slow path
          this.A = A; this.D = D; this.B = B; this.SP = SP;
          this.PC = (PC - 1) & 0xFFFF;
          this.flagN = fN; this.flagZ = fZ;
          this.STATUS = (this.STATUS & ~3) | (fN ? 2 : 0) | (fZ ? 1 : 0);
          this.cycleCount += cycles;
          this.step();
          if (this.halted) return cycles + 1;
          // Check for pending interrupts if IE was (re-)enabled
          if (this.STATUS & 4) this.checkInterrupts();
          if (this.halted) return cycles + 1;
          // Reload all locals — mode, IE, BASE, LIMIT may have changed
          A = this.A; D = this.D; B = this.B; SP = this.SP; PC = this.PC;
          fN = this.flagN; fZ = this.flagZ;
          isUser = this.activeMode;
          BASE = this.BASE; LIMIT = this.LIMIT;
          cycles++; continue;
        }
        case 15: { // RET
          if (isUser) {
            if (SP >= 0xFF00) { fault = FAULT_IO; break; }
            if (SP >= LIMIT) { fault = FAULT_STACK; break; }
          }
          var pa = isUser ? (BASE + SP) & 0xFFFF : SP;
          var retAddr = pa >= 0xFF00 ? this.memory.read(pa) : ram[pa];
          PC = retAddr; SP = (SP + 1) & 0xFFFF; break;
        }
      }
      cycles++;
      if (fault) break;
    }

    // Flush local registers back to CPU state
    this.A = A; this.D = D; this.B = B; this.SP = SP; this.PC = PC;
    this.flagN = fN; this.flagZ = fZ;
    this.STATUS = (this.STATUS & ~3) | (fN ? 2 : 0) | (fZ ? 1 : 0);
    this.cycleCount += cycles;
    if (fault) this.raiseFault(fault);
    return cycles;
  }

  getState() {
    return {
      A: this.A & 0xFFFF, D: this.D & 0xFFFF, B: this.B & 0xFFFF,
      SP: this.SP & 0xFFFF, PC: this.PC & 0xFFFF, STATUS: this.STATUS & 0xFFFF,
      EPC: this.EPC & 0xFFFF, CAUSE: this.CAUSE & 0xFFFF,
      BASE: this.BASE & 0xFFFF, LIMIT: this.LIMIT & 0xFFFF, KSP: this.KSP & 0xFFFF,
      flagN: this.flagN, flagZ: this.flagZ, ie: this.ie, mode: this.mode,
      cycleCount: this.cycleCount
    };
  }

  translate(virtualAddr, accessType) {
    var addr = virtualAddr & 0xFFFF;
    if (!this.mode) return addr;
    if (addr >= 0xFF00) { this.raiseFault(FAULT_IO); return null; }
    if (addr >= this.LIMIT) {
      var faultMap = { fetch: FAULT_FETCH, load: FAULT_LOAD, store: FAULT_STORE, stack: FAULT_STACK };
      this.raiseFault(faultMap[accessType]);
      return null;
    }
    return (this.BASE + addr) & 0xFFFF;
  }

  raiseFault(cause) {
    if (this.inFaultHandler) { this.doubleFault = true; this.halted = true; return; }
    this.inFaultHandler = true;
    this.EPC = (this.PC - 1) & 0xFFFF;
    this.CAUSE = ((this.STATUS & 0xFF) << 8) | (cause & 0xFF);
    var wasUser = !!(this.STATUS & 8);
    this.STATUS = this.STATUS & ~0xC;
    this.activeMode = false;
    if (wasUser) { var tmp = this.SP; this.SP = this.KSP; this.KSP = tmp; }
    this.PC = 12;
  }

  checkInterrupts() {
    if (!this.ie) return;
    var pending = this.memory.read(0xFFF0);
    var mask = this.memory.read(0xFFF1);
    var active = pending & mask;
    if (active === 0) return;
    var irq = 0;
    for (var i = 0; i < 8; i++) { if (active & (1 << i)) { irq = i; break; } }
    this.EPC = this.PC;
    this.CAUSE = ((this.STATUS & 0xFF) << 8) | (irq & 0xFF);
    this.memory.write(0xFFF0, 1 << irq);
    var wasUser = !!(this.STATUS & 8);
    this.STATUS = this.STATUS & ~0xC;
    this.activeMode = false;
    if (wasUser) { var tmp = this.SP; this.SP = this.KSP; this.KSP = tmp; }
    this.PC = 4;
  }

  execute(instruction) {
    var opcode = (instruction >> 12) & 0xF;
    switch (opcode) {
      case 0: this.execLDI(instruction); break;
      case 1: this.execLDU(instruction); break;
      case 2: this.execALU(instruction, 'ADD'); break;
      case 3: this.execALU(instruction, 'SUB'); break;
      case 4: this.execALU(instruction, 'AND'); break;
      case 5: this.execALU(instruction, 'OR'); break;
      case 6: this.execALU2(instruction); break;
      case 7: this.execLOAD(instruction); break;
      case 8: this.execSTORE(instruction); break;
      case 9: this.execBR(instruction); break;
      case 10: this.execJMP(); break;
      case 11: this.execCALL(); break;
      case 12: this.execSTACK(instruction); break;
      case 13: this.execTRAP(instruction); break;
      case 14: this.execSYS(instruction); break;
      case 15: this.execRET(); break;
    }
  }

  readReg(idx) {
    switch (idx & 3) { case 0: return this.A & 0xFFFF; case 1: return this.D & 0xFFFF; case 2: return this.B & 0xFFFF; case 3: return this.SP & 0xFFFF; default: return 0; }
  }
  writeReg(idx, value) {
    var v = value & 0xFFFF;
    switch (idx & 3) { case 0: this.A = v; break; case 1: this.D = v; break; case 2: this.B = v; break; case 3: this.SP = v; break; }
  }
  updateFlags(value) {
    var v = value & 0xFFFF;
    this.flagZ = v === 0; this.flagN = !!(v & 0x8000);
    this.STATUS = (this.STATUS & ~3) | (this.flagN ? 2 : 0) | (this.flagZ ? 1 : 0);
  }
  signExtend(value, bits) {
    var mask = 1 << (bits - 1);
    var val = value & ((1 << bits) - 1);
    return (val ^ mask) - mask;
  }

  execLDI(instr) {
    this.writeReg((instr >> 10) & 3, this.signExtend(instr & 0x3FF, 10) & 0xFFFF);
  }
  execLDU(instr) {
    var dst = (instr >> 10) & 3;
    var result = (this.readReg(dst) & 0x3FF) | ((instr & 0x3F) << 10);
    this.writeReg(dst, result);
  }
  execALU(instr, op) {
    var dst = (instr >> 10) & 3, src = (instr >> 8) & 3;
    var a = this.readReg(dst), b = this.readReg(src), result;
    switch (op) {
      case 'ADD': result = (a + b) & 0xFFFF; break;
      case 'SUB': result = (a - b) & 0xFFFF; break;
      case 'AND': result = a & b; break;
      case 'OR':  result = a | b; break;
      default: result = 0;
    }
    this.writeReg(dst, result); this.updateFlags(result);
  }
  execALU2(instr) {
    var dst = (instr >> 10) & 3, subOp = (instr >> 7) & 7, src = (instr >> 5) & 3;
    var a = this.readReg(dst), result;
    switch (subOp) {
      case 0: result = ~a & 0xFFFF; break;
      case 1: result = (a << 1) & 0xFFFF; break;
      case 2: { var s = (a & 0x8000) ? (a | ~0xFFFF) : a; result = (s >> 1) & 0xFFFF; break; }
      case 3: result = this.readReg(src) & 0xFFFF; break;
      case 4: result = (a ^ this.readReg(src)) & 0xFFFF; break;
      default: result = 0;
    }
    this.writeReg(dst, result); this.updateFlags(result);
  }
  execLOAD(instr) {
    var dst = (instr >> 10) & 3;
    var addr = (this.A + this.signExtend(instr & 0xFF, 8)) & 0xFFFF;
    var physAddr = this.translate(addr, 'load');
    if (physAddr !== null) this.writeReg(dst, this.memory.read(physAddr));
  }
  execSTORE(instr) {
    var src = (instr >> 10) & 3;
    var addr = (this.A + this.signExtend(instr & 0xFF, 8)) & 0xFFFF;
    var physAddr = this.translate(addr, 'store');
    if (physAddr !== null) this.memory.write(physAddr, this.readReg(src));
  }
  execBR(instr) {
    var nzp = (instr >> 9) & 7, offset = this.signExtend(instr & 0x1FF, 9);
    var n = (nzp & 4) ? this.flagN : false;
    var z = (nzp & 2) ? this.flagZ : false;
    var p = (nzp & 1) ? (!this.flagN && !this.flagZ) : false;
    if (n || z || p) this.PC = (this.PC + offset) & 0xFFFF;
  }
  execJMP() { this.PC = this.A & 0xFFFF; }
  execCALL() {
    this.SP = (this.SP - 1) & 0xFFFF;
    var physAddr = this.translate(this.SP, 'stack');
    if (physAddr === null) return;
    this.memory.write(physAddr, this.PC);
    this.PC = this.A & 0xFFFF;
  }
  execRET() {
    var physAddr = this.translate(this.SP, 'stack');
    if (physAddr === null) return;
    this.PC = this.memory.read(physAddr);
    this.SP = (this.SP + 1) & 0xFFFF;
  }
  execSTACK(instr) {
    var dir = (instr >> 11) & 1, reg = (instr >> 9) & 3;
    if (dir === 0) {
      var value = this.readReg(reg);
      this.SP = (this.SP - 1) & 0xFFFF;
      var physAddr = this.translate(this.SP, 'stack');
      if (physAddr !== null) this.memory.write(physAddr, value);
    } else {
      var physAddr = this.translate(this.SP, 'stack');
      if (physAddr === null) return;
      var value = this.memory.read(physAddr);
      if (reg === 3) { this.SP = value; }
      else { this.writeReg(reg, value); this.SP = (this.SP + 1) & 0xFFFF; }
    }
  }
  execTRAP(instr) {
    var trapNum = instr & 0xFFF;
    this.EPC = this.PC;
    this.CAUSE = trapNum;
    var wasUser = !!(this.STATUS & 8);
    this.STATUS = this.STATUS & ~0xC;
    this.activeMode = false;
    if (wasUser) { var tmp = this.SP; this.SP = this.KSP; this.KSP = tmp; }
    this.PC = 8;
  }
  execSYS(instr) {
    var subOp = (instr >> 8) & 0xF;
    if (this.mode) { this.raiseFault(FAULT_PRIVILEGE); return; }
    switch (subOp) {
      case 0: { // IRET — restores PC and mode; flags/IE must be restored manually via WRCTL STATUS before IRET
        var targetIsUser = !!(this.STATUS & 8);
        if (targetIsUser) { var tmp = this.SP; this.SP = this.KSP; this.KSP = tmp; }
        this.PC = this.EPC;
        this.activeMode = targetIsUser;
        this.inFaultHandler = false;
        break;
      }
      case 1: { // RDCTL
        this.writeReg((instr >> 6) & 3, this.readCtrlReg((instr >> 3) & 7));
        break;
      }
      case 2: { // WRCTL
        this.writeCtrlReg((instr >> 3) & 7, this.readReg((instr >> 6) & 3));
        break;
      }
      case 3: this.halted = true; break; // HALT
    }
  }

  readCtrlReg(idx) {
    switch (idx) {
      case 0: return this.STATUS & 0xFFFF;
      case 1: return this.EPC & 0xFFFF;
      case 2: return this.CAUSE & 0xFFFF;
      case 3: return this.BASE & 0xFFFF;
      case 4: return this.LIMIT & 0xFFFF;
      case 5: return this.KSP & 0xFFFF;
      default: return 0;
    }
  }
  writeCtrlReg(idx, value) {
    var v = value & 0xFFFF;
    switch (idx) {
      case 0:
        this.STATUS = v;
        this.flagN = !!(v & 2); this.flagZ = !!(v & 1);
        this.activeMode = !!(v & 8);
        break;
      case 1: this.EPC = v; break;
      case 2: this.CAUSE = v; break;
      case 3: this.BASE = v; break;
      case 4: this.LIMIT = v; break;
      case 5: this.KSP = v; break;
    }
  }
};

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
    // Keep the bump heap above the reserved low-memory area for tiny programs.
    setInitialHeapBreak(this.ram, code.length);
  }

  clear() { this.ram.fill(0); }

  registerDevice(baseAddress, device) {
    this.ioDevices.set(baseAddress & 0xFFF0, device);
  }

  onWrite(callback) { this.onWriteCallback = callback; }
};

// ============================================================
// I/O Devices
// ============================================================

var SECTOR_SIZE = 128;
var DISK_SECTORS = 256;

function loadExecProgramFromDisk(memory, cpu, disk, sectors, fileSize) {
  var destAddr = 0;
  for (var s = 0; s < sectors.length; s++) {
    var sector = sectors[s];
    if (sector < 0 || sector >= DISK_SECTORS) continue;
    var diskOffset = sector * SECTOR_SIZE;
    var remaining = fileSize - destAddr;
    var count = remaining < SECTOR_SIZE ? remaining : SECTOR_SIZE;
    if (count < 0) count = 0;
    for (var w = 0; w < count; w++) {
      memory.ram[destAddr + w] = disk.storage[diskOffset + w];
    }
    destAddr += SECTOR_SIZE;
  }
  setInitialHeapBreak(memory.ram, fileSize);
  cpu.PC = 0; cpu.SP = 0xEBF0;
  cpu.A = 0; cpu.D = 0; cpu.B = 0;
  cpu.halted = false; cpu.doubleFault = false;
  cpu.flagN = false; cpu.flagZ = false;
  cpu.STATUS = 0;
  cpu.activeMode = false;
  return true;
}

function uploadFileToDisk(disk, fileData, name, ext) {
  var FAT_OFF = 1 * SECTOR_SIZE;
  var DIR_OFF = 3 * SECTOR_SIZE;
  var dirIdx = -1;
  var freeIdx = -1;
  var oldChain = [];
  for (var ui = 0; ui < 16; ui++) {
    var doff = DIR_OFF + ui * 16;
    if (disk.storage[doff + 11] & 1) {
      var nameMatch = true;
      for (var nj = 0; nj < 8; nj++) if (disk.storage[doff + nj] !== name[nj]) nameMatch = false;
      for (var ej = 0; ej < 3; ej++) if (disk.storage[doff + 8 + ej] !== ext[ej]) nameMatch = false;
      if (nameMatch) {
        dirIdx = ui;
        var oldSec = disk.storage[doff + 12];
        var seen = new Set();
        while (oldSec > 0 && oldSec < 256 && !seen.has(oldSec)) {
          seen.add(oldSec);
          oldChain.push(oldSec);
          var nextSec = disk.storage[FAT_OFF + oldSec];
          if (nextSec === 0xFFFF || nextSec === 0 || nextSec === 0xFFFE) break;
          oldSec = nextSec;
        }
        break;
      }
    } else if (freeIdx < 0) {
      freeIdx = ui;
    }
  }
  if (dirIdx < 0) dirIdx = freeIdx;
  if (dirIdx < 0) return { ok: false, err: 'Directory full (max 16 files).' };

  var sectorsNeeded = Math.ceil(fileData.length / SECTOR_SIZE);
  if (sectorsNeeded === 0) sectorsNeeded = 1;
  var reusable = new Set(oldChain);
  var chosen = [];
  for (var fk = 5; fk < 256 && chosen.length < sectorsNeeded; fk++) {
    if (disk.storage[FAT_OFF + fk] === 0 || reusable.has(fk)) chosen.push(fk);
  }
  if (chosen.length < sectorsNeeded) {
    return { ok: false, err: 'Disk full.' };
  }

  for (var clearIdx = 0; clearIdx < oldChain.length; clearIdx++) {
    disk.storage[FAT_OFF + oldChain[clearIdx]] = 0;
  }

  for (var si = 0; si < chosen.length; si++) {
    var freeSec = chosen[si];
    disk.storage[FAT_OFF + freeSec] = si === chosen.length - 1 ? 0xFFFF : chosen[si + 1];
    var soff = freeSec * SECTOR_SIZE;
    var dOff2 = si * SECTOR_SIZE;
    for (var sw = 0; sw < SECTOR_SIZE; sw++) {
      disk.storage[soff + sw] = (dOff2 + sw < fileData.length) ? fileData[dOff2 + sw] : 0;
    }
  }

  var de = DIR_OFF + dirIdx * 16;
  for (var dnj = 0; dnj < 8; dnj++) disk.storage[de + dnj] = name[dnj];
  for (var dej = 0; dej < 3; dej++) disk.storage[de + 8 + dej] = ext[dej];
  disk.storage[de + 11] = 1;
  disk.storage[de + 12] = chosen[0];
  disk.storage[de + 13] = fileData.length;
  disk.storage[de + 14] = 0;
  disk.storage[de + 15] = 0;
  return { ok: true, size: fileData.length };
}

var DisplayController = class {
  constructor() {
    this.mode = 0;
    this.cursorPos = 0;
    this.onModeChange = null;
  }
  read(offset) {
    switch (offset) {
      case 0: return this.mode;
      case 1: return this.cursorPos;
      default: return 0;
    }
  }
  write(offset, value) {
    switch (offset) {
      case 0: this.mode = value & 1; if (this.onModeChange) this.onModeChange(this.mode); break;
      case 1: this.cursorPos = value & 0xFFFF; break;
    }
  }
  setModeChangeCallback(cb) { this.onModeChange = cb; }
  getMode() { return this.mode; }
  getCursorPos() { return this.cursorPos; }
};

var Keyboard = class {
  constructor() {
    this.status = 0;
    this.data = 0;
    this.pendingInterrupt = false;
  }
  read(offset) {
    switch (offset) {
      case 0: return this.status;
      case 1: { var val = this.data; this.status = 0; return val; }
      default: return 0;
    }
  }
  write() {}
  keyDown(ascii) {
    this.data = ascii & 255;
    this.status = 1;
    this.pendingInterrupt = true;
  }
  hasPendingInterrupt() {
    if (this.pendingInterrupt) { this.pendingInterrupt = false; return true; }
    return false;
  }
};

var SystemControl = class {
  constructor() {
    this.pending = 0;
    this.mask = 0;
  }
  read(offset) {
    switch (offset) {
      case 0: return this.pending;
      case 1: return this.mask;
      default: return 0;
    }
  }
  write(offset, value) {
    switch (offset) {
      case 0: this.pending &= ~(value & 0xFFFF); break;
      case 1: this.mask = value & 0xFFFF; break;
    }
  }
  setInterrupt(bit)   { this.pending |= 1 << bit; }
  clearInterrupt(bit) { this.pending &= ~(1 << bit); }
  hasActiveInterrupt() { return (this.pending & this.mask) !== 0; }
  getPending() { return this.pending; }
  getMask()    { return this.mask; }
};

var Timer = class {
  constructor() {
    this.control = 0;
    this.interval = 0;
    this.counter = 0;
    this.pendingInterrupt = false;
    this.msLow = 0;
    this.msHigh = 0;
    this.msResidue = 0;
  }
  get enabled() { return !!(this.control & 1); }
  read(offset) {
    switch (offset) {
      case 0: return this.control;
      case 1: return this.interval;
      case 2: return this.counter & 0xFFFF;
      case 3: return this.msLow & 0xFFFF;
      case 4: return this.msHigh & 0xFFFF;
      default: return 0;
    }
  }
  write(offset, value) {
    switch (offset) {
      case 0: this.control = value & 1; if (!this.enabled) this.counter = 0; break;
      case 1: this.interval = value & 0xFFFF; this.counter = 0; break;
    }
  }
  advance(cycles, cyclesPerSecond) {
    if (cycles <= 0) return false;
    var hz = cyclesPerSecond || 25000000;
    var totalMs = this.msResidue + cycles * 1000;
    var msAdvanced = Math.floor(totalMs / hz);
    this.msResidue = totalMs % hz;
    if (msAdvanced > 0) {
      var combined = (this.msHigh << 16) + this.msLow + msAdvanced;
      this.msLow = combined & 0xFFFF;
      this.msHigh = combined >>> 16 & 0xFFFF;
    }
    if (!this.enabled || this.interval === 0) return false;
    var total = this.counter + cycles;
    if (total >= this.interval) {
      this.counter = total % this.interval;
      this.pendingInterrupt = true;
      return true;
    }
    this.counter = total;
    return false;
  }
  tick(cyclesPerSecond) {
    return this.advance(1, cyclesPerSecond);
  }
  hasPendingInterrupt() {
    if (this.pendingInterrupt) { this.pendingInterrupt = false; return true; }
    return false;
  }
};

var UART = class {
  constructor() {
    this.txStatus = 1;
    this.rxStatus = 0;
    this.rxData = 0;
    this.pendingTxInterrupt = false;
    this.pendingRxInterrupt = false;
    this.onOutput = null;
  }
  read(offset) {
    switch (offset) {
      case 0: return this.txStatus;
      case 1: return 0;
      case 2: return this.rxStatus;
      case 3: { var val = this.rxData; this.rxStatus = 0; return val; }
      default: return 0;
    }
  }
  write(offset, value) {
    switch (offset) {
      case 1:
        if (this.onOutput) this.onOutput(value & 255);
        this.txStatus = 1;
        this.pendingTxInterrupt = true;
        break;
    }
  }
  receive(ascii) {
    this.rxData = ascii & 255;
    this.rxStatus = 1;
    this.pendingRxInterrupt = true;
  }
  setOutputCallback(cb) { this.onOutput = cb; }
  hasPendingRxInterrupt() {
    if (this.pendingRxInterrupt) { this.pendingRxInterrupt = false; return true; }
    return false;
  }
  hasPendingTxInterrupt() {
    if (this.pendingTxInterrupt) { this.pendingTxInterrupt = false; return true; }
    return false;
  }
};

var DiskController = class {
  constructor() {
    this.command = 0;
    this.sector = 0;
    this.memAddr = 0;
    this.status = 0;
    this.pendingInterrupt = false;
    this.storage = new Uint16Array(DISK_SECTORS * SECTOR_SIZE);
    this.dmaRead = null;
    this.dmaWrite = null;
  }
  read(offset) {
    switch (offset) {
      case 0: return this.command;
      case 1: return this.sector;
      case 2: return this.memAddr;
      case 3: return this.status;
      default: return 0;
    }
  }
  write(offset, value) {
    switch (offset) {
      case 0: this.command = value & 3; if (this.command > 0) this.executeCommand(); break;
      case 1: this.sector = value & 255; break;
      case 2: this.memAddr = value & 0xFFFF; break;
    }
  }
  setDMA(read, write) { this.dmaRead = read; this.dmaWrite = write; }
  executeCommand() {
    if (this.sector >= DISK_SECTORS) { this.status = 4; this.command = 0; return; }
    var endAddr = this.memAddr + SECTOR_SIZE - 1;
    if (this.memAddr >= 0xFF00 || endAddr >= 0xFF00) { this.status = 4; this.command = 0; return; }
    this.status = 1;
    var diskOffset = this.sector * SECTOR_SIZE;
    if (this.command === 1 && this.dmaWrite) {
      for (var i = 0; i < SECTOR_SIZE; i++) this.dmaWrite(this.memAddr + i, this.storage[diskOffset + i]);
    } else if (this.command === 2 && this.dmaRead) {
      for (var i = 0; i < SECTOR_SIZE; i++) this.storage[diskOffset + i] = this.dmaRead(this.memAddr + i);
    }
    this.status = 2; this.command = 0; this.pendingInterrupt = true;
  }
  hasPendingInterrupt() {
    if (this.pendingInterrupt) { this.pendingInterrupt = false; return true; }
    return false;
  }
};

// Sound device — forwards writes to main thread for Web Audio playback
var SoundDevice = class {
  constructor() { this.regs = [0, 0, 0, 0, 0, 0, 0, 0]; }
  read(offset) { return (offset >= 0 && offset < 8) ? this.regs[offset] : 0; }
  write(offset, value) {
    if (offset < 0 || offset >= 8) return;
    this.regs[offset] = value & 0xFFFF;
    self.postMessage({t: 'snd', o: offset, v: value & 0xFFFF});
  }
};

// ============================================================
// Worker runtime — init, run loop, message handler
// ============================================================

var cpu, memory, display, keyboard, system, timer, uart, disk, soundDev;
var wRunning = false;
var wSpeed = 50000;
var wTargetHz = 25000000;
var wCycleBudget = 0;
var wLastWallTime = 0;
var bpSet = new Set();
var snapTimer = null;
var uartBuf = '';

function resetPacing(now) {
  wCycleBudget = 0;
  wLastWallTime = now || performance.now();
}

function accrueCycleBudget(now) {
  if (!wLastWallTime) {
    wLastWallTime = now;
    return;
  }
  var elapsedMs = now - wLastWallTime;
  if (elapsedMs < 0) elapsedMs = 0;
  wLastWallTime = now;
  wCycleBudget += elapsedMs * wTargetHz / 1000;
  var maxBudget = wTargetHz * 0.25;
  if (wCycleBudget > maxBudget) wCycleBudget = maxBudget;
}

function schedNextDelay(delayMs) {
  setTimeout(runLoop, Math.max(1, delayMs | 0));
}

function initEmu() {
  memory = new Memory();
  cpu = new CPU(memory);
  display = new DisplayController();
  keyboard = new Keyboard();
  system = new SystemControl();
  timer = new Timer();
  uart = new UART();
  disk = new DiskController();
  soundDev = new SoundDevice();

  memory.registerDevice(0xFF00, keyboard);
  memory.registerDevice(0xFF10, timer);
  memory.registerDevice(0xFF20, uart);
  memory.registerDevice(0xFF30, display);
  memory.registerDevice(0xFF40, soundDev);
  memory.registerDevice(0xFF50, disk);
  memory.registerDevice(0xFFF0, system);

  display.setModeChangeCallback(function(mode) {
    self.postMessage({t: 'dm', mode: mode});
  });
  disk.setDMA(
    function(addr) { return memory.read(addr); },
    function(addr, val) { memory.write(addr, val); }
  );
  uart.setOutputCallback(function(ch) { uartBuf += String.fromCharCode(ch & 255); });
}

function resetDev() {
  display.write(0, 0); display.write(1, 0);
  system.pending = 0; system.mask = 0;
  timer.control = 0; timer.interval = 0; timer.counter = 0; timer.pendingInterrupt = false;
  timer.msLow = 0; timer.msHigh = 0; timer.msResidue = 0;
  keyboard.status = 0; keyboard.data = 0; keyboard.pendingInterrupt = false;
  uart.txStatus = 1; uart.rxStatus = 0; uart.rxData = 0;
  uart.pendingRxInterrupt = false; uart.pendingTxInterrupt = false;
  disk.command = 0; disk.sector = 0; disk.memAddr = 0; disk.status = 0; disk.pendingInterrupt = false;
}

function checkExecMagic() {
  if (memory.ram[0xEEFE] !== 0x4558) return false;
  var sectorCount = memory.ram[0xEE00];
  var fileSize = memory.ram[0xEEFF];
  if (sectorCount === 0 || sectorCount > 251) return false;
  var sectors = [];
  for (var s = 0; s < sectorCount; s++) sectors.push(memory.ram[0xEE01 + s]);
  loadExecProgramFromDisk(memory, cpu, disk, sectors, fileSize);
  memory.ram[0xEEFE] = 0;
  return true;
}

function svcBatch(cycles) {
  if (timer.advance(cycles, wTargetHz)) system.setInterrupt(0);
  if (keyboard.hasPendingInterrupt()) system.setInterrupt(1);
  if (uart.hasPendingRxInterrupt()) system.setInterrupt(2);
  if (uart.hasPendingTxInterrupt()) system.setInterrupt(3);
  if (disk.hasPendingInterrupt()) system.setInterrupt(4);
}

function svcCycle() {
  if (timer.tick(wTargetHz)) system.setInterrupt(0);
  if (keyboard.hasPendingInterrupt()) system.setInterrupt(1);
  if (uart.hasPendingRxInterrupt()) system.setInterrupt(2);
  if (uart.hasPendingTxInterrupt()) system.setInterrupt(3);
  if (disk.hasPendingInterrupt()) system.setInterrupt(4);
}

function sendSnap() {
  var fb = new Uint16Array(4800);
  fb.set(memory.ram.subarray(0xEC00, 0xEC00 + 4800));
  self.postMessage({
    t: 'snap',
    s: {
      A: cpu.A & 0xFFFF, D: cpu.D & 0xFFFF, B: cpu.B & 0xFFFF, SP: cpu.SP & 0xFFFF,
      PC: cpu.PC & 0xFFFF, STATUS: cpu.STATUS & 0xFFFF, EPC: cpu.EPC & 0xFFFF,
      CAUSE: cpu.CAUSE & 0xFFFF, BASE: cpu.BASE & 0xFFFF, LIMIT: cpu.LIMIT & 0xFFFF,
      KSP: cpu.KSP & 0xFFFF, flagN: cpu.flagN, flagZ: cpu.flagZ,
      ie: cpu.ie, mode: cpu.mode, cyc: cpu.cycleCount,
      halted: cpu.halted, df: cpu.doubleFault
    },
    fb: fb.buffer,
    dm: display.getMode(),
    u: uartBuf,
    r: wRunning,
    ks: keyboard.status,
    us: uart.rxStatus
  }, [fb.buffer]);
  uartBuf = '';
}

// Zero-delay scheduling via MessageChannel (avoids setTimeout's ~4ms minimum)
var schedCh = new MessageChannel();
schedCh.port1.onmessage = function() { runLoop(); };
function schedNext() { schedCh.port2.postMessage(0); }

function runLoop() {
  if (!wRunning || cpu.halted) {
    if (cpu.halted && checkExecMagic()) {
      resetPacing(performance.now());
      wRunning = true; startSnaps(); schedNext();
      return;
    }
    wRunning = false;
    sendSnap();
    self.postMessage({t: 'stop', reason: cpu.halted ? 'halted' : 'paused'});
    return;
  }
  var t0 = performance.now();
  accrueCycleBudget(t0);
  if (wCycleBudget < 1) {
    schedNextDelay(1);
    return;
  }
  var cycleAllowance = Math.min(wSpeed, Math.max(1, Math.floor(wCycleBudget)));
  var executed = 0;
  var hasBP = bpSet.size > 0;

  if (hasBP) {
    while (executed < cycleAllowance && !cpu.halted && wRunning) {
      if (bpSet.has(cpu.PC)) {
        wRunning = false; sendSnap();
        self.postMessage({t: 'stop', reason: 'bp', pc: cpu.PC});
        return;
      }
      var chunk = Math.min(cycleAllowance - executed, 4096);
      var ran = cpu.runFast(chunk);
      if (ran <= 0) break;
      svcBatch(ran); executed += ran;
      if (bpSet.has(cpu.PC)) {
        wRunning = false; sendSnap();
        self.postMessage({t: 'stop', reason: 'bp', pc: cpu.PC});
        return;
      }
      if (performance.now() - t0 > 12) break;
    }
  } else {
    while (executed < cycleAllowance && !cpu.halted && wRunning) {
      var chunk = Math.min(cycleAllowance - executed, 8192);
      var ran = cpu.runFast(chunk);
      if (ran <= 0) break;
      svcBatch(ran); executed += ran;
      if (performance.now() - t0 > 12) break;
    }
  }

  wCycleBudget -= executed;
  if (wCycleBudget < 0) wCycleBudget = 0;

  if (cpu.halted) {
    if (checkExecMagic()) { schedNext(); return; }
    wRunning = false; sendSnap();
    self.postMessage({t: 'stop', reason: 'halted'});
    return;
  }
  if (wRunning) schedNext();
}

function startSnaps() { if (!snapTimer) snapTimer = setInterval(sendSnap, 33); }
function stopSnaps()  { if (snapTimer) { clearInterval(snapTimer); snapTimer = null; } }

initEmu();

self.onmessage = function(e) {
  var msg = e.data;
  switch (msg.t) {
    case 'load':
      wRunning = false; stopSnaps();
      resetPacing(performance.now());
      memory.clear(); resetDev(); cpu.reset(); uartBuf = '';
      memory.loadProgram(new Uint16Array(msg.code));
      sendSnap();
      break;
    case 'run':
      if (msg.speed) wSpeed = msg.speed;
      resetPacing(performance.now());
      wRunning = true; startSnaps(); runLoop();
      break;
    case 'pause':
      resetPacing(performance.now());
      wRunning = false; stopSnaps(); sendSnap();
      break;
    case 'step': {
      var count = msg.n || 1;
      for (var i = 0; i < count; i++) {
        if (cpu.halted) break;
        if (bpSet.has(cpu.PC) && i > 0) break;
        cpu.step(); svcCycle();
      }
      sendSnap();
      break;
    }
    case 'reset':
      wRunning = false; stopSnaps();
      resetPacing(performance.now());
      memory.clear(); resetDev(); cpu.reset(); uartBuf = '';
      if (msg.code) memory.loadProgram(new Uint16Array(msg.code));
      sendSnap();
      break;
    case 'bp':
      bpSet = new Set(msg.a);
      break;
    case 'spd':
      wSpeed = msg.v || 50000;
      break;
    case 'key':
      if (keyboard.status === 0) keyboard.keyDown(msg.a);
      break;
    case 'mem': {
      var start = msg.start & 0xFFFF;
      var len = msg.len || 128;
      var data = new Uint16Array(len);
      for (var j = 0; j < len; j++) data[j] = memory.read((start + j) & 0xFFFF);
      self.postMessage({t: 'memp', start: start, len: len, data: data.buffer, rid: msg.rid}, [data.buffer]);
      break;
    }
    case 'upload': {
      var fileData = new Uint16Array(msg.data);
      if (disk.storage[0] !== 0x4844) {
        self.postMessage({t: 'uploadResult', ok: false, err: 'Disk not formatted. Boot NexaOS and type FORMAT first.'});
        break;
      }
      var uploadResult = uploadFileToDisk(disk, fileData, msg.name, msg.ext);
      if (!uploadResult.ok) {
        self.postMessage({t: 'uploadResult', ok: false, err: uploadResult.err});
        break;
      }
      // Reset disk controller state so next DMA reads fresh data
      disk.command = 0; disk.status = 0;
      self.postMessage({t: 'uploadResult', ok: true, size: uploadResult.size});
      break;
    }
  }
};

sendSnap();
