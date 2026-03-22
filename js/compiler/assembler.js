// Nexa ASM
var REGISTERS = { "A": 0, "D": 1, "B": 2, "SP": 3 };
var CONTROL_REGISTERS = {
  "STATUS": 0,
  "EPC": 1,
  "CAUSE": 2,
  "BASE": 3,
  "LIMIT": 4,
  "KSP": 5
};
var OPCODES = {
  "LDI": 0,
  "LDU": 1,
  "ADD": 2,
  "SUB": 3,
  "AND": 4,
  "OR": 5,
  "ALU2": 6,
  "LOAD": 7,
  "STORE": 8,
  "BR": 9,
  "JMP": 10,
  "CALL": 11,
  "STACK": 12,
  "TRAP": 13,
  "SYS": 14,
  "RET": 15
};
var ALU2_SUB_OPS = {
  "NOT": 0,
  "SHL": 1,
  "ASR": 2,
  "MOV": 3,
  "XOR": 4
};
var SYS_SUB_OPS = {
  "IRET": 0,
  "RDCTL": 1,
  "WRCTL": 2,
  "HALT": 3
};
var BR_CONDITIONS = {
  "BRN": 4,
  "BRZ": 2,
  "BRP": 1,
  "BRNZ": 6,
  "BRNP": 5,
  "BRZP": 3,
  "BRA": 7,
  "BRNZP": 7
};
var Assembler = class {
  constructor() {
    this.symbols = {};
    this.symbolKinds = {};
    this.warnings = [];
    this.errors = [];
    this.output = [];
    this.sourceMap = {};
    this.listing = [];
    this.symbolSummary = { labels: [], equates: [], total: 0 };
    this.currentAddress = 0;
    this.lines = [];
    this.pass = 0;
  }
  assemble(source) {
    this.symbols = {};
    this.symbolKinds = {};
    this.warnings = [];
    this.errors = [];
    this.output = [];
    this.sourceMap = {};
    this.listing = [];
    this.symbolSummary = { labels: [], equates: [], total: 0 };
    this.currentAddress = 0;
    this.lines = source.split("\n").map((line, idx) => {
      let cleaned = line.replace(/\r$/, "");
      // Only strip comments if not a .STRING directive
      if (!/^\s*([\w.$]+:\s*)?\.string\s+"/i.test(cleaned)) {
        cleaned = cleaned.replace(/;.*/, "").replace(/\/\/.*/, "");
      } else {
        // For .STRING lines, only strip comments AFTER the closing quote
        const strDirectiveMatch = cleaned.match(/^(.*\.string\s+"(?:[^"\\]|\\.)*")(.*)/i);
        if (strDirectiveMatch) {
          cleaned = strDirectiveMatch[1] + strDirectiveMatch[2].replace(/;.*/, "").replace(/\/\/.*/, "");
        }
      }
      return { num: idx + 1, raw: line, text: cleaned.trim() };
    });
    this.pass = 1;
    this.runPass();
    this.pass = 2;
    this.currentAddress = 0;
    this.output = [];
    this.runPass();
    let maxAddr = this.output.length - 1;
    for (const k of Object.keys(this.sourceMap)) {
      const n = Number(k);
      if (n > maxAddr) maxAddr = n;
    }
    if (maxAddr < 0) maxAddr = 0;
    const code = new Uint16Array(maxAddr + 1);
    for (const [addr, word] of Object.entries(this.output)) {
      code[Number(addr)] = word;
    }
    const labelsByAddr = {};
    for (const [name, addr] of Object.entries(this.symbols)) {
      if (this.symbolKinds[name] !== "label") continue;
      const key = Number(addr);
      if (!labelsByAddr[key]) labelsByAddr[key] = [];
      labelsByAddr[key].push(name);
    }
    this.symbolSummary = this.buildSymbolSummary();
    this.listing = [];
    for (let addr = 0; addr < code.length; addr++) {
      const sourceEntry = this.sourceMap[addr] || null;
      this.listing.push({
        address: addr,
        word: code[addr],
        labels: labelsByAddr[addr] || [],
        line: sourceEntry ? sourceEntry.line : null,
        source: sourceEntry ? sourceEntry.source : ""
      });
    }
    return {
      success: this.errors.length === 0,
      code,
      errors: [...this.errors],
      warnings: [...this.warnings],
      listing: this.listing.map((entry) => ({ ...entry, labels: [...entry.labels] })),
      sourceMap: { ...this.sourceMap },
      symbols: { ...this.symbols },
      symbolKinds: { ...this.symbolKinds },
      symbolSummary: {
        labels: this.symbolSummary.labels.map((entry) => ({ ...entry })),
        equates: this.symbolSummary.equates.map((entry) => ({ ...entry })),
        total: this.symbolSummary.total
      }
    };
  }
  // ============================================================
  // Internal: Run a single pass
  // ============================================================
  runPass() {
    this.currentAddress = 0;
    for (const line of this.lines) {
      if (line.text === "") continue;
      let text = line.text;
      const labelMatch = text.match(/^([\w.$]+):\s*(.*)/);
      if (labelMatch) {
        const label = labelMatch[1];
        if (this.pass === 1) {
          this.defineSymbol(label, this.currentAddress, "label", line.num, "Duplikat label");
        }
        text = labelMatch[2].trim();
        if (text === "") continue;
      }
      this.parseLine(text, line.num, line.raw);
    }
  }
  // ============================================================
  // Line parser
  // ============================================================
  parseLine(text, lineNum, rawSource) {
    const parts = this.tokenize(text);
    if (parts.length === 0) return;
    const mnemonic = parts[0].toUpperCase();
    if (mnemonic === ".ORG") {
      const addr = this.parseImmediate(parts[1], lineNum);
      if (addr !== null) this.currentAddress = addr & 65535;
      return;
    }
    if (mnemonic === ".WORD") {
      for (let i = 1; i < parts.length; i++) {
        if (this.pass === 2) {
          const val = this.parseImmediate(parts[i], lineNum);
          this.emit(val !== null ? val & 65535 : 0, lineNum, rawSource);
        } else {
          this.currentAddress++;
        }
      }
      return;
    }
    if (mnemonic === ".STRING") {
      const strMatch = text.match(/\.string\s+"((?:[^"\\]|\\.)*)"/i);
      if (!strMatch) {
        this.addError(lineNum, `Ugyldig .string-direktiv`);
        return;
      }
      const raw = strMatch[1];
      let str = "";
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === "\\" && i + 1 < raw.length) {
          switch (raw[i + 1]) {
            case "n":
              str += "\n";
              i++;
              break;
            case "t":
              str += "	";
              i++;
              break;
            case "0":
              str += "\0";
              i++;
              break;
            case "\\":
              str += "\\";
              i++;
              break;
            case '"':
              str += '"';
              i++;
              break;
            default:
              str += raw[i];
          }
        } else {
          str += raw[i];
        }
      }
      if (this.pass === 2) {
        for (const ch of str) this.emit(ch.charCodeAt(0), lineNum, rawSource);
        this.emit(0, lineNum, rawSource);
      } else {
        this.currentAddress += str.length + 1;
      }
      return;
    }
    if (mnemonic === ".EQU") {
      if (parts.length < 3) {
        this.addError(lineNum, `.equ krever NAVN og verdi`);
        return;
      }
      const val = this.parseImmediate(parts[2], lineNum);
      if (this.pass === 1 && val !== null) {
        this.defineSymbol(parts[1], val & 65535, "equ", lineNum, "Duplikat symbol i .equ");
      }
      return;
    }
    if (this.tryPseudo(mnemonic, parts, lineNum, rawSource)) return;
    this.assembleInstruction(mnemonic, parts, lineNum, rawSource);
  }
  // ============================================================
  // Pseudo-instructions
  // ============================================================
  tryPseudo(mnemonic, parts, lineNum, rawSource) {
    switch (mnemonic) {
      case "NOP":
        this.emitWord(this.encodeBR(0, 0), lineNum, rawSource);
        return true;
      case "LDA": {
        const reg = this.parseReg(parts[1], lineNum);
        const val = this.parseImmediate(parts[2], lineNum);
        if (reg === null || val === null) {
          if (this.pass === 2) {
            this.emitWord(0, lineNum, rawSource);
            this.emitWord(0, lineNum, rawSource);
          } else {
            this.currentAddress += 2;
          }
          return true;
        }
        const val16 = val & 65535;
        this.emitWord(this.encodeLDI(reg, val16 & 1023), lineNum, rawSource);
        this.emitWord(this.encodeLDU(reg, val16 >> 10 & 63), lineNum, rawSource);
        return true;
      }
      case "CMP": {
        const r1 = this.parseReg(parts[1], lineNum);
        const r2 = this.parseReg(parts[2], lineNum);
        if (this.pass === 2 && r1 !== null && r2 !== null) {
          if (r2 === REGISTERS["A"]) {
            // r2 is A: can't MOV A,r1 then SUB A,A (destroys A's value).
            // Instead: PUSH r1, SUB r1,A, POP r1
            this.emitWord(this.encodeStack(0, r1), lineNum, rawSource);
            this.emitWord(this.encodeR(OPCODES["SUB"], r1, REGISTERS["A"]), lineNum, rawSource);
            this.emitWord(this.encodeStack(1, r1), lineNum, rawSource);
          } else {
            this.emitWord(this.encodeStack(0, REGISTERS["A"]), lineNum, rawSource);
            this.emitWord(this.encodeALU2("MOV", REGISTERS["A"], r1), lineNum, rawSource);
            this.emitWord(this.encodeR(OPCODES["SUB"], REGISTERS["A"], r2), lineNum, rawSource);
            this.emitWord(this.encodeStack(1, REGISTERS["A"]), lineNum, rawSource);
          }
        } else {
          this.currentAddress += (r2 === REGISTERS["A"]) ? 3 : 4;
        }
        return true;
      }
      case "CLR": {
        const reg = this.parseReg(parts[1], lineNum);
        this.emitWord(reg !== null ? this.encodeLDI(reg, 0) : 0, lineNum, rawSource);
        return true;
      }
      case "INC": {
        const reg = this.parseReg(parts[1], lineNum);
        if (this.pass === 2 && reg !== null) {
          var tmp = reg === REGISTERS["B"] ? REGISTERS["A"] : REGISTERS["B"];
          this.emitWord(this.encodeStack(0, tmp), lineNum, rawSource);
          this.emitWord(this.encodeLDI(tmp, 1), lineNum, rawSource);
          this.emitWord(this.encodeR(OPCODES["ADD"], reg, tmp), lineNum, rawSource);
          this.emitWord(this.encodeStack(1, tmp), lineNum, rawSource);
        } else {
          this.currentAddress += 4;
        }
        return true;
      }
      case "DEC": {
        const reg = this.parseReg(parts[1], lineNum);
        if (this.pass === 2 && reg !== null) {
          var tmp = reg === REGISTERS["B"] ? REGISTERS["A"] : REGISTERS["B"];
          this.emitWord(this.encodeStack(0, tmp), lineNum, rawSource);
          this.emitWord(this.encodeLDI(tmp, 1), lineNum, rawSource);
          this.emitWord(this.encodeR(OPCODES["SUB"], reg, tmp), lineNum, rawSource);
          this.emitWord(this.encodeStack(1, tmp), lineNum, rawSource);
        } else {
          this.currentAddress += 4;
        }
        return true;
      }
      case "NEG": {
        const reg = this.parseReg(parts[1], lineNum);
        if (this.pass === 2 && reg !== null) {
          this.emitWord(this.encodeALU2("NOT", reg, 0), lineNum, rawSource);
          this.emitWord(this.encodeStack(0, REGISTERS["B"]), lineNum, rawSource);
          this.emitWord(this.encodeLDI(REGISTERS["B"], 1), lineNum, rawSource);
          this.emitWord(this.encodeR(OPCODES["ADD"], reg, REGISTERS["B"]), lineNum, rawSource);
          this.emitWord(this.encodeStack(1, REGISTERS["B"]), lineNum, rawSource);
        } else {
          this.currentAddress += 5;
        }
        return true;
      }
      case "BRA": {
        const offset = this.parseOffset(parts[1], lineNum, 9);
        if (this.pass === 2) {
          this.emitWord(this.encodeBR(7, offset ?? 0), lineNum, rawSource);
        } else {
          this.currentAddress++;
        }
        return true;
      }
      case "TST": {
        const reg = this.parseReg(parts[1], lineNum);
        if (this.pass === 2 && reg !== null) {
          this.emitWord(this.encodeStack(0, REGISTERS["A"]), lineNum, rawSource);
          this.emitWord(this.encodeALU2("MOV", REGISTERS["A"], reg), lineNum, rawSource);
          this.emitWord(this.encodeStack(1, REGISTERS["A"]), lineNum, rawSource);
        } else {
          this.currentAddress += 3;
        }
        return true;
      }
      default:
        if (mnemonic in BR_CONDITIONS) {
          const offset = this.parseOffset(parts[1], lineNum, 9);
          if (this.pass === 2) {
            this.emitWord(this.encodeBR(BR_CONDITIONS[mnemonic], offset ?? 0), lineNum, rawSource);
          } else {
            this.currentAddress++;
          }
          return true;
        }
        return false;
    }
  }
  // ============================================================
  // Real instruction assembly
  // ============================================================
  assembleInstruction(mnemonic, parts, lineNum, rawSource) {
    let word = 0;
    switch (mnemonic) {
      case "LDI": {
        const reg = this.parseReg(parts[1], lineNum);
        const imm = this.parseImmediate(parts[2], lineNum);
        if (reg !== null && imm !== null) {
          this.checkRange(imm, -512, 511, lineNum, "LDI imm10");
          word = this.encodeLDI(reg, imm & 1023);
        }
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "LDU": {
        const reg = this.parseReg(parts[1], lineNum);
        const imm = this.parseImmediate(parts[2], lineNum);
        if (reg !== null && imm !== null) {
          this.checkRange(imm, 0, 63, lineNum, "LDU imm6");
          word = this.encodeLDU(reg, imm & 63);
        }
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "ADD":
      case "SUB":
      case "AND":
      case "OR": {
        const dst = this.parseReg(parts[1], lineNum);
        const src = this.parseReg(parts[2], lineNum);
        if (dst !== null && src !== null) word = this.encodeR(OPCODES[mnemonic], dst, src);
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "NOT":
      case "SHL":
      case "ASR": {
        const dst = this.parseReg(parts[1], lineNum);
        if (dst !== null) word = this.encodeALU2(mnemonic, dst, 0);
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "MOV":
      case "XOR": {
        const dst = this.parseReg(parts[1], lineNum);
        const src = this.parseReg(parts[2], lineNum);
        if (dst !== null && src !== null) word = this.encodeALU2(mnemonic, dst, src);
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "LOAD": {
        const dst = this.parseReg(parts[1], lineNum);
        const off = this.parseMemoryOperand(parts.slice(2).join(" "), lineNum);
        if (dst !== null && off !== null) {
          this.checkRange(off, -128, 127, lineNum, "LOAD offset8");
          word = (OPCODES["LOAD"] << 12) | (dst << 10) | (off & 255);
        }
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "STORE": {
        const src = this.parseReg(parts[1], lineNum);
        const off = this.parseMemoryOperand(parts.slice(2).join(" "), lineNum);
        if (src !== null && off !== null) {
          this.checkRange(off, -128, 127, lineNum, "STORE offset8");
          word = (OPCODES["STORE"] << 12) | (src << 10) | (off & 255);
        }
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "BR": {
        const cond = this.parseBRCondBits(parts[1], lineNum);
        const off = this.parseOffset(parts[2], lineNum, 9);
        if (cond !== null && off !== null) word = this.encodeBR(cond, off);
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "JMP": {
        this.emitWord(OPCODES["JMP"] << 12, lineNum, rawSource);
        break;
      }
      case "CALL": {
        this.emitWord(OPCODES["CALL"] << 12, lineNum, rawSource);
        break;
      }
      case "RET": {
        this.emitWord(OPCODES["RET"] << 12, lineNum, rawSource);
        break;
      }
      case "PUSH": {
        const reg = this.parseReg(parts[1], lineNum);
        if (reg !== null) word = this.encodeStack(0, reg);
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "POP": {
        const reg = this.parseReg(parts[1], lineNum);
        if (reg !== null) word = this.encodeStack(1, reg);
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "TRAP": {
        const imm = this.parseImmediate(parts[1], lineNum);
        if (imm !== null) {
          this.checkRange(imm, 0, 4095, lineNum, "TRAP imm12");
          word = OPCODES["TRAP"] << 12 | imm & 4095;
        }
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "IRET": {
        this.emitWord(OPCODES["SYS"] << 12 | SYS_SUB_OPS["IRET"] << 8, lineNum, rawSource);
        break;
      }
      case "HALT": {
        this.emitWord(OPCODES["SYS"] << 12 | SYS_SUB_OPS["HALT"] << 8, lineNum, rawSource);
        break;
      }
      case "RDCTL": {
        const dst = this.parseReg(parts[1], lineNum);
        const cr = this.parseCtrlReg(parts[2], lineNum);
        if (dst !== null && cr !== null) word = OPCODES["SYS"] << 12 | SYS_SUB_OPS["RDCTL"] << 8 | dst << 6 | cr << 3;
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      case "WRCTL": {
        const cr = this.parseCtrlReg(parts[1], lineNum);
        const src = this.parseReg(parts[2], lineNum);
        if (cr !== null && src !== null) word = OPCODES["SYS"] << 12 | SYS_SUB_OPS["WRCTL"] << 8 | src << 6 | cr << 3;
        this.emitWord(word, lineNum, rawSource);
        break;
      }
      default:
        this.addError(lineNum, `Ukjent instruksjon: '${mnemonic}'`);
    }
  }
  // ============================================================
  // Encoding helpers
  // ============================================================
  encodeLDI(reg, imm10) {
    return OPCODES["LDI"] << 12 | reg << 10 | imm10 & 1023;
  }
  encodeLDU(reg, imm6) {
    return OPCODES["LDU"] << 12 | reg << 10 | imm6 & 63;
  }
  encodeR(opcode, dst, src) {
    return opcode << 12 | dst << 10 | src << 8;
  }
  encodeALU2(op, dst, src) {
    return OPCODES["ALU2"] << 12 | dst << 10 | ALU2_SUB_OPS[op] << 7 | src << 5;
  }
  encodeBR(nzp, offset9) {
    return OPCODES["BR"] << 12 | (nzp & 7) << 9 | offset9 & 511;
  }
  encodeStack(dir, reg) {
    return OPCODES["STACK"] << 12 | dir << 11 | reg << 9;
  }
  // ============================================================
  // Parsing helpers
  // ============================================================
  tokenize(text) {
    return text.split(/[,\s]+/).filter((t) => t.length > 0);
  }
  parseReg(token, lineNum) {
    if (!token) {
      if (this.pass === 2) this.addError(lineNum, "Mangler register");
      return null;
    }
    const upper = token.toUpperCase();
    if (upper in REGISTERS) return REGISTERS[upper];
    if (this.pass === 2) this.addError(lineNum, `Ukjent register: '${token}'`);
    return null;
  }
  parseCtrlReg(token, lineNum) {
    if (!token) {
      if (this.pass === 2) this.addError(lineNum, "Mangler kontrollregister");
      return null;
    }
    const upper = token.toUpperCase();
    if (upper in CONTROL_REGISTERS) return CONTROL_REGISTERS[upper];
    if (this.pass === 2) this.addError(lineNum, `Ukjent kontrollregister: '${token}'`);
    return null;
  }
  parseImmediate(token, lineNum) {
    if (!token) {
      if (this.pass === 2) this.addError(lineNum, "Mangler umiddelbar verdi");
      return null;
    }
    const val = this.parseNumber(token);
    if (val !== null) return val;
    const sym = token.replace(/,/g, "");
    if (sym in this.symbols) return this.symbols[sym];
    if (this.pass === 2) {
      if (this.isSymbolToken(sym)) this.addError(lineNum, this.formatUnknownSymbolMessage(sym));
      else this.addError(lineNum, `Ugyldig umiddelbar verdi: '${token}'`);
    }
    return null;
  }
  parseNumber(token) {
    const clean = token.replace(/,/g, "");
    if (/^0x[0-9a-fA-F]+$/i.test(clean)) return parseInt(clean, 16);
    if (/^0b[01]+$/i.test(clean)) return parseInt(clean.slice(2), 2);
    if (/^-?\d+$/.test(clean)) return parseInt(clean, 10);
    return null;
  }
  parseMemoryOperand(text, lineNum) {
    const match = text.match(/\[\s*A\s*([+\-])\s*([\w.$]+)\s*\]/i);
    if (match) {
      const sign = match[1] === "-" ? -1 : 1;
      const val = this.parseImmediate(match[2], lineNum);
      return val !== null ? sign * val : null;
    }
    if (/\[\s*A\s*\]/i.test(text)) return 0;
    if (this.pass === 2) this.addError(lineNum, `Ugyldig minneoperand: '${text}'`);
    return null;
  }
  parseOffset(token, lineNum, bits) {
    if (!token) {
      if (this.pass === 2) this.addError(lineNum, "Mangler offset");
      return null;
    }
    const sym = token.replace(/,/g, "");
    if (Object.prototype.hasOwnProperty.call(this.symbols, sym)) {
      const offset = this.symbols[sym] - (this.currentAddress + 1);
      const max = (1 << bits - 1) - 1;
      const min = -(1 << bits - 1);
      if (offset < min || offset > max) {
        if (this.pass === 2) this.addError(lineNum, `Offset utenfor rekkevidde: ${offset} (${min}..${max})`);
        return null;
      }
      this.warnIfOffsetNearLimit(offset, min, max, lineNum, sym);
      return offset & (1 << bits) - 1;
    }
    const val = this.parseNumber(token);
    if (val !== null) {
      const max = (1 << bits - 1) - 1;
      const min = -(1 << bits - 1);
      if (val < min || val > max) {
        if (this.pass === 2) this.addError(lineNum, `Numerisk offset ${val} utenfor rekkevidde (${min}..${max})`);
        return val & (1 << bits) - 1;
      }
      this.warnIfOffsetNearLimit(val, min, max, lineNum, null);
      return val & (1 << bits) - 1;
    }
    if (this.pass === 2) {
      if (this.isSymbolToken(sym)) this.addError(lineNum, this.formatUnknownSymbolMessage(sym, "offset"));
      else this.addError(lineNum, `Ukjent offset: '${token}'`);
    }
    return null;
  }
  parseBRCondBits(token, lineNum) {
    if (!token) {
      if (this.pass === 2) this.addError(lineNum, "Mangler BR-betingelse");
      return null;
    }
    const val = this.parseNumber(token);
    if (val !== null && val >= 0 && val <= 7) return val;
    if (this.pass === 2) this.addError(lineNum, `Ugyldig BR-betingelse: '${token}'`);
    return null;
  }
  // ============================================================
  // Emit & utility
  // ============================================================
  emitWord(word, lineNum, rawSource) {
    if (this.pass === 2) {
      this.emit(word & 65535, lineNum, rawSource);
    } else {
      this.currentAddress++;
    }
  }
  emit(word, lineNum, rawSource) {
    this.output[this.currentAddress] = word & 65535;
    this.sourceMap[this.currentAddress] = { line: lineNum, source: rawSource };
    this.currentAddress++;
  }
  defineSymbol(name, value, kind, lineNum, duplicatePrefix) {
    if (Object.prototype.hasOwnProperty.call(this.symbols, name)) {
      this.addError(lineNum, `${duplicatePrefix}: '${name}'`);
      return;
    }
    this.symbols[name] = value;
    this.symbolKinds[name] = kind;
  }
  buildSymbolSummary() {
    const labels = [];
    const equates = [];
    for (const [name, value] of Object.entries(this.symbols)) {
      const entry = { name, value: value & 65535 };
      if (this.symbolKinds[name] === "equ") equates.push(entry);
      else labels.push(entry);
    }
    labels.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
    equates.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
    return { labels, equates, total: labels.length + equates.length };
  }
  isSymbolToken(token) {
    return /^[A-Za-z_.$][\w.$]*$/.test(token);
  }
  findSimilarSymbol(token) {
    const lower = token.toLowerCase();
    const names = Object.keys(this.symbols);
    for (const name of names) {
      const candidate = name.toLowerCase();
      if (candidate.startsWith(lower) || lower.startsWith(candidate)) return name;
    }
    for (const name of names) {
      const candidate = name.toLowerCase();
      if (candidate.includes(lower) || lower.includes(candidate)) return name;
    }
    return null;
  }
  formatUnknownSymbolMessage(token, context) {
    const similar = this.findSimilarSymbol(token);
    const suffix = similar ? ` Did you mean '${similar}'?` : "";
    return `Ukjent ${context || "symbol"}: '${token}'.${suffix}`;
  }
  warnIfOffsetNearLimit(offset, min, max, lineNum, symbolName) {
    if (this.pass !== 2) return;
    const margin = 8;
    if (offset > max || offset < min) return;
    if (offset >= max - margin || offset <= min + margin) {
      const target = symbolName ? ` for '${symbolName}'` : "";
      this.addWarning(lineNum, `Offset ${offset}${target} er n\u00e6r kodingsgrensen (${min}..${max})`);
    }
  }
  addError(lineNum, msg) {
    const err = `Linje ${lineNum}: ${msg}`;
    if (!this.errors.includes(err)) this.errors.push(err);
  }
  addWarning(lineNum, msg) {
    const warning = `Linje ${lineNum}: ${msg}`;
    if (!this.warnings.includes(warning)) this.warnings.push(warning);
  }
  checkRange(val, min, max, lineNum, desc) {
    if (val < min || val > max) {
      this.addError(lineNum, `Verdi ${val} utenfor rekkevidde for ${desc} (${min}..${max})`);
    }
  }
};
