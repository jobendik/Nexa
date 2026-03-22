// Instruction disassembler (mirrors CPU.disassemble from the worker)
function disassembleInstruction(instruction) {
  const opcode = instruction >> 12 & 15;
  const regNames = ["A", "D", "B", "SP"];
  const ctrlRegNames = ["STATUS", "EPC", "CAUSE", "BASE", "LIMIT", "KSP"];
  const dst = instruction >> 10 & 3;
  const src8 = instruction >> 8 & 3;
  const signExtend = (val, bits) => {
    const mask = 1 << (bits - 1);
    const v = val & ((1 << bits) - 1);
    return (v ^ mask) - mask;
  };
  switch (opcode) {
    case 0: return `LDI ${regNames[dst]}, ${signExtend(instruction & 1023, 10)}`;
    case 1: return `LDU ${regNames[dst]}, ${instruction & 63}`;
    case 2: return `ADD ${regNames[dst]}, ${regNames[src8]}`;
    case 3: return `SUB ${regNames[dst]}, ${regNames[src8]}`;
    case 4: return `AND ${regNames[dst]}, ${regNames[src8]}`;
    case 5: return `OR ${regNames[dst]}, ${regNames[src8]}`;
    case 6: {
      const subOp = instruction >> 7 & 7;
      const src5 = instruction >> 5 & 3;
      const ops = ["NOT", "SHL", "ASR", "MOV", "XOR"];
      if (subOp < 3) return `${ops[subOp]} ${regNames[dst]}`;
      if (subOp < 5) return `${ops[subOp]} ${regNames[dst]}, ${regNames[src5]}`;
      return `ALU2 ???`;
    }
    case 7: return `LOAD ${regNames[dst]}, [A+${signExtend(instruction & 255, 8)}]`;
    case 8: return `STORE ${regNames[dst]}, [A+${signExtend(instruction & 255, 8)}]`;
    case 9: {
      const nzp = instruction >> 9 & 7;
      const off9 = signExtend(instruction & 511, 9);
      if (nzp === 0) return "NOP";
      const conds = { 1: "BRP", 2: "BRZ", 3: "BRZP", 4: "BRN", 5: "BRNP", 6: "BRNZ", 7: "BRA" };
      return `${conds[nzp] || "BR"} ${off9}`;
    }
    case 10: return "JMP";
    case 11: return "CALL";
    case 12: {
      const dir = instruction >> 11 & 1;
      const reg = instruction >> 9 & 3;
      return `${dir ? "POP" : "PUSH"} ${regNames[reg]}`;
    }
    case 13: return `TRAP ${instruction & 4095}`;
    case 14: {
      const subOp2 = instruction >> 8 & 15;
      if (subOp2 === 0) return "IRET";
      if (subOp2 === 3) return "HALT";
      if (subOp2 === 1) {
        const d = instruction >> 6 & 3;
        const cr = instruction >> 3 & 7;
        return `RDCTL ${regNames[d]}, ${ctrlRegNames[cr] || "???"}`;
      }
      if (subOp2 === 2) {
        const s = instruction >> 6 & 3;
        const cr = instruction >> 3 & 7;
        return `WRCTL ${ctrlRegNames[cr] || "???"}, ${regNames[s]}`;
      }
      return `SYS ???`;
    }
    case 15: return "RET";
    default: return "???";
  }
}

