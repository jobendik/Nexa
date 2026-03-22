// ============================================================
// nexa_cpu.sv — Nexa-16 CPU-kjerne
// Fasit: cpu.js (step, execute, runFast, raiseFault,
//        checkInterrupts, execXxx, readCtrlReg, writeCtrlReg)
//
// ARKITEKTUR:
//   2-fase FSM: FETCH → EXECUTE (de fleste instruksjoner)
//   3-fase:     FETCH → EXECUTE → MEMWAIT (LOAD, POP, RET)
//
// KRITISKE KORREKSJOENER vs original FPGA-kode:
//   1. PUSH: sp-- FØR skriving av verdi
//   2. POP SP (reg==3): SP=value, ingen SP++
//   3. TRAP: EPC = PC (post-increment = neste instr)
//   4. FAULT: EPC = (fetch_pc), CAUSE = (STATUS[7:0]<<8)|cause
//   5. raiseFault → PC = 0x000C
//   6. Interrupt: PC = 0x0004, EPC = PC
//   7. USER-mode adressetranslasjon
//   8. SYS fra user-mode → raiseFault(FAULT_PRIVILEGE)
//   9. WRCTL STATUS setter activeMode fra bit3
//  10. IRET: setter inFaultHandler=false, swap(SP,KSP) om user
// ============================================================
`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_cpu (
  input  logic        clk,
  input  logic        rst,

  // Instruksjonsminne (BRAM port A, les-bare)
  output logic [15:0] imem_addr,
  input  logic [15:0] imem_rdata,

  // Dataminne (BRAM port B, les/skriv)
  output logic [15:0] dmem_addr,
  output logic [15:0] dmem_wdata,
  output logic        dmem_we,
  output logic        dmem_re,
  input  logic [15:0] dmem_rdata,

  // I/O-grensesnitt (for adresser >= 0xFF00)
  output logic [15:0] io_addr,
  output logic [15:0] io_wdata,
  output logic        io_we,
  output logic        io_re,
  input  logic [15:0] io_rdata,
  input  logic        io_rdata_valid,

  // Interrupt-system (fra SystemControl-enheten)
  // Fasit cpu.js checkInterrupts():
  //   pending = mem[0xFFF0]; mask = mem[0xFFF1]; active = pending & mask
  input  logic [7:0]  irq_pending,
  input  logic [7:0]  irq_mask,

  // Debug-utganger
  output logic [15:0] dbg_pc,
  output logic [15:0] dbg_ir,
  output logic [15:0] dbg_reg_a,
  output logic [15:0] dbg_reg_d,
  output logic [15:0] dbg_reg_b,
  output logic [15:0] dbg_reg_sp,
  output logic [15:0] dbg_status,
  output logic        dbg_flag_n,
  output logic        dbg_flag_z,
  output logic        halted,
  output logic [15:0] dbg_cause
);

  // ─── Registre ───────────────────────────────────────────────
  logic [15:0] reg_A, reg_D, reg_B, reg_SP, reg_PC;

  // ─── Kontroll-registre ──────────────────────────────────────
  // STATUS[3]=MODE, [2]=IE, [1]=N, [0]=Z
  logic [15:0] cr_STATUS, cr_EPC, cr_CAUSE, cr_BASE, cr_LIMIT, cr_KSP;
  logic        flag_N, flag_Z;
  logic        activeMode;    // false=kernel, true=user (STATUS bit3)
  logic        inFaultHandler; // for double-fault deteksjon
  logic        doubleFault;

  // ─── Tilstandsmaskin ────────────────────────────────────────
  cpu_state_t  state;
  logic [15:0] IR;            // Instruksjons-register
  logic [15:0] fetch_pc;      // PC da fetch skjedde (for EPC ved fault)

  // ─── ALU ────────────────────────────────────────────────────
  // NOTE: nexa_alu.sv exists as a standalone combinational reference module
  // (useful for isolated testing/linting). The CPU does NOT instantiate it here
  // because execute_instr is an always_ff task that computes ALU results
  // synchronously using local variables. A combinational ALU instance would
  // require an extra pipeline stage or registered drive logic that adds
  // complexity without benefit in the current 2-phase FSM.
  // All ALU operations are implemented inline in execute_instr below.

  // ─── Register-les ────────────────────────────────────────────
  function automatic logic [15:0] read_reg(input logic [1:0] idx);
    case (idx)
      2'd0: return reg_A;
      2'd1: return reg_D;
      2'd2: return reg_B;
      2'd3: return reg_SP;
    endcase
  endfunction

  // ─── Adressetranslasjon ─────────────────────────────────────
  // Fasit cpu.js translate(vaddr, type):
  //   if kernel: return vaddr
  //   if vaddr >= 0xFF00: fault IO
  //   if vaddr >= LIMIT:  fault type
  //   return (BASE + vaddr) & 0xFFFF
  function automatic logic [15:0] translate(
    input logic [15:0] vaddr,
    input logic        is_user,
    input logic [15:0] base,
    input logic [15:0] limit
  );
    if (!is_user) return vaddr;
    return (base + vaddr) & 16'hFFFF;
  endfunction

  // ─── Fault-sjekk for adresse ────────────────────────────────
  function automatic logic needs_io_fault(
    input logic [15:0] vaddr,
    input logic        is_user
  );
    return is_user && (vaddr >= IO_BASE);
  endfunction

  function automatic logic needs_limit_fault(
    input logic [15:0] vaddr,
    input logic        is_user,
    input logic [15:0] limit
  );
    return is_user && (vaddr < IO_BASE) && (vaddr >= limit);
  endfunction

  // ─── Pending interrupt ──────────────────────────────────────
  logic [7:0] irq_active;
  logic [2:0] irq_num;

  assign irq_active = irq_pending & irq_mask;

  // Finn laveste satte bit — prioritert encoder (if-else, ingen constant-select)
  // Fasit cpu.js: for(i=0;i<8;i++) if(active&(1<<i)){irq=i;break;}
  always_comb begin
    if      ((irq_active & 8'h01) != 8'h0) irq_num = 3'd0;
    else if ((irq_active & 8'h02) != 8'h0) irq_num = 3'd1;
    else if ((irq_active & 8'h04) != 8'h0) irq_num = 3'd2;
    else if ((irq_active & 8'h08) != 8'h0) irq_num = 3'd3;
    else if ((irq_active & 8'h10) != 8'h0) irq_num = 3'd4;
    else if ((irq_active & 8'h20) != 8'h0) irq_num = 3'd5;
    else if ((irq_active & 8'h40) != 8'h0) irq_num = 3'd6;
    else if ((irq_active & 8'h80) != 8'h0) irq_num = 3'd7;
    else                                    irq_num = 3'd0;
  end

  // ─── Hoved-FSM ──────────────────────────────────────────────

  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      // Fasit cpu.js reset():
      reg_A  <= '0; reg_D <= '0; reg_B <= '0; reg_SP <= '0; reg_PC <= '0;
      cr_STATUS <= '0; cr_EPC <= '0; cr_CAUSE <= '0;
      cr_BASE   <= '0; cr_LIMIT <= 16'hFFFF; cr_KSP <= '0;
      flag_N    <= '0; flag_Z   <= '0;
      activeMode    <= '0;  // kernel
      inFaultHandler <= '0;
      doubleFault    <= '0;
      IR     <= '0;
      state  <= ST_FETCH;
      fetch_pc <= '0;

      // BRAM-kontroll
      imem_addr <= '0;
      dmem_addr <= '0; dmem_wdata <= '0; dmem_we <= '0; dmem_re <= '0;
      io_addr   <= '0; io_wdata   <= '0; io_we   <= '0; io_re   <= '0;

    end else begin

      // Standard: inaktiver skrive/les-signaler
      dmem_we <= '0; dmem_re <= '0;
      io_we   <= '0; io_re   <= '0;

      case (state)

        // ══════════════════════════════════════════════════════
        // FETCH — sjekk interrupts, presenter PC til BRAM
        // Fasit cpu.js step():
        //   checkInterrupts()  ← FØR fetch
        //   fetchResult = translate(PC, 'fetch')
        //   instr = memory.read(fetchResult)
        //   PC = (PC+1) & 0xFFFF
        //   execute(instruction)
        // ══════════════════════════════════════════════════════
        ST_FETCH: begin
          // ── Sjekk interrupts (fasit cpu.js checkInterrupts()) ──
          if (cr_STATUS[STATUS_IE] && (irq_active != 8'h00)) begin
            // Fasit:
            //   EPC = PC  (uinkrementert, dette er neste instruksjon)
            //   CAUSE = (STATUS[7:0] << 8) | irq
            //   mem[0xFFF0] = 1 << irq   (skrivingen er IO)
            //   wasUser = STATUS.bit3
            //   STATUS &= ~0xC  (clear MODE og IE)
            //   if wasUser: swap(SP, KSP)
            //   PC = 0x0004
            cr_EPC   <= reg_PC;
            cr_CAUSE <= {cr_STATUS[7:0], 5'h0, irq_num};
            // Bekrefter IRQ via I/O (skriv til 0xFFF0)
            io_addr   <= 16'hFFF0;
            io_wdata  <= {8'h0, (8'h1 << irq_num)};
            io_we     <= 1'b1;
            // Modus-skift til kernel
            if (cr_STATUS[STATUS_MODE]) begin  // wasUser
              // swap(SP, KSP)
              cr_KSP <= reg_SP;
              reg_SP <= cr_KSP;
            end
            cr_STATUS[STATUS_MODE] <= 1'b0;  // kernel
            cr_STATUS[STATUS_IE]   <= 1'b0;  // disable IE
            activeMode <= '0;
            reg_PC     <= VEC_INT;  // 0x0004
            // Gå til FETCH av handler
            imem_addr  <= VEC_INT;
            fetch_pc   <= VEC_INT;
            state      <= ST_FETCH;

          end else begin
            // ── Normal fetch ──
            // Fasit: translate(PC, 'fetch')
            // Kernel: paddr = PC; User: sjekk grenser, paddr = BASE+PC

            if (needs_io_fault(reg_PC, activeMode)) begin
              // PC >= 0xFF00 i user-mode → FAULT_IO
              do_raise_fault(FAULT_IO, reg_PC);
            end else if (needs_limit_fault(reg_PC, activeMode, cr_LIMIT)) begin
              // PC >= LIMIT i user-mode → FAULT_FETCH
              do_raise_fault(FAULT_FETCH, reg_PC);
            end else begin
              // Presenter fysisk adresse til BRAM
              imem_addr <= activeMode ? (cr_BASE + reg_PC) : reg_PC;
              fetch_pc  <= reg_PC;
              reg_PC    <= (reg_PC + 16'h1) & 16'hFFFF;
              state     <= ST_EXECUTE;
            end
          end
        end

        // ══════════════════════════════════════════════════════
        // EXECUTE — dekod og utfør instruksjon fra BRAM
        // IR er nå imem_rdata (BRAM leverer på EXECUTE-syklusen)
        // ══════════════════════════════════════════════════════
        ST_EXECUTE: begin
          IR <= imem_rdata;  // latch for debug
          execute_instr(imem_rdata);
        end

        // ══════════════════════════════════════════════════════
        // MEMWAIT — én ventesyklus for synkron BRAM-les
        // ══════════════════════════════════════════════════════
        ST_MEMWAIT: begin
          // nexa_ram oppdaterer b_rdata ved posedge etter at b_addr er satt.
          // Derfor må CPU-en vente én ekstra syklus før dmem_rdata samples.
          state <= ST_MEMREAD;
        end

        // ══════════════════════════════════════════════════════
        // MEMREAD — sample BRAM-data for LOAD, POP, RET
        // ══════════════════════════════════════════════════════
        ST_MEMREAD: begin
          finish_memread(IR, dmem_rdata);
          state <= ST_FETCH;
          if (IR[15:12] == 4'hF) begin
            imem_addr <= dmem_rdata;
          end else begin
            imem_addr <= reg_PC;
          end
        end

        // ══════════════════════════════════════════════════════
        // MEMIO — venter på I/O-les-svar
        // ══════════════════════════════════════════════════════
        ST_MEMIO: begin
          if (io_rdata_valid) begin
            finish_memread(IR, io_rdata);
            state <= ST_FETCH;
            if (IR[15:12] == 4'hF) begin
              imem_addr <= io_rdata;  // RET via IO
            end else begin
              imem_addr <= reg_PC;
            end
          end
        end

        ST_HALT: begin
          // Stopp — venter på reset
          state <= ST_HALT;
        end

        default: state <= ST_FETCH;

      endcase
    end
  end

  // ═══════════════════════════════════════════════════════════
  // execute_instr — implementerer alle instruksjoner
  // ═══════════════════════════════════════════════════════════
  task automatic execute_instr(input logic [15:0] instr);
    logic [3:0]  op;
    logic [1:0]  dst, src;
    logic [15:0] va, pa;
    logic [1:0]  reg_idx;
    logic [15:0] sp_new;
    logic [2:0]  subop;
    logic [2:0]  cr_idx;
    logic [3:0]  sys_sub;
    logic [2:0]  nzp;
    logic [15:0] offset;
    logic        branch_taken;
    logic        wasUser;

    op      = instr[15:12];
    dst     = instr[11:10];
    src     = instr[9:8];
    subop   = instr[9:7];
    sys_sub = instr[11:8];

    case (op)

      // ─── LDI — load sign-extended 10-bit immediate ─────────
      // Fasit: writeReg(dst, signExtend(instr & 0x3FF, 10))
      // NO FLAGS
      OP_LDI: begin
        write_reg(dst, ({{6{instr[9]}}, instr[9:0]}));
        to_fetch();
      end

      // ─── LDU — load upper 6 bits ────────────────────────────
      // Fasit: result = (readReg(dst) & 0x3FF) | ((instr & 0x3F) << 10)
      // NO FLAGS
      OP_LDU: begin
        write_reg(dst, (read_reg(dst) & 16'h03FF) | ({10'h0, instr[5:0]} << 10));
        to_fetch();
      end

      // ─── ADD, SUB, AND, OR ──────────────────────────────────
      // Fasit: result = op(readReg(dst), readReg(src)); updateFlags(result)
      OP_ADD, OP_SUB, OP_AND, OP_OR: begin
        // Beregn via task-nivå-variabel 'va' (gjenbrukes)
        case (op)
          4'd2: va = (read_reg(dst) + read_reg(src)) & 16'hFFFF;  // ADD
          4'd3: va = (read_reg(dst) - read_reg(src)) & 16'hFFFF;  // SUB
          4'd4: va = read_reg(dst) & read_reg(src);                // AND
          4'd5: va = read_reg(dst) | read_reg(src);                // OR
          default: va = 16'h0;
        endcase
        write_reg(dst, va);
        update_flags(va);
        to_fetch();
      end

      // ─── ALU2 — NOT, SHL, ASR, MOV, XOR ────────────────────
      // Fasit execALU2(): subop=(instr>>7)&7, src=(instr>>5)&3
      OP_ALU2: begin
        begin
          logic [15:0] a, r;
          logic [1:0]  src5;
          src5 = instr[6:5];
          a = read_reg(dst);
          case (instr[9:7])  // subop
            3'd0: r = ~a & 16'hFFFF;                    // NOT
            3'd1: r = (a << 1) & 16'hFFFF;              // SHL
            3'd2: r = {a[15], a[15:1]};                 // ASR (fasit korrekt)
            3'd3: r = read_reg(src5);                   // MOV
            3'd4: r = a ^ read_reg(src5);               // XOR
            default: r = 16'h0;
          endcase
          write_reg(dst, r);
          update_flags(r);
        end
        to_fetch();
      end

      // ─── LOAD dst, [A+off8] ─────────────────────────────────
      // Fasit execLOAD(): addr = (A + signExtend(off8, 8)) & 0xFFFF
      //   translate(addr, 'load') → physAddr
      //   writeReg(dst, memory.read(physAddr))
      OP_LOAD: begin
        va = (reg_A + ({{8{instr[7]}}, instr[7:0]})) & 16'hFFFF;

        if (needs_io_fault(va, activeMode)) begin
          do_raise_fault(FAULT_IO, fetch_pc);
        end else if (needs_limit_fault(va, activeMode, cr_LIMIT)) begin
          do_raise_fault(FAULT_LOAD, fetch_pc);
        end else begin
          pa = translate(va, activeMode, cr_BASE, cr_LIMIT);
          if (pa >= IO_BASE) begin
            // I/O-les
            io_addr <= pa;
            io_re   <= 1'b1;
            state   <= ST_MEMIO;
          end else begin
            // RAM-les (synkron BRAM, svar klar neste syklus)
            dmem_addr <= pa;
            dmem_re   <= 1'b1;
            state     <= ST_MEMWAIT;
          end
        end
      end

      // ─── STORE src, [A+off8] ────────────────────────────────
      // Fasit execSTORE(): addr = (A + signExtend(off8, 8)) & 0xFFFF
      //   translate(addr, 'store') → physAddr
      //   memory.write(physAddr, readReg(src))
      OP_STORE: begin
        va = (reg_A + ({{8{instr[7]}}, instr[7:0]})) & 16'hFFFF;

        if (needs_io_fault(va, activeMode)) begin
          do_raise_fault(FAULT_IO, fetch_pc);
        end else if (needs_limit_fault(va, activeMode, cr_LIMIT)) begin
          do_raise_fault(FAULT_STORE, fetch_pc);
        end else begin
          pa = translate(va, activeMode, cr_BASE, cr_LIMIT);
          if (pa >= IO_BASE) begin
            io_addr  <= pa;
            io_wdata <= read_reg(dst);  // NB: STORE bruker dst-feltet som src
            io_we    <= 1'b1;
          end else begin
            dmem_addr  <= pa;
            dmem_wdata <= read_reg(dst);
            dmem_we    <= 1'b1;
          end
        end
        to_fetch();
      end

      // ─── BR — betinget hopp ─────────────────────────────────
      // Fasit execBR():
      //   nzp = (instr >> 9) & 7; offset = signExtend(instr & 0x1FF, 9)
      //   n = (nzp & 4) && flagN; z = (nzp & 2) && flagZ
      //   p = (nzp & 1) && (!flagN && !flagZ)
      //   if(n||z||p) PC = (PC + offset) & 0xFFFF
      //   VIKTIG: PC er allerede inkrementert (peker til neste instr)
      OP_BR: begin
        nzp = instr[11:9];
        offset = ({{7{instr[8]}}, instr[8:0]});
        branch_taken = (
          ((nzp[2]) && flag_N) ||
          ((nzp[1]) && flag_Z) ||
          ((nzp[0]) && (!flag_N && !flag_Z))
        );
        if (branch_taken) begin
          va = (reg_PC + offset) & 16'hFFFF;  // va = branch target
          reg_PC    <= va;
          state     <= ST_FETCH;
          imem_addr <= va;  // MUST use computed target, not old reg_PC!
        end else begin
          to_fetch();  // not taken: imem_addr=reg_PC (already correct)
        end
      end

      // ─── JMP — hopp til A ────────────────────────────────────
      // Fasit execJMP(): PC = A & 0xFFFF
      OP_JMP: begin
        reg_PC    <= reg_A;
        state     <= ST_FETCH;
        imem_addr <= reg_A;  // target = A, not old reg_PC
      end

      // ─── CALL — subrutin-kall ────────────────────────────────
      // Fasit execCALL():
      //   SP = (SP - 1) & 0xFFFF
      //   physAddr = translate(SP, 'stack')
      //   memory.write(physAddr, PC)   ← PC er allerede PC+1 (returadresse)
      //   PC = A & 0xFFFF
      OP_CALL: begin
        sp_new = (reg_SP - 16'h1) & 16'hFFFF;

        if (needs_io_fault(sp_new, activeMode)) begin
          do_raise_fault(FAULT_IO, fetch_pc);
        end else if (needs_limit_fault(sp_new, activeMode, cr_LIMIT)) begin
          do_raise_fault(FAULT_STACK, fetch_pc);
        end else begin
          pa = translate(sp_new, activeMode, cr_BASE, cr_LIMIT);
          reg_SP <= sp_new;
          if (pa >= IO_BASE) begin
            io_addr  <= pa;
            io_wdata <= reg_PC;  // returnerer post-increment PC
            io_we    <= 1'b1;
          end else begin
            dmem_addr  <= pa;
            dmem_wdata <= reg_PC;
            dmem_we    <= 1'b1;
          end
          reg_PC    <= reg_A;
          state     <= ST_FETCH;
          imem_addr <= reg_A;  // target = A, not old reg_PC
        end
      end

      // ─── PUSH/POP ────────────────────────────────────────────
      // Fasit execSTACK():
      //   PUSH: value = readReg(reg); SP--; mem[SP] = value
      //   POP (reg!=SP): value=mem[SP]; writeReg(reg,value); SP++
      //   POP (reg==SP): SP = value  (INGEN SP++)
      OP_STACK: begin
        if (!instr[11]) begin
          // PUSH (dir=0)
          // Fasit: value = readReg(reg); SP = (SP-1)&0xFFFF; write(SP, value)
          // Reuse sp_new, pa, va for lokale verdier
          // va = register-verdi som skal pushes (erstatter pval)
          // instr[10:9] = register-indeks (erstatter preg)
          va = read_reg(instr[10:9]);  // pval = read_reg(preg)
          sp_new = (reg_SP - 16'h1) & 16'hFFFF;

          if (needs_io_fault(sp_new, activeMode)) begin
            do_raise_fault(FAULT_IO, fetch_pc);
          end else if (needs_limit_fault(sp_new, activeMode, cr_LIMIT)) begin
            do_raise_fault(FAULT_STACK, fetch_pc);
          end else begin
            pa = translate(sp_new, activeMode, cr_BASE, cr_LIMIT);
            reg_SP <= sp_new;
            if (pa >= IO_BASE) begin
              io_addr  <= pa; io_wdata <= va; io_we <= 1'b1;
            end else begin
              dmem_addr <= pa; dmem_wdata <= va; dmem_we <= 1'b1;
            end
            to_fetch();
          end

        end else begin
          // POP (dir=1)
          // Les fra SP, deretter skriv til register og (kanskje) SP++
          if (needs_io_fault(reg_SP, activeMode)) begin
            do_raise_fault(FAULT_IO, fetch_pc);
          end else if (needs_limit_fault(reg_SP, activeMode, cr_LIMIT)) begin
            do_raise_fault(FAULT_STACK, fetch_pc);
          end else begin
            pa = translate(reg_SP, activeMode, cr_BASE, cr_LIMIT);
            if (pa >= IO_BASE) begin
              io_addr <= pa; io_re <= 1'b1;
              state <= ST_MEMIO;
            end else begin
              dmem_addr <= pa; dmem_re  <= 1'b1;
              state <= ST_MEMWAIT;
            end
          end
        end
      end

      // ─── TRAP ────────────────────────────────────────────────
      // Fasit execTRAP():
      //   EPC = PC  (post-increment = adresse til neste instruksjon)
      //   CAUSE = imm12 & 0xFFF   (NB: IKKE (STATUS<<8)|cause slik som fault)
      //   wasUser = STATUS.bit3
      //   STATUS &= ~0xC   (clear MODE og IE, dvs bit3 og bit2)
      //   if wasUser: swap(SP, KSP)
      //   PC = 0x0008
      OP_TRAP: begin
        wasUser = cr_STATUS[STATUS_MODE];
        cr_EPC   <= reg_PC;              // post-increment PC
        cr_CAUSE <= {4'h0, instr[11:0]}; // imm12 direkte (IKKE fault-format)
        cr_STATUS[STATUS_MODE] <= 1'b0;
        cr_STATUS[STATUS_IE]   <= 1'b0;
        activeMode <= '0;
        if (wasUser) begin
          cr_KSP <= reg_SP;
          reg_SP <= cr_KSP;
        end
        reg_PC    <= VEC_TRAP;
        state     <= ST_FETCH;
        imem_addr <= VEC_TRAP;  // 0x0008, explicit target
      end

      // ─── SYS — systeminstruksjon ─────────────────────────────
      // Fasit execSYS():
      //   if(mode) { raiseFault(FAULT_PRIVILEGE); return; }
      //   subOp = (instr>>8) & 0xF
      OP_SYS: begin
        if (activeMode) begin
          // SYS fra user-mode er forbudt
          do_raise_fault(FAULT_PRIVILEGE, fetch_pc);
        end else begin
          sys_sub = instr[11:8];
          case (sys_sub)

            // IRET — fasit:
            //   targetIsUser = STATUS.bit3
            //   if targetIsUser: swap(SP, KSP)
            //   PC = EPC
            //   activeMode = targetIsUser
            //   inFaultHandler = false
            SYS_IRET: begin
              wasUser = cr_STATUS[STATUS_MODE];
              if (wasUser) begin
                cr_KSP <= reg_SP;
                reg_SP <= cr_KSP;
              end
              reg_PC         <= cr_EPC;
              activeMode     <= wasUser;
              inFaultHandler <= '0;
              state          <= ST_FETCH;
              imem_addr      <= cr_EPC;  // target = EPC, not old reg_PC
            end

            // RDCTL — fasit: writeReg((instr>>6)&3, readCtrlReg((instr>>3)&7))
            SYS_RDCTL: begin
              cr_idx = instr[5:3];
              write_reg(instr[7:6], read_ctrl_reg(cr_idx));
              to_fetch();
            end

            // WRCTL — fasit: writeCtrlReg((instr>>3)&7, readReg((instr>>6)&3))
            SYS_WRCTL: begin
              cr_idx = instr[5:3];
              write_ctrl_reg(cr_idx, read_reg(instr[7:6]));
              to_fetch();
            end

            // HALT
            SYS_HALT: begin
              state <= ST_HALT;
            end

            default: to_fetch();
          endcase
        end
      end

      // ─── RET — retur fra subrutin ────────────────────────────
      // Fasit execRET():
      //   physAddr = translate(SP, 'stack')
      //   PC = memory.read(physAddr)
      //   SP = (SP + 1) & 0xFFFF
      OP_RET: begin
        if (needs_io_fault(reg_SP, activeMode)) begin
          do_raise_fault(FAULT_IO, fetch_pc);
        end else if (needs_limit_fault(reg_SP, activeMode, cr_LIMIT)) begin
          do_raise_fault(FAULT_STACK, fetch_pc);
        end else begin
          pa = translate(reg_SP, activeMode, cr_BASE, cr_LIMIT);
          if (pa >= IO_BASE) begin
            io_addr <= pa; io_re <= 1'b1;
            state <= ST_MEMIO;
          end else begin
            dmem_addr <= pa; dmem_re  <= 1'b1;
            state <= ST_MEMWAIT;
          end
        end
      end

      default: to_fetch();
    endcase
  endtask

  // ═══════════════════════════════════════════════════════════
  // finish_memread — fullfør LOAD/POP/RET etter BRAM/IO-svar
  // ═══════════════════════════════════════════════════════════
  task automatic finish_memread(
    input logic [15:0] instr,
    input logic [15:0] mem_data
  );
    logic [3:0] op;
    logic [1:0] dst_reg, pop_reg;

    op = instr[15:12];

    case (op)
      OP_LOAD: begin
        // writeReg(dst, value) — NO FLAGS (fasit: LOAD oppdaterer ikke flagg)
        write_reg(instr[11:10], mem_data);
      end

      OP_STACK: begin
        // POP
        pop_reg = instr[10:9];
        if (pop_reg == REG_SP) begin
          // Fasit: if(reg === 3) { SP = value; }  — INGEN SP++
          reg_SP <= mem_data;
        end else begin
          // Fasit: writeReg(reg, value); SP = (SP + 1) & 0xFFFF
          write_reg(pop_reg, mem_data);
          reg_SP <= (reg_SP + 16'h1) & 16'hFFFF;
        end
      end

      OP_RET: begin
        // Fasit: PC = memory.read(physAddr); SP = (SP+1) & 0xFFFF
        reg_PC <= mem_data;
        reg_SP <= (reg_SP + 16'h1) & 16'hFFFF;
      end

      default: ;
    endcase
  endtask

  // ═══════════════════════════════════════════════════════════
  // do_raise_fault — implementerer cpu.js raiseFault(cause)
  // ═══════════════════════════════════════════════════════════
  task automatic do_raise_fault(
    input logic [7:0]  cause,
    input logic [15:0] fault_pc   // PC VED instruksjonen som forårsaket fault
  );
    logic wasUser;

    // Fasit raiseFault():
    //   if(inFaultHandler) { doubleFault=true; halted=true; return; }
    //   inFaultHandler = true
    //   EPC = (PC - 1) & 0xFFFF  ← men i HDL er fetch_pc den opprinnelige PC
    //   CAUSE = (STATUS[7:0] << 8) | (cause & 0xFF)
    //   wasUser = STATUS.bit3
    //   STATUS &= ~0xC
    //   activeMode = false
    //   if wasUser: swap(SP, KSP)
    //   PC = 0x000C

    if (inFaultHandler) begin
      // Double fault: halt immediately
      doubleFault <= 1'b1;
      state       <= ST_HALT;
    end else begin
      // Normal fault handling
      wasUser = cr_STATUS[STATUS_MODE];

      inFaultHandler <= 1'b1;
      cr_EPC   <= fault_pc;
      cr_CAUSE <= {cr_STATUS[7:0], cause};
      cr_STATUS[STATUS_MODE] <= 1'b0;
      cr_STATUS[STATUS_IE]   <= 1'b0;
      activeMode <= '0;

      if (wasUser) begin
        cr_KSP <= reg_SP;
        reg_SP <= cr_KSP;
      end

      reg_PC    <= VEC_FAULT;
      state     <= ST_FETCH;
      imem_addr <= VEC_FAULT;
    end
  endtask

  // ═══════════════════════════════════════════════════════════
  // Hjelpe-tasks
  // ═══════════════════════════════════════════════════════════

  task automatic write_reg(input logic [1:0] idx, input logic [15:0] val);
    case (idx)
      2'd0: reg_A  <= val;
      2'd1: reg_D  <= val;
      2'd2: reg_B  <= val;
      2'd3: reg_SP <= val;
    endcase
  endtask

  task automatic update_flags(input logic [15:0] val);
    // Fasit updateFlags(): flagZ = (v===0); flagN = !!(v & 0x8000)
    //   STATUS = (STATUS & ~3) | (flagN?2:0) | (flagZ?1:0)
    flag_Z <= (val == 16'h0);
    flag_N <= val[15];
    cr_STATUS[STATUS_N] <= val[15];
    cr_STATUS[STATUS_Z] <= (val == 16'h0);
  endtask

  function automatic logic [15:0] read_ctrl_reg(input logic [2:0] idx);
    // Fasit readCtrlReg(): 0=STATUS, 1=EPC, 2=CAUSE, 3=BASE, 4=LIMIT, 5=KSP
    case (idx)
      3'd0: return cr_STATUS;
      3'd1: return cr_EPC;
      3'd2: return cr_CAUSE;
      3'd3: return cr_BASE;
      3'd4: return cr_LIMIT;
      3'd5: return cr_KSP;
      default: return 16'h0;
    endcase
  endfunction

  task automatic write_ctrl_reg(input logic [2:0] idx, input logic [15:0] val);
    // Fasit writeCtrlReg():
    //   case 0 (STATUS): STATUS=v; flagN=!!(v&2); flagZ=!!(v&1); activeMode=!!(v&8)
    //   case 1 (EPC): EPC=v
    //   case 2 (CAUSE): CAUSE=v
    //   case 3 (BASE): BASE=v
    //   case 4 (LIMIT): LIMIT=v
    //   case 5 (KSP): KSP=v
    case (idx)
      3'd0: begin
        cr_STATUS  <= val;
        flag_N     <= val[STATUS_N];
        flag_Z     <= val[STATUS_Z];
        activeMode <= val[STATUS_MODE];
        // IE oppdateres fra bit2
      end
      3'd1: cr_EPC   <= val;
      3'd2: cr_CAUSE <= val;
      3'd3: cr_BASE  <= val;
      3'd4: cr_LIMIT <= val;
      3'd5: cr_KSP   <= val;
    endcase
  endtask

  task automatic to_fetch();
    state     <= ST_FETCH;
    imem_addr <= reg_PC;
  endtask

  // STATUS bits oppdateres via write_ctrl_reg og update_flags

  // ─── Debug-utganger ─────────────────────────────────────────
  assign dbg_pc      = reg_PC;
  assign dbg_ir      = IR;
  assign dbg_reg_a   = reg_A;
  assign dbg_reg_d   = reg_D;
  assign dbg_reg_b   = reg_B;
  assign dbg_reg_sp  = reg_SP;
  assign dbg_status  = cr_STATUS;
  assign dbg_flag_n  = flag_N;
  assign dbg_flag_z  = flag_Z;
  assign halted      = (state == ST_HALT);
  assign dbg_cause   = cr_CAUSE;

endmodule
