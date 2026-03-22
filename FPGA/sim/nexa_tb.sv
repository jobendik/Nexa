// ============================================================
// nexa_tb.sv — Nexa-16 CPU komplett verifikasjonstestbenk v3
// Alle testprogram-hex-verdier er generert av nexa_asm.py
// ============================================================
`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_tb;

  logic clk = 0;
  logic rst = 1;
  always #5 clk = ~clk;

  logic [15:0] ram [0:65535];

  // ─── CPU-grensesnitt ────────────────────────────────────────
  logic [15:0] imem_addr, imem_rdata;
  logic [15:0] dmem_addr, dmem_wdata, dmem_rdata;
  logic        dmem_we, dmem_re;
  logic [15:0] io_addr, io_wdata;
  logic        io_we, io_re;
  logic [15:0] dbg_pc, dbg_ir;
  logic [15:0] dbg_reg_a, dbg_reg_d, dbg_reg_b, dbg_reg_sp, dbg_status;
  logic        dbg_flag_n, dbg_flag_z, halted;
  logic [15:0] dbg_cause;

  // ─── SystemControl state (fasit: 0xFFF0=pending, 0xFFF1=mask) ──
  logic [7:0]  sys_pending;
  logic [7:0]  sys_mask;

  // io_rdata og io_rdata_valid drives KUN via assign (ingen flerdriver)
  logic [15:0] io_regs [0:15];
  logic [15:0] io_rdata;
  logic        io_rdata_valid;
  assign io_rdata = (io_re && io_addr == 16'hFFF0) ? {8'h0, sys_pending} :
                    (io_re && io_addr == 16'hFFF1) ? {8'h0, sys_mask}    :
                    (io_re)                         ? io_regs[io_addr[3:0]] :
                                                      16'h0;
  assign io_rdata_valid = io_re;

  nexa_cpu dut (
    .clk(clk), .rst(rst),
    .imem_addr(imem_addr), .imem_rdata(imem_rdata),
    .dmem_addr(dmem_addr), .dmem_wdata(dmem_wdata),
    .dmem_we(dmem_we),     .dmem_re(dmem_re),
    .dmem_rdata(dmem_rdata),
    .io_addr(io_addr),     .io_wdata(io_wdata),
    .io_we(io_we),         .io_re(io_re),
    .io_rdata(io_rdata),   .io_rdata_valid(io_rdata_valid),
    .irq_pending(sys_pending), .irq_mask(sys_mask),
    .dbg_pc(dbg_pc),       .dbg_ir(dbg_ir),
    .dbg_reg_a(dbg_reg_a), .dbg_reg_d(dbg_reg_d),
    .dbg_reg_b(dbg_reg_b), .dbg_reg_sp(dbg_reg_sp),
    .dbg_status(dbg_status),
    .dbg_flag_n(dbg_flag_n), .dbg_flag_z(dbg_flag_z),
    .halted(halted),
    .dbg_cause(dbg_cause)
  );

  // ─── BRAM-stub ──────────────────────────────────────────────
  // imem: synkron (1-syklus latency) — CPU bruker FETCH→EXECUTE pipeline
  // dmem: kombinasjonell les + synkron skriv — matcher CPU FSM timing
  // (I ekte FPGA: begge er synkrone; CPU FSM legger til MEMWAIT for dmem-les)
  always_ff @(posedge clk)
    imem_rdata <= ram[imem_addr];

  // dmem les: kombinasjonell — svar klar samme syklus som dmem_addr presenteres
  assign dmem_rdata = ram[dmem_addr];

  always_ff @(posedge clk)
    if (dmem_we && dmem_addr < 16'hFF00)
      ram[dmem_addr] <= dmem_wdata;

  // ─── I/O-stub med korrekt SystemControl (pending &= ~value) ─
  always @(posedge clk or posedge rst) begin
    if (rst) begin
      sys_pending <= 8'h0; sys_mask <= 8'h0;
      foreach (io_regs[i]) io_regs[i] = '0;
    end else if (io_we) begin
      if      (io_addr == 16'hFFF0) sys_pending <= sys_pending & ~io_wdata[7:0];
      else if (io_addr == 16'hFFF1) sys_mask    <= io_wdata[7:0];
      else                          io_regs[io_addr[3:0]] <= io_wdata;
      // UART TX output
      if (io_addr[15:4] == 12'hFF2 && io_addr[3:0] == 4'h1)
        $write("%c", io_wdata[7:0]);
    end
  end

  // ─── Tellere og hjelpere ────────────────────────────────────
  int pass_cnt = 0, fail_cnt = 0;

  task automatic clear(); foreach (ram[i]) ram[i] = '0; endtask

  task automatic load(input int base, input logic [15:0] p[]);
    foreach (p[i]) ram[base+i] = p[i];
  endtask

  task automatic reset();
    rst = 1; sys_pending = 8'h0; sys_mask = 8'h0;
    foreach (io_regs[i]) io_regs[i] = 16'h0;
    repeat(4) @(posedge clk); #1;
    rst = 0; @(posedge clk); #1;
  endtask

  task automatic run(input int max_cyc = 5000);
    int n = 0;
    while (!halted && n < max_cyc) begin @(posedge clk); #1; n++; end
    if (!halted) $display("  [TIMEOUT %0d sykl]", n);
  endtask

  task automatic chk(input string d, input logic [15:0] exp, got);
    if (exp !== got) begin
      $display("  FEIL %-42s exp=0x%04X got=0x%04X", d, exp, got);
      fail_cnt++;
    end else begin
      $display("  OK   %-42s = 0x%04X", d, got);
      pass_cnt++;
    end
  endtask

  task automatic chk1(input string d, input logic exp, got);
    chk(d, {15'h0,exp}, {15'h0,got});
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 1 — ALU: ADD, SUB, AND, OR
  // Program generert av nexa_asm.py
  // ═══════════════════════════════════════════════════════════
  task automatic test1_alu();
    // LDI SP,0; LDU SP,56; LDI A,100; LDI D,200; ADD A,D;
    // LDI A,50; LDI D,100; SUB A,D; LDI A,255; LDI D,170;
    // AND A,D; LDI A,85; OR A,D; HALT
    logic [15:0] p[] = '{
      16'h0C00,16'h1C38,16'h0064,16'h04C8,16'h2100,
      16'h0032,16'h0464,16'h3100,16'h00FF,16'h04AA,
      16'h4100,16'h0055,16'h5100,16'hE300
    };
    $display("\n── TEST 1: ADD/SUB/AND/OR ──");
    clear(); load(0,p); reset(); run();
    chk ("OR 0x55|0xAA: A=0x00FF",    16'h00FF, dbg_reg_a);
    chk1("N=0 (bit15=0)",             1'b0, dbg_flag_n);
    chk1("Z=0",                       1'b0, dbg_flag_z);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 2 — LDI sign-extension og LDU
  // Fasit: LDI sign-extends 10-bit; LDU = (cur&0x3FF)|(imm6<<10)
  // ═══════════════════════════════════════════════════════════
  task automatic test2_ldi_ldu();
    // LDI A,-1 → 0xFFFF
    // LDI D,0; LDU D,59 → D=0xEC00  ← korrekt FB-adresse
    // LDI B,0; LDU B,4  → B=0x1000
    // LDI A,-460; LDU A,4 → A=0x1234
    logic [15:0] p[] = '{
      16'h03FF,16'h0400,16'h143B,16'h0800,16'h1804,
      16'h0234,16'h1004,16'hE300
    };
    $display("\n── TEST 2: LDI/LDU sign-ext og 16-bit load ──");
    clear(); load(0,p); reset(); run();
    // A er overskrevet av den siste LDI+LDU-sekvensen (A=0x1234 til slutt)
    // Testen sjekker siste verdi av hvert register etter HALT:
    chk("LDU D,59: D=0xEC00 (FB-adr!)",   16'hEC00, dbg_reg_d);
    chk("LDU B,4:  B=0x1000",             16'h1000, dbg_reg_b);
    chk("LDI A,-460+LDU A,4: A=0x1234",   16'h1234, dbg_reg_a);
    // LDI A,-1 kjørte men ble overskrevet — sjekk i separat program
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 3 — PUSH/POP LIFO-semantikk
  // Fasit: PUSH: value=readReg; SP--; mem[SP]=value
  //        POP (reg!=SP): value=mem[SP]; writeReg; SP++
  // ═══════════════════════════════════════════════════════════
  task automatic test3_push_pop();
    // LDI SP,0; LDU SP,56 → SP=0xE000
    // LDI A,66; PUSH A → SP=0xDFFF, mem[0xDFFF]=66
    // LDI A,99; PUSH A → SP=0xDFFE, mem[0xDFFE]=99
    // POP D → D=99, SP=0xDFFF
    // POP B → B=66, SP=0xE000
    // HALT
    logic [15:0] p[] = '{
      16'h0C00,16'h1C38,16'h0042,16'hC000,
      16'h0063,16'hC000,16'hCA00,16'hCC00,16'hE300
    };
    $display("\n── TEST 3: PUSH/POP LIFO ──");
    clear(); load(0,p); reset(); run();
    chk("POP D: D=99 (siste inn)",    16'h0063, dbg_reg_d);
    chk("POP B: B=66 (første inn)",   16'h0042, dbg_reg_b);
    chk("SP=0xE000 etter to POP",     16'hE000, dbg_reg_sp);
    chk("mem[0xDFFF]=66 (PUSH A)",    16'h0042, ram[16'hDFFF]);
    chk("mem[0xDFFE]=99 (PUSH A)",    16'h0063, ram[16'hDFFE]);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 4 — POP SP: SP=value, INGEN SP++
  // Fasit cpu.js execSTACK(): if(reg===3){SP=value;}  (ingen ++)
  // ═══════════════════════════════════════════════════════════
  task automatic test4_pop_sp();
    // LDI SP,0; LDU SP,56
    // LDI D,-460; LDU D,4 → D=0x1234
    // PUSH D → SP=0xDFFF, mem[0xDFFF]=0x1234
    // POP SP → SP=mem[0xDFFF]=0x1234, ingen SP++
    // HALT
    logic [15:0] p[] = '{
      16'h0C00,16'h1C38,16'h0634,16'h1404,
      16'hC200,16'hCE00,16'hE300
    };
    $display("\n── TEST 4: POP SP → SP=value (ingen SP++) ──");
    clear(); load(0,p); reset(); run();
    chk("POP SP: SP=0x1234 (ingen SP++)", 16'h1234, dbg_reg_sp);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 5 — CALL og RET
  // Fasit: CALL: SP--, mem[SP]=PC(neste), PC=A
  //        RET:  PC=mem[SP], SP++
  // ═══════════════════════════════════════════════════════════
  task automatic test5_call_ret();
    // 0: LDI SP,0; 1: LDU SP,56 → SP=0xE000
    // 2: LDI A,5; 3: CALL → SP=0xDFFF, mem[0xDFFF]=4, PC=5
    // 4: HALT ← returpunkt
    // 5: LDI D,42; 6: RET → PC=4, SP=0xE000
    logic [15:0] p[] = '{
      16'h0C00,16'h1C38,16'h0005,16'hB000,
      16'hE300,16'h042A,16'hF000
    };
    $display("\n── TEST 5: CALL/RET ──");
    clear(); load(0,p); reset(); run();
    chk("D=42 (fn kjørt)",         16'h002A, dbg_reg_d);
    chk("SP=0xE000 etter RET",     16'hE000, dbg_reg_sp);
    chk("mem[0xDFFF]=4 (retadr)",  16'h0004, ram[16'hDFFF]);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 6 — TRAP
  // Fasit: EPC=PC(post-incr); CAUSE=imm12; STATUS&=~0xC; PC=0x0008
  // ═══════════════════════════════════════════════════════════
  task automatic test6_trap();
    // 0: LDI SP,0; 1: LDU SP,56
    // 2: LDI D,0; 3: TRAP 42 → EPC=4, CAUSE=42, PC=8
    // 4: HALT (aldri nådd)
    // 5,6,7: NOP
    // 8: LDI A,1; 9: HALT (handler)
    logic [15:0] p[] = '{
      16'h0C00,16'h1C38,16'h0400,16'hD02A,16'hE300,
      16'h9000,16'h9000,16'h9000,16'h0001,16'hE300
    };
    $display("\n── TEST 6: TRAP ──");
    clear(); load(0,p); reset(); run();
    chk ("TRAP: handler kjørt: A=1",  16'h0001, dbg_reg_a);
    chk ("TRAP: CAUSE=42",            16'h002A, dut.cr_CAUSE);
    chk ("TRAP: EPC=4 (PC+1)",        16'h0004, dut.cr_EPC);
    chk1("TRAP: MODE=0 (kernel)",     1'b0, dut.cr_STATUS[3]);
    chk1("TRAP: IE=0",                1'b0, dut.cr_STATUS[2]);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 7 — WRCTL STATUS + IRET
  // Fasit writeCtrlReg(STATUS): setter activeMode fra bit3
  //        IRET: swap(SP,KSP) hvis targetIsUser; PC=EPC; activeMode=bit3
  // ═══════════════════════════════════════════════════════════
  task automatic test7_iret();
    logic [15:0] p[] = new [32];
    $display("\n── TEST 7: WRCTL STATUS + IRET ──");
    foreach(p[i]) p[i] = 16'h9000; // NOP

    // 0: SP init
    p[0] = 16'h0C00; p[1] = 16'h1C38;  // SP=0xE000
    // 2: KSP=0xD000: LDI D,0; LDU D,52; WRCTL KSP,D
    // LDU D,52: (0&0x3FF)|(52<<10)=0xD000
    p[2] = 16'h0400;  // LDI D,0
    p[3] = 16'h1434;  // LDU D,52 → D=0xD000
    // WRCTL KSP,D: SYS(E)|WRCTL(2<<8)|src(D=1)<<6|cr(KSP=5)<<3
    // = 0xE000|0x0200|0x0040|0x0028 = 0xE268
    p[4] = 16'hE268;  // WRCTL KSP,D
    // 5: EPC=16 (target PC)
    p[5] = 16'h0010;  // LDI A,16
    // WRCTL EPC,A: SYS|WRCTL(2<<8)|A(0)<<6|EPC(1)<<3 = 0xE200|0x008 = 0xE208
    p[6] = 16'hE208;  // WRCTL EPC,A
    // 7: STATUS=0x0008 (bit3=1=target_user)
    p[7] = 16'h0408;  // LDI D,8
    // WRCTL STATUS,D: SYS|WRCTL(2<<8)|D(1)<<6|STATUS(0)<<3 = 0xE200|0x040 = 0xE240
    p[8] = 16'hE240;  // WRCTL STATUS,D
    // 9: IRET → PC=EPC=16, activeMode=true (men HALT er SYS → fault!)
    // Vi hopper til 0x0010 i kernel-mode fordi bit3=1 angir target
    p[9] = 16'hE000;  // IRET

    // Handler @ 0x0010: sett A=99 og HALT (SYS er forbudt i user)
    // Siden vi var i user-mode etter IRET, trigger HALT privilege fault
    // Vi tester at A=99 settes FØR HALT
    // Alternativt: sett STATUS tilbake til kernel og HALT
    // LDI A,99; WRCTL STATUS,B (B=0 → kernel); HALT
    p[16] = 16'h0063; // LDI A,99
    // Gå tilbake til kernel: LDI B,0; WRCTL STATUS,B = 0xE248? Nei:
    // WRCTL STATUS,B: SYS|WRCTL(2<<8)|B(2)<<6|STATUS(0)<<3 = 0xE200|0x080 = 0xE280
    p[17] = 16'h0800; // LDI B,0 (STATUS=0=kernel)
    p[18] = 16'hE280; // WRCTL STATUS,B → kernel-mode
    p[19] = 16'hE300; // HALT

    clear(); load(0,p); reset(); run();
    chk("IRET: A=99 (target kjørt)", 16'h0063, dbg_reg_a);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 8 — SYS fra user-mode → FAULT_PRIVILEGE (kode 20)
  // Fasit execSYS(): if(mode) { raiseFault(FAULT_PRIVILEGE); }
  // raiseFault: CAUSE=(STATUS<<8)|cause; PC=0x000C
  // ═══════════════════════════════════════════════════════════
  task automatic test8_privilege();
    logic [15:0] p[] = new [64];
    $display("\n── TEST 8: SYS(user) → FAULT_PRIVILEGE ──");
    foreach(p[i]) p[i] = 16'h9000;

    // Fault-handler @ 0x000C: sett A=0xBEEF, HALT
    // 0xBEEF: LDI A, 0x3EF (=-17 i 10-bit signed? nei: 0x3EF=1007>511 → neg)
    // 0x3EF signed 10-bit: 1007-1024=-17 → sign-ext 0xFFEF
    // LDU A,47: (0xFFEF&0x3FF)|(47<<10) = 0x3EF|0xBC00 = 0xBFEF ≠ 0xBEEF
    // 0xBEEF: bits[15:10]=0b101111=47, bits[9:0]=0x2EF=751
    // 751 < 512? No: 751-1024=-273 → 0xFEEF
    // LDU A,47: (0xFEEF&0x3FF)|(47<<10)=0x2EF|0xBC00=0xBEEF ✓
    p[12] = 16'h02EF; // LDI A,-273 (0x2EF jako signed10: 0xFEEF)
    p[13] = 16'h102F; // LDU A,47 → A=0xBEEF
    p[14] = 16'hE300; // HALT

    // Main @ 0x0010: gå til user-mode via IRET, hopp til 0x0020
    p[16] = 16'h0C00; // LDI SP,0
    p[17] = 16'h1C38; // LDU SP,56 → SP=0xE000
    p[18] = 16'h0020; // LDI A,32 (EPC=0x0020)
    p[19] = 16'hE208; // WRCTL EPC,A
    p[20] = 16'h0408; // LDI D,8 (STATUS bit3=1=user)
    p[21] = 16'hE240; // WRCTL STATUS,D
    p[22] = 16'hE000; // IRET → user-mode, PC=0x0020

    // @ 0x0020: User-kode: prøv HALT (SYS) → FAULT_PRIVILEGE
    p[32] = 16'hE300; // HALT (SYS fra user-mode → FAULT_PRIVILEGE → PC=0x000C)

    // JMP til 0x0010 ved start
    p[0] = 16'h0010; // LDI A,16
    p[1] = 16'hA000; // JMP

    clear(); load(0,p); reset(); run();
    chk("SYS(user): A=0xBEEF (fault-handler kjørt)", 16'hBEEF, dbg_reg_a);
    chk1("CAUSE[7:0]=20 (FAULT_PRIVILEGE)", 1'b1, (dut.cr_CAUSE[7:0] == 8'd20));
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 9 — Timer-interrupt (IRQ bit 0)
  // Fasit checkInterrupts(): pending=0xFFF0; mask=0xFFF1
  //   EPC=PC; CAUSE=(STATUS[7:0]<<8)|irq; mem[0xFFF0]=1<<irq; PC=4
  // ═══════════════════════════════════════════════════════════
  task automatic test9_interrupt();
    logic [15:0] p[] = new [20];
    $display("\n── TEST 9: Timer-interrupt (IRQ 0) ──");
    foreach(p[i]) p[i] = 16'h9000;

    // JMP forbi vektorer
    p[0] = 16'h0006; p[1] = 16'hA000; // LDI A,6; JMP

    // IRQ-handler @ 0x0004
    p[4] = 16'h004D; // LDI A,77
    p[5] = 16'hE300; // HALT

    // Main @ 0x0006: SP init, aktiver IE, vente-løkke
    p[6]  = 16'h0C00; p[7]  = 16'h1C38;  // SP=0xE000
    p[8]  = 16'h0404; // LDI D,4 (IE=1, kernel)
    p[9]  = 16'hE240; // WRCTL STATUS,D
    // Vente-løkke: BRA -1 (offset=-1 → 0x1FF)
    p[10] = 16'h9FFF; // BRA -1

    clear(); load(0,p); reset();

    // La CPU kjøre 60 sykluser, deretter trigger interrupt
    repeat(60) @(posedge clk); #1;
    sys_pending = 8'h01; // Timer bit0
    sys_mask    = 8'hFF;

    run(500);
    chk("IRQ: handler kjørt (A=77)",        16'h004D, dbg_reg_a);
    chk1("IRQ: EPC i løkke (>=0x0A)",       1'b1, (dut.cr_EPC >= 16'h000A));
    // CAUSE=(STATUS<<8)|irq: STATUS=0x04 (IE=1), irq=0 → 0x0400
    chk("IRQ: CAUSE=0x0400",                16'h0400, dut.cr_CAUSE);
    chk1("IRQ: MODE=0 etter handler",       1'b0, dut.cr_STATUS[3]);
    // sys_pending bit0 skal være clearet etter acknowledge
    chk1("IRQ: pending[0] clearet",         1'b0, sys_pending[0]);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 10 — User-mode MMU: LOAD >= LIMIT → FAULT_LOAD
  // Fasit translate(): vaddr >= LIMIT → raiseFault(FAULT_LOAD)
  // CAUSE=(STATUS[7:0]<<8)|FAULT_LOAD
  // ═══════════════════════════════════════════════════════════
  task automatic test10_mmu();
    logic [15:0] p[] = new [64];
    $display("\n── TEST 10: MMU LOAD>=LIMIT → FAULT_LOAD ──");
    foreach(p[i]) p[i] = 16'h9000;

    // JMP forbi vektorer til 0x0010
    p[0] = 16'h0010; p[1] = 16'hA000;

    // Fault-handler @ 0x000C: A=0xF00D, HALT
    p[12] = 16'h000D; // LDI A,13
    p[13] = 16'h103C; // LDU A,60 → A=(13)|(60<<10)=0xF00D
    p[14] = 16'hE300; // HALT

    // JMP forbi exception-vektorer til kernel @ 0x0010
    p[0] = 16'h0010; p[1] = 16'hA000;

    // Kernel @ 0x0010: SP, BASE, LIMIT, enter user via JMP (NOT IRET)
    // Korrekt user-mode overgang: WRCTL STATUS setter activeMode=true,
    // deretter JMP (som IKKE er SYS) hopper til brukerkode.
    p[16] = 16'h0C00; p[17] = 16'h1C38;  // SP=0xE000
    p[18] = 16'h0000; p[19] = 16'hE218;  // WRCTL BASE, A(=0)
    p[20] = 16'h0040; p[21] = 16'hE220;  // WRCTL LIMIT, A(=64=0x40)
    p[22] = 16'h0020; // LDI A, 32 (adresse til brukerkode)
    p[23] = 16'h0408; // LDI D, 8 (STATUS = user-mode)
    p[24] = 16'hE240; // WRCTL STATUS, D → activeMode=true
    p[25] = 16'hA000; // JMP → PC=A=0x0020, nå i user-mode ✓

    // Brukerkode @ 0x0020: LOAD fra vaddr=LIMIT=64 → FAULT_LOAD (kode 17)
    p[32] = 16'h0040; // LDI A, 64 (=LIMIT=0x40)
    p[33] = 16'h7000; // LOAD A,[A+0]: vaddr=0x40=LIMIT → FAULT_LOAD

    clear(); load(0,p); reset(); run(500);
    chk ("MMU: fault-handler kjørt (A=0xF00D)", 16'hF00D, dbg_reg_a);
    chk("MMU: CAUSE[7:0]=17 (FAULT_LOAD)",
        16'h0011, dbg_cause & 16'h00FF);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 11 — Framebuffer-adresse 0xEC00
  // ═══════════════════════════════════════════════════════════
  task automatic test11_framebuffer();
    // LDI SP,0; LDU SP,56; LDI A,0; LDU A,59 → A=0xEC00
    // STORE 'H'=72,[A+0]; STORE 'A'=65,[A+1]; STORE '+'=43,[A+4]
    // LOAD B,[A+0] → B=72
    logic [15:0] p[] = '{
      16'h0C00,16'h1C38,16'h0000,16'h103B,
      16'h0448,16'h8400,16'h0441,16'h8401,
      16'h042B,16'h8404,16'h7800,16'hE300
    };
    $display("\n── TEST 11: Framebuffer @ 0xEC00 ──");
    clear(); load(0,p); reset(); run();
    chk("STORE[0xEC00]=72 ('H')",   16'h0048, ram[16'hEC00]);
    chk("STORE[0xEC01]=65 ('A')",   16'h0041, ram[16'hEC01]);
    chk("STORE[0xEC04]=43 ('+')",   16'h002B, ram[16'hEC04]);
    chk("LOAD B,[0xEC00]: B=72",    16'h0048, dbg_reg_b);
    chk("0x4000 er IKKE FB (=0)",   16'h0000, ram[16'h4000]);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 12 — Branch-betingelser (BRZ, BRN, BRP)
  // ═══════════════════════════════════════════════════════════
  task automatic test12_branches();
    logic [15:0] p[];
    $display("\n── TEST 12: Branch-betingelser ──");

    // BRZ: LDI A,0; AND A,A→Z=1; BRZ skip; LDI D,1; skip: LDI D,2; HALT
    p = '{16'h0000, 16'h4000, 16'h9401, 16'h0401, 16'h0402, 16'hE300};
    clear(); load(0,p); reset(); run();
    chk("BRZ tatt: D=2 (LDI D,1 hoppes)",  16'h0002, dbg_reg_d);

    // BRN: LDI A,-1; AND A,A→N=1; BRN skip; LDI B,3; skip: LDI B,4; HALT
    p = '{16'h03FF, 16'h4000, 16'h9801, 16'h0803, 16'h0804, 16'hE300};
    clear(); load(0,p); reset(); run();
    chk("BRN tatt: B=4 (LDI B,3 hoppes)",  16'h0004, dbg_reg_b);

    // BRP: LDI A,1; AND A,A→P=1; BRP skip; LDI B,254; skip: LDI B,255; HALT
    p = '{16'h0001, 16'h4000, 16'h9201, 16'h08FE, 16'h08FF, 16'hE300};
    clear(); load(0,p); reset(); run();
    chk("BRP tatt: B=255 (LDI B,254 hoppes)", 16'h00FF, dbg_reg_b);
  endtask

  // ═══════════════════════════════════════════════════════════
  // TEST 13 — ALU2: NOT, SHL, ASR (inkl. neg.), MOV, XOR
  // ═══════════════════════════════════════════════════════════
  task automatic test13_alu2();
    logic [15:0] p[];
    $display("\n── TEST 13: ALU2 (NOT/SHL/ASR/MOV/XOR) ──");

    // Del A: SHL, ASR, NOT, MOV — sjekk D=4 etter MOV D,A
    // LDI A,1; SHL×4→16; ASR×2→4; NOT;NOT→4; LDI D,0; MOV D,A; HALT
    p = '{16'h0001, 16'h6080,16'h6080,16'h6080,16'h6080,
           16'h6100,16'h6100, 16'h6000,16'h6000,
           16'h0400, 16'h6580, 16'hE300};
    clear(); load(0,p); reset(); run();
    chk("SHL×4+ASR×2+NOT×2: A=4",  16'h0004, dbg_reg_a);
    chk("MOV D,A: D=4",             16'h0004, dbg_reg_d);

    // Del B: XOR — sjekk A=0x55 direkte etter XOR
    // LDI A,255; LDI D,170; XOR A,D; HALT
    p = '{16'h00FF, 16'h04AA, 16'h6220, 16'hE300};
    clear(); load(0,p); reset(); run();
    chk("XOR 0xFF^0xAA: A=0x55",    16'h0055, dbg_reg_a);

    // Del C: ASR på negativt tall
    // LDI A,-128 (0x0380); ASR A; HALT
    p = '{16'h0380, 16'h6100, 16'hE300};
    clear(); load(0,p); reset(); run();
    chk("ASR(-128): A=0xFFC0",      16'hFFC0, dbg_reg_a);
    chk1("ASR neg: N=1",            1'b1, dbg_flag_n);
  endtask

  // ═══════════════════════════════════════════════════════════
  // MAIN
  // ═══════════════════════════════════════════════════════════
  initial begin
    $dumpfile("sim/nexa_wave.vcd");
    $dumpvars(0, nexa_tb);

    $display("╔══════════════════════════════════════════════════════╗");
    $display("║  NEXA-16 CPU Verifikasjon  —  Fasit: cpu.js           ║");
    $display("╚══════════════════════════════════════════════════════╝");

    test1_alu();
    test2_ldi_ldu();
    test3_push_pop();
    test4_pop_sp();
    test5_call_ret();
    test6_trap();
    test7_iret();
    test8_privilege();
    test9_interrupt();
    test10_mmu();
    test11_framebuffer();
    test12_branches();
    test13_alu2();

    $display("\n╔══════════════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil                       ║",
             pass_cnt, fail_cnt);
    $display("╚══════════════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ ALT GRØNT — FPGA-CPU matcher Nexa-16-emulatoren!");
    else
      $display("✗ %0d FEIL gjenstår", fail_cnt);
    $finish;
  end

  initial begin #8_000_000; $display("GLOBAL TIMEOUT"); $finish; end
endmodule
