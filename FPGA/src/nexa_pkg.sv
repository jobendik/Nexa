// ============================================================
// nexa_pkg.sv — Nexa-16 CPU pakke
// Fasit: cpu.js, memory.js, devices.js, app.js
// ============================================================
package nexa_pkg;

  timeunit 1ns;
  timeprecision 1ps;

  // ─── Instruksjons-opkoder [15:12] ───────────────────────────
  typedef enum logic [3:0] {
    OP_LDI   = 4'd0,
    OP_LDU   = 4'd1,
    OP_ADD   = 4'd2,
    OP_SUB   = 4'd3,
    OP_AND   = 4'd4,
    OP_OR    = 4'd5,
    OP_ALU2  = 4'd6,
    OP_LOAD  = 4'd7,
    OP_STORE = 4'd8,
    OP_BR    = 4'd9,
    OP_JMP   = 4'd10,
    OP_CALL  = 4'd11,
    OP_STACK = 4'd12,
    OP_TRAP  = 4'd13,
    OP_SYS   = 4'd14,
    OP_RET   = 4'd15
  } opcode_t;

  // ─── ALU2 sub-opkoder [9:7] ─────────────────────────────────
  typedef enum logic [2:0] {
    ALU2_NOT = 3'd0,
    ALU2_SHL = 3'd1,
    ALU2_ASR = 3'd2,
    ALU2_MOV = 3'd3,
    ALU2_XOR = 3'd4
  } alu2_op_t;

  // ─── SYS sub-opkoder [11:8] ─────────────────────────────────
  typedef enum logic [3:0] {
    SYS_IRET  = 4'd0,
    SYS_RDCTL = 4'd1,
    SYS_WRCTL = 4'd2,
    SYS_HALT  = 4'd3
  } sys_op_t;

  // ─── Register-indekser ──────────────────────────────────────
  localparam logic [1:0] REG_A  = 2'd0;
  localparam logic [1:0] REG_D  = 2'd1;
  localparam logic [1:0] REG_B  = 2'd2;
  localparam logic [1:0] REG_SP = 2'd3;

  // ─── Kontroll-register-indekser ─────────────────────────────
  localparam logic [2:0] CR_STATUS = 3'd0;
  localparam logic [2:0] CR_EPC    = 3'd1;
  localparam logic [2:0] CR_CAUSE  = 3'd2;
  localparam logic [2:0] CR_BASE   = 3'd3;
  localparam logic [2:0] CR_LIMIT  = 3'd4;
  localparam logic [2:0] CR_KSP    = 3'd5;

  // ─── STATUS register bits ────────────────────────────────────
  // Fasit cpu.js: STATUS = [15..4: reserved][3: MODE][2: IE][1: N][0: Z]
  localparam int STATUS_Z    = 0;   // bit 0: zero flag (oppdateres av updateFlags)
  localparam int STATUS_N    = 1;   // bit 1: negative flag
  localparam int STATUS_IE   = 2;   // bit 2: interrupt enable
  localparam int STATUS_MODE = 3;   // bit 3: 1=user, 0=kernel

  // ─── Exception-vektorer ─────────────────────────────────────
  // Fasit cpu.js:
  //   reset   → PC = 0x0000
  //   interrupt → PC = 0x0004 (checkInterrupts)
  //   trap    → PC = 0x0008 (execTRAP)
  //   fault   → PC = 0x000C (raiseFault)
  localparam logic [15:0] VEC_RESET = 16'h0000;
  localparam logic [15:0] VEC_INT   = 16'h0004;
  localparam logic [15:0] VEC_TRAP  = 16'h0008;
  localparam logic [15:0] VEC_FAULT = 16'h000C;

  // ─── Fault-koder ────────────────────────────────────────────
  // Fasit cpu.js:
  localparam logic [7:0] FAULT_FETCH     = 8'd16;
  localparam logic [7:0] FAULT_LOAD      = 8'd17;
  localparam logic [7:0] FAULT_STORE     = 8'd18;
  localparam logic [7:0] FAULT_STACK     = 8'd19;
  localparam logic [7:0] FAULT_PRIVILEGE = 8'd20;
  localparam logic [7:0] FAULT_IO        = 8'd21;

  // ─── Minnekart ──────────────────────────────────────────────
  // Fasit memory.js + app.js:
  //
  //   0x0000 – 0xEBFF   RAM (generell, inkl. kode, data, heap)
  //
  //   0xEC00 – 0xFEBF   Aktiv framebuffer (del av RAM — IKKE MMIO!)
  //     Snapshot: memory.ram.subarray(0xEC00, 0xEC00 + 4800)
  //     Tekst-modus:  80 kolonner × 30 rader = 2400 ord
  //                   Øverste venstre: 0xEC00
  //                   Hver rad: 80 ord (0xEC00, 0xEC50, ...)
  //                   Hvert ord: [15:12]=BG-farge [11:8]=FG-farge [7:0]=ASCII
  //     Piksel-modus: 40 ord × 120 rader = 4800 ord
  //                   Hvert ord: 4×4-bit farge-nibbler (4 piksler)
  //     Slutt-adresse piksel: 0xEC00 + 4800 - 1 = 0xFEBF
  //     Slutt-adresse tekst:  0xEC00 + 2400 - 1 = 0xF55F
  //   0xFEC0 – 0xFEFF   Display-reservert gap
  //
  //   0xFF00 – 0xFFFF   I/O MMIO (enhetskart)
  //
  // VIKTIG: Adressen 0x4000 er IKKE framebuffer i Nexa-16!
  //         Gammel Nand2Tetris Hack brukte 0x4000, men Nexa-16
  //         har FB ved 0xEC00.

  localparam logic [15:0] RAM_END        = 16'hEBFF;  // Siste RAM-ord (pre-FB)
  localparam logic [15:0] FB_BASE        = 16'hEC00;  // Framebuffer start

  // Tekst-modus: 80 × 30 = 2400 ord
  localparam int          FB_TEXT_COLS   = 80;
  localparam int          FB_TEXT_ROWS   = 30;
  localparam int          FB_TEXT_WORDS  = FB_TEXT_COLS * FB_TEXT_ROWS;  // 2400
  localparam logic [15:0] FB_TEXT_END    = 16'hEC00 + FB_TEXT_WORDS - 1; // 0xF55F

  // Piksel-modus: 40 × 120 = 4800 ord
  localparam int          FB_PIXEL_COLS  = 40;
  localparam int          FB_PIXEL_ROWS  = 120;
  localparam int          FB_PIXEL_WORDS = FB_PIXEL_COLS * FB_PIXEL_ROWS; // 4800
  localparam logic [15:0] FB_PIXEL_END   = 16'hEC00 + FB_PIXEL_WORDS - 1; // 0xFEBF

  // I/O-rom
  localparam logic [15:0] IO_BASE        = 16'hFF00;

  // ─── I/O-enhetsadresser (base = addr & 0xFFF0) ──────────────
  // Fasit emu-worker.js registerDevice-kall:
  localparam logic [15:0] IO_KBD_BASE   = 16'hFF00;  // Keyboard
  localparam logic [15:0] IO_TIMER_BASE = 16'hFF10;  // Timer
  localparam logic [15:0] IO_UART_BASE  = 16'hFF20;  // UART
  localparam logic [15:0] IO_DISP_BASE  = 16'hFF30;  // DisplayController
  localparam logic [15:0] IO_SOUND_BASE = 16'hFF40;  // Sound
  localparam logic [15:0] IO_DISK_BASE  = 16'hFF50;  // DiskController
  localparam logic [15:0] IO_SYSCTRL    = 16'hFFF0;  // SystemControl

  // ─── Interrupt-bit-tildeling ────────────────────────────────
  // Fasit emu-worker.js:
  //   system.setInterrupt(0)  // Timer
  //   system.setInterrupt(1)  // Keyboard
  //   system.setInterrupt(2)  // UART RX
  //   system.setInterrupt(3)  // UART TX
  //   system.setInterrupt(4)  // Disk
  localparam int IRQ_TIMER   = 0;
  localparam int IRQ_KBD     = 1;
  localparam int IRQ_UART_RX = 2;
  localparam int IRQ_UART_TX = 3;
  localparam int IRQ_DISK    = 4;

  // ─── CPU FSM-tilstander ─────────────────────────────────────
  typedef enum logic [2:0] {
    ST_FETCH    = 3'd0,
    ST_EXECUTE  = 3'd1,
    ST_MEMWAIT  = 3'd2,
    ST_MEMREAD  = 3'd3,
    ST_MEMIO    = 3'd4,
    ST_HALT     = 3'd5
  } cpu_state_t;

  // ─── Sign-extension-hjelpere ────────────────────────────────
  function automatic logic [15:0] sign_ext10(input logic [9:0] v);
    return {{6{v[9]}}, v};
  endfunction

  function automatic logic [15:0] sign_ext9(input logic [8:0] v);
    return {{7{v[8]}}, v};
  endfunction

  function automatic logic [15:0] sign_ext8(input logic [7:0] v);
    return {{8{v[7]}}, v};
  endfunction

endpackage
