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

  // ============================================================
  // Public API
  // ============================================================

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
    const fetchResult = this.translate(this.PC, 'fetch');
    if (fetchResult === null) return true;
    const instruction = this.memory.read(fetchResult);
    this.PC = (this.PC + 1) & 0xFFFF;
    this.execute(instruction);
    this.cycleCount++;
    return !this.halted;
  }

  /**
   * High-performance batch execution.
   * Inlines fetch-decode-execute with registers in locals and direct RAM access.
   * Falls back to step() for privileged/interrupt operations.
   */
  runFast(maxCycles) {
    if (this.halted) return 0;
    const ram = this.memory.ram;
    let A = this.A, D = this.D, B = this.B, SP = this.SP, PC = this.PC;
    let fN = this.flagN, fZ = this.flagZ;
    let cycles = 0;
    let isUser = this.activeMode;
    let BASE = this.BASE, LIMIT = this.LIMIT;

    // Service any pending interrupts before entering the hot loop
    if (this.STATUS & 4) {
      this.checkInterrupts();
      if (this.halted) return 0;
      A = this.A; D = this.D; B = this.B; SP = this.SP; PC = this.PC;
      fN = this.flagN; fZ = this.flagZ;
      isUser = this.activeMode;
      BASE = this.BASE; LIMIT = this.LIMIT;
    }

    let fault = 0;
    while (cycles < maxCycles) {
      // Fetch — with user mode address translation
      if (isUser && (PC >= LIMIT || PC >= 0xFF00)) {
        fault = PC >= 0xFF00 ? FAULT_IO : FAULT_FETCH;
        break;
      }
      const instr = isUser ? ram[(BASE + PC) & 0xFFFF] : ram[PC];
      PC = (PC + 1) & 0xFFFF;
      const op = (instr >> 12) & 0xF;

      switch (op) {
        case 0: { // LDI — does not update flags
          const dst = (instr >> 10) & 3;
          const val = (((instr & 0x3FF) ^ 0x200) - 0x200) & 0xFFFF;
          if (dst === 0) A = val; else if (dst === 1) D = val; else if (dst === 2) B = val; else SP = val;
          break;
        }
        case 1: { // LDU — does not update flags
          const dst = (instr >> 10) & 3;
          const imm6 = instr & 0x3F;
          let cur = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
          const res = (cur & 0x3FF) | ((imm6 & 0x3F) << 10);
          if (dst === 0) A = res; else if (dst === 1) D = res; else if (dst === 2) B = res; else SP = res;
          break;
        }
        case 2: case 3: case 4: case 5: { // ADD, SUB, AND, OR
          const dst = (instr >> 10) & 3;
          const src = (instr >> 8) & 3;
          let a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
          let b = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
          let r;
          if (op === 2) r = (a + b) & 0xFFFF;
          else if (op === 3) r = (a - b) & 0xFFFF;
          else if (op === 4) r = a & b;
          else r = a | b;
          if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
          fZ = r === 0; fN = !!(r & 0x8000);
          break;
        }
        case 6: { // ALU2 (NOT, SHL, ASR, MOV, XOR)
          const dst = (instr >> 10) & 3;
          const subOp = (instr >> 7) & 7;
          const src = (instr >> 5) & 3;
          let a = dst === 0 ? A : dst === 1 ? D : dst === 2 ? B : SP;
          let r;
          switch (subOp) {
            case 0: r = ~a & 0xFFFF; break;
            case 1: r = (a << 1) & 0xFFFF; break;
            case 2: { const s = (a & 0x8000) ? (a | ~0xFFFF) : a; r = (s >> 1) & 0xFFFF; break; }
            case 3: r = (src === 0 ? A : src === 1 ? D : src === 2 ? B : SP) & 0xFFFF; break;
            case 4: { const sv = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP; r = (a ^ sv) & 0xFFFF; break; }
            default: r = 0;
          }
          if (dst === 0) A = r; else if (dst === 1) D = r; else if (dst === 2) B = r; else SP = r;
          fZ = r === 0; fN = !!(r & 0x8000);
          break;
        }
        case 7: { // LOAD
          const dst = (instr >> 10) & 3;
          const offset = ((instr & 0xFF) ^ 0x80) - 0x80;
          const vaddr = (A + offset) & 0xFFFF;
          let val;
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
          const src = (instr >> 10) & 3;
          const offset = ((instr & 0xFF) ^ 0x80) - 0x80;
          const vaddr = (A + offset) & 0xFFFF;
          const sv = src === 0 ? A : src === 1 ? D : src === 2 ? B : SP;
          if (isUser) {
            if (vaddr >= 0xFF00) { fault = FAULT_IO; break; }
            if (vaddr >= LIMIT) { fault = FAULT_STORE; break; }
            ram[(BASE + vaddr) & 0xFFFF] = sv;
          } else {
            if (vaddr >= 0xFF00) this.memory.write(vaddr, sv); else ram[vaddr] = sv & 0xFFFF;
          }
          break;
        }
        case 9: { // BR
          const nzp = (instr >> 9) & 7;
          const offset = ((instr & 0x1FF) ^ 0x100) - 0x100;
          const n = (nzp & 4) ? fN : false;
          const z = (nzp & 2) ? fZ : false;
          const p = (nzp & 1) ? (!fN && !fZ) : false;
          if (n || z || p) PC = (PC + offset) & 0xFFFF;
          break;
        }
        case 10: PC = A & 0xFFFF; break; // JMP
        case 11: { // CALL
          // Compute new SP first; only commit if no fault (matches FPGA)
          const callNewSP = (SP - 1) & 0xFFFF;
          if (isUser) {
            if (callNewSP >= 0xFF00) { fault = FAULT_IO; break; }
            if (callNewSP >= LIMIT) { fault = FAULT_STACK; break; }
          }
          SP = callNewSP;
          const pa = isUser ? (BASE + SP) & 0xFFFF : SP;
          if (pa >= 0xFF00) this.memory.write(pa, PC); else ram[pa] = PC;
          PC = A & 0xFFFF; break;
        }
        case 12: { // PUSH/POP
          const dir = (instr >> 11) & 1;
          const reg = (instr >> 9) & 3;
          if (dir === 0) { // PUSH
            const v = reg === 0 ? A : reg === 1 ? D : reg === 2 ? B : SP;
            // Compute new SP first; only commit if no fault (matches FPGA)
            const pushNewSP = (SP - 1) & 0xFFFF;
            if (isUser) {
              if (pushNewSP >= 0xFF00) { fault = FAULT_IO; break; }
              if (pushNewSP >= LIMIT) { fault = FAULT_STACK; break; }
            }
            SP = pushNewSP;
            const pa = isUser ? (BASE + SP) & 0xFFFF : SP;
            if (pa >= 0xFF00) this.memory.write(pa, v); else ram[pa] = v;
          } else { // POP
            if (isUser) {
              if (SP >= 0xFF00) { fault = FAULT_IO; break; }
              if (SP >= LIMIT) { fault = FAULT_STACK; break; }
            }
            const pa = isUser ? (BASE + SP) & 0xFFFF : SP;
            const v = pa >= 0xFF00 ? this.memory.read(pa) : ram[pa];
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
          if (this.STATUS & 4) this.checkInterrupts();
          if (this.halted) return cycles + 1;
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
          const pa = isUser ? (BASE + SP) & 0xFFFF : SP;
          const retAddr = pa >= 0xFF00 ? this.memory.read(pa) : ram[pa];
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

  // ============================================================
  // Address translation & memory protection
  // ============================================================

  translate(virtualAddr, accessType) {
    const addr = virtualAddr & 0xFFFF;
    if (!this.mode) return addr;
    if (addr >= 0xFF00) { this.raiseFault(FAULT_IO); return null; }
    if (addr >= this.LIMIT) {
      var faultMap = { fetch: FAULT_FETCH, load: FAULT_LOAD, store: FAULT_STORE, stack: FAULT_STACK };
      this.raiseFault(faultMap[accessType]);
      return null;
    }
    return (this.BASE + addr) & 0xFFFF;
  }

  // ============================================================
  // Fault system
  // ============================================================

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

  // ============================================================
  // Interrupt system
  // ============================================================

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

  // ============================================================
  // Instruction execution (slow path — used for privileged ops)
  // ============================================================

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

  // --- Register helpers ---
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

  // --- Instruction implementations ---
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
    // Compute new SP first; only commit if translation succeeds
    // (matches FPGA: reg_SP <= sp_new only on success path)
    var newSP = (this.SP - 1) & 0xFFFF;
    var physAddr = this.translate(newSP, 'stack');
    if (physAddr === null) return;
    this.SP = newSP;
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
      // Compute new SP first; only commit if translation succeeds
      // (matches FPGA: reg_SP <= sp_new only on success path)
      var pushNewSP = (this.SP - 1) & 0xFFFF;
      var physAddr = this.translate(pushNewSP, 'stack');
      if (physAddr !== null) { this.SP = pushNewSP; this.memory.write(physAddr, value); }
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
      case 3: { // HALT
        this.halted = true;
        break;
      }
    }
  }

  // ============================================================
  // Control register access
  // ============================================================

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
