// ============================================================
// nexa_top.sv — Nexa-16 FPGA Top-level (Basys 3)
// Fasit: memory.js (minnekart), devices.js, emu-worker.js
//
// MINNEKART (fra memory.js + app.js):
//   0x0000–0xEBFF  RAM  (60416 ord, inkl. kode, data, heap)
//   0xEC00–0xFEBF  Aktiv framebuffer i RAM (4800 ord)
//     Tekst: 80×30 = 2400 ord på 0xEC00–0xF55F
//     Piksel: 40×120 = 4800 ord på 0xEC00–0xFEBF
//   0xFEC0–0xFEFF  Display-reservert gap
//   0xFF00–0xFFFF  I/O MMIO
//
// SKJERM: UART-output som bruk-verktøy under bring-up
//         Framebuffer: tekst-modus 80×30, 8x8 font via VGA
//
// BASYS 3 SPESIFIKK:
//   - 4-sifret 7-segment display (an[3:0])
//   - Klokke: 100 MHz (W5)
//   - UART: uart_rxd=A18, uart_txd=B18
// ============================================================
`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_top #(
  parameter        PROGRAM_FILE = "mem/nexaos_boot.mem",
  parameter        DISK_FILE    = "mem/nexaos_system_disk.mem",
  parameter bit    ENABLE_VGA   = 1'b1,
  parameter int    CLK_HZ       = 100_000_000
) (
  input  logic        clk,
  input  logic        rst_btn,    // BTNC (aktiv høy)

  // UART
  output logic        uart_txd,
  input  logic        uart_rxd,

  // LEDs (16 stk)
  output logic [15:0] led,

  // 7-segment display (4-sifret, Basys 3)
  output logic [7:0]  seg,
  output logic [3:0]  an,

  // PS/2 tastatur
  input  logic        ps2_clk,
  input  logic        ps2_data,

  // VGA (Basys 3 har 12-bit VGA)
  output logic [3:0]  vga_r, vga_g, vga_b,
  output logic        vga_hs, vga_vs
);

  // ─── Reset (synkronisert, aktiv høy) ───────────────────────
  logic rst;
  always_ff @(posedge clk) rst <= rst_btn;

  // ─── BRAM 64K×16-bit ────────────────────────────────────────
  // Port A: instruksjonslesing (CPU imem)
  // Port B: datales/skriv (CPU dmem)
  logic [15:0] bram_addra, bram_addrb;
  logic [15:0] bram_dinb, bram_douta, bram_doutb;
  logic        bram_web;

  nexa_ram #(
    .INIT_FILE (PROGRAM_FILE)
  ) ram_inst (
    .clk    (clk),
    .a_addr (bram_addra), .a_rdata (bram_douta),
    .b_addr (bram_addrb), .b_wdata (bram_dinb),
    .b_we   (bram_web),   .b_rdata (bram_doutb)
  );

  // ─── CPU-signaler ───────────────────────────────────────────
  logic [15:0] cpu_imem_addr, cpu_imem_rdata;
  logic [15:0] cpu_dmem_addr, cpu_dmem_wdata, cpu_dmem_rdata;
  logic        cpu_dmem_we, cpu_dmem_re;
  logic [15:0] cpu_io_addr, cpu_io_wdata, cpu_io_rdata;
  logic        cpu_io_we, cpu_io_re, cpu_io_rdata_valid;
  logic [15:0] io_rdata;
  logic        io_rdata_valid;
  logic [15:0] disk_rdata;
  logic        disk_rdata_valid;
  logic        disk_mmio_sel;
  logic        disk_dma_active;
  logic        disk_dma_we;
  logic [15:0] disk_dma_addr;
  logic [15:0] disk_dma_wdata;
  logic [15:0] disk_dma_rdata;
  logic        disk_irq_done;
  logic        disk_ctrl_start_read;
  logic [7:0]  disk_ctrl_sector;
  logic [15:0] disk_ctrl_mem_addr;
  logic        disk_ctrl_busy;
  logic        disk_ctrl_done;
  logic        disk_ctrl_error;
  logic [7:0]  cpu_irq_pending, cpu_irq_mask;
  logic        disp_mode_live;
  logic        cpu_rst;
  logic        vga_preload_active;
  logic        vga_preload_pipe_valid;
  logic        vga_preload_valid;
  logic [15:0] vga_preload_addr;
  logic [15:0] vga_preload_data;
  logic [12:0] vga_preload_req_index;
  logic [12:0] vga_preload_rsp_index;
  logic [15:0] dbg_pc, dbg_ir, dbg_reg_a, dbg_reg_d;
  logic [15:0] dbg_reg_b, dbg_reg_sp, dbg_status, dbg_cause;
  logic        dbg_flag_n, dbg_flag_z, cpu_halted;

  typedef enum logic [4:0] {
    EXEC_IDLE,
    EXEC_MAGIC_REQ,
    EXEC_MAGIC_WAIT,
    EXEC_MAGIC_SAMPLE,
    EXEC_COUNT_REQ,
    EXEC_COUNT_WAIT,
    EXEC_COUNT_SAMPLE,
    EXEC_SIZE_REQ,
    EXEC_SIZE_WAIT,
    EXEC_SIZE_SAMPLE,
    EXEC_LIST_REQ,
    EXEC_LIST_WAIT,
    EXEC_LIST_SAMPLE,
    EXEC_LOAD_START,
    EXEC_LOAD_WAIT,
    EXEC_HEAP_WRITE,
    EXEC_CLEAR_MAGIC,
    EXEC_RELEASE
  } exec_loader_state_t;

  exec_loader_state_t exec_loader_state;
  logic               exec_checked_halt;
  logic               exec_cpu_hold;
  logic               exec_ram_active;
  logic               exec_ram_we;
  logic [15:0]        exec_ram_addr;
  logic [15:0]        exec_ram_wdata;
  logic [7:0]         exec_sector_count;
  logic [15:0]        exec_file_size;
  logic [7:0]         exec_sector_read_index;
  logic [7:0]         exec_load_index;
  logic [7:0]         exec_sector_table [0:250];

  assign disk_mmio_sel = ((cpu_io_addr & 16'hFFF0) == nexa_pkg::IO_DISK_BASE);
  assign cpu_io_rdata = disk_rdata_valid ? disk_rdata : io_rdata;
  assign cpu_io_rdata_valid = io_rdata_valid | disk_rdata_valid;

  assign cpu_rst = rst | vga_preload_active | exec_cpu_hold;

  nexa_cpu cpu_inst (
    .clk           (clk),
    .rst           (cpu_rst),
    .imem_addr     (cpu_imem_addr),
    .imem_rdata    (cpu_imem_rdata),
    .dmem_addr     (cpu_dmem_addr),
    .dmem_wdata    (cpu_dmem_wdata),
    .dmem_we       (cpu_dmem_we),
    .dmem_re       (cpu_dmem_re),
    .dmem_rdata    (cpu_dmem_rdata),
    .io_addr       (cpu_io_addr),
    .io_wdata      (cpu_io_wdata),
    .io_we         (cpu_io_we),
    .io_re         (cpu_io_re),
    .io_rdata      (cpu_io_rdata),
    .io_rdata_valid(cpu_io_rdata_valid),
    .irq_pending   (cpu_irq_pending),
    .irq_mask      (cpu_irq_mask),
    .dbg_pc        (dbg_pc),
    .dbg_ir        (dbg_ir),
    .dbg_reg_a     (dbg_reg_a),
    .dbg_reg_d     (dbg_reg_d),
    .dbg_reg_b     (dbg_reg_b),
    .dbg_reg_sp    (dbg_reg_sp),
    .dbg_status    (dbg_status),
    .dbg_flag_n    (dbg_flag_n),
    .dbg_flag_z    (dbg_flag_z),
    .halted        (cpu_halted),
    .dbg_cause     (dbg_cause)
  );

  // ─── I/O-system ─────────────────────────────────────────────
  logic [7:0] kbd_ascii;
  logic       kbd_valid;

  nexa_io #(
    .CLK_HZ(CLK_HZ)
  ) io_inst (
    .clk           (clk),
    .rst           (rst),
    .addr          (cpu_io_addr),
    .wdata         (cpu_io_wdata),
    .we            (cpu_io_we && !disk_mmio_sel),
    .re            (cpu_io_re && !disk_mmio_sel),
    .rdata         (io_rdata),
    .rdata_valid   (io_rdata_valid),
    .irq_pending   (cpu_irq_pending),
    .irq_mask      (cpu_irq_mask),
    .disp_mode_out (disp_mode_live),
    .disk_irq_done (disk_irq_done),
    .kbd_ascii     (kbd_ascii),
    .kbd_valid     (kbd_valid),
    .uart_rx_in    (uart_rxd),
    .uart_tx_out   (uart_txd)
  );

  nexa_disk #(
    .INIT_FILE(DISK_FILE)
  ) disk_inst (
    .clk        (clk),
    .rst        (rst),
    .addr       (cpu_io_addr),
    .wdata      (cpu_io_wdata),
    .we         (cpu_io_we && disk_mmio_sel),
    .re         (cpu_io_re && disk_mmio_sel),
    .rdata      (disk_rdata),
    .rdata_valid(disk_rdata_valid),
    .irq_done   (disk_irq_done),
    .ctrl_start_read(disk_ctrl_start_read),
    .ctrl_sector (disk_ctrl_sector),
    .ctrl_mem_addr(disk_ctrl_mem_addr),
    .ctrl_busy   (disk_ctrl_busy),
    .ctrl_done   (disk_ctrl_done),
    .ctrl_error  (disk_ctrl_error),
    .dma_active (disk_dma_active),
    .dma_we     (disk_dma_we),
    .dma_addr   (disk_dma_addr),
    .dma_wdata  (disk_dma_wdata),
    .dma_rdata  (disk_dma_rdata)
  );

  // ─── BRAM-mux ───────────────────────────────────────────────
  // Port A: CPU instruksjonshenting (alltid RAM, kernel kan lese alt)
  assign bram_addra     = cpu_imem_addr;
  assign cpu_imem_rdata = bram_douta;

  // Port B: CPU datales/skriv
  // Fasit: adresser < 0xFF00 er RAM (inkl. framebuffer 0xEC00-0xFEBF)
  //        adresser >= 0xFF00 er MMIO → rutes til io_inst
  assign bram_addrb     = vga_preload_active ? (nexa_pkg::FB_BASE + vga_preload_req_index) :
                          (disk_dma_active ? disk_dma_addr :
                          (exec_ram_active ? exec_ram_addr : cpu_dmem_addr));
  assign bram_dinb      = disk_dma_active ? disk_dma_wdata :
                          (exec_ram_active ? exec_ram_wdata : cpu_dmem_wdata);
  assign bram_web       = vga_preload_active ? 1'b0 :
                          (disk_dma_active ? disk_dma_we :
                          (exec_ram_active ? exec_ram_we : (cpu_dmem_we && (cpu_dmem_addr < IO_BASE))));
  assign cpu_dmem_rdata = bram_doutb;
  assign disk_dma_rdata = bram_doutb;

  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      exec_loader_state    <= EXEC_IDLE;
      exec_checked_halt    <= 1'b0;
      exec_cpu_hold        <= 1'b0;
      exec_ram_active      <= 1'b0;
      exec_ram_we          <= 1'b0;
      exec_ram_addr        <= '0;
      exec_ram_wdata       <= '0;
      exec_sector_count    <= '0;
      exec_file_size       <= '0;
      exec_sector_read_index <= '0;
      exec_load_index      <= '0;
      disk_ctrl_start_read <= 1'b0;
      disk_ctrl_sector     <= '0;
      disk_ctrl_mem_addr   <= '0;
    end else begin
      exec_ram_active      <= 1'b0;
      exec_ram_we          <= 1'b0;
      disk_ctrl_start_read <= 1'b0;

      case (exec_loader_state)
        EXEC_IDLE: begin
          if (!cpu_halted && !exec_cpu_hold)
            exec_checked_halt <= 1'b0;

          if (!vga_preload_active && cpu_halted && !exec_checked_halt)
            exec_loader_state <= EXEC_MAGIC_REQ;
        end

        EXEC_MAGIC_REQ: begin
          // WARNING: 0xEEFE/0xEEFF are handshake words inside general-purpose RAM.
          // A program that writes 0x4558 to 0xEEFE while halted will trigger the
          // exec-loader unintentionally. The OS must clear this region before
          // launching untrusted code, and programs should avoid allocating near it.
          exec_ram_active   <= 1'b1;
          exec_ram_addr     <= 16'hEEFE;
          exec_loader_state <= EXEC_MAGIC_WAIT;
        end

        EXEC_MAGIC_WAIT: begin
          exec_loader_state <= EXEC_MAGIC_SAMPLE;
        end

        EXEC_MAGIC_SAMPLE: begin
          if (bram_doutb == 16'h4558) begin
            exec_checked_halt <= 1'b1;
            exec_cpu_hold     <= 1'b1;
            exec_loader_state <= EXEC_COUNT_REQ;
          end else begin
            exec_checked_halt <= 1'b1;
            exec_loader_state <= EXEC_IDLE;
          end
        end

        EXEC_COUNT_REQ: begin
          exec_ram_active   <= 1'b1;
          exec_ram_addr     <= 16'hEE00;
          exec_loader_state <= EXEC_COUNT_WAIT;
        end

        EXEC_COUNT_WAIT: begin
          exec_loader_state <= EXEC_COUNT_SAMPLE;
        end

        EXEC_COUNT_SAMPLE: begin
          exec_sector_count <= bram_doutb[7:0];
          if ((bram_doutb[7:0] == 8'h00) || (bram_doutb[7:0] > 8'd251)) begin
            exec_cpu_hold     <= 1'b0;
            exec_loader_state <= EXEC_IDLE;
          end else begin
            exec_loader_state <= EXEC_SIZE_REQ;
          end
        end

        EXEC_SIZE_REQ: begin
          exec_ram_active   <= 1'b1;
          exec_ram_addr     <= 16'hEEFF;
          exec_loader_state <= EXEC_SIZE_WAIT;
        end

        EXEC_SIZE_WAIT: begin
          exec_loader_state <= EXEC_SIZE_SAMPLE;
        end

        EXEC_SIZE_SAMPLE: begin
          exec_file_size       <= bram_doutb;
          exec_sector_read_index <= '0;
          exec_loader_state    <= EXEC_LIST_REQ;
        end

        EXEC_LIST_REQ: begin
          if (exec_sector_read_index < exec_sector_count) begin
            exec_ram_active   <= 1'b1;
            exec_ram_addr     <= 16'hEE01 + exec_sector_read_index;
            exec_loader_state <= EXEC_LIST_WAIT;
          end else begin
            exec_load_index   <= '0;
            exec_loader_state <= EXEC_LOAD_START;
          end
        end

        EXEC_LIST_WAIT: begin
          exec_loader_state <= EXEC_LIST_SAMPLE;
        end

        EXEC_LIST_SAMPLE: begin
          exec_sector_table[exec_sector_read_index] <= bram_doutb[7:0];
          exec_sector_read_index <= exec_sector_read_index + 8'd1;
          exec_loader_state <= EXEC_LIST_REQ;
        end

        EXEC_LOAD_START: begin
          if (exec_load_index < exec_sector_count) begin
            disk_ctrl_sector     <= exec_sector_table[exec_load_index];
            disk_ctrl_mem_addr   <= {1'b0, exec_load_index, 7'b0};
            disk_ctrl_start_read <= 1'b1;
            exec_loader_state    <= EXEC_LOAD_WAIT;
          end else if (exec_file_size <= 16'd60400) begin
            exec_loader_state <= EXEC_HEAP_WRITE;
          end else begin
            exec_loader_state <= EXEC_CLEAR_MAGIC;
          end
        end

        EXEC_LOAD_WAIT: begin
          if (disk_ctrl_done || disk_ctrl_error) begin
            exec_load_index   <= exec_load_index + 8'd1;
            exec_loader_state <= EXEC_LOAD_START;
          end
        end

        EXEC_HEAP_WRITE: begin
          exec_ram_active   <= 1'b1;
          exec_ram_we       <= 1'b1;
          exec_ram_addr     <= 16'd60401;
          exec_ram_wdata    <= (exec_file_size < 16'd8192) ? 16'd8192 : exec_file_size;
          exec_loader_state <= EXEC_CLEAR_MAGIC;
        end

        EXEC_CLEAR_MAGIC: begin
          exec_ram_active   <= 1'b1;
          exec_ram_we       <= 1'b1;
          exec_ram_addr     <= 16'hEEFE;
          exec_ram_wdata    <= 16'h0000;
          exec_loader_state <= EXEC_RELEASE;
        end

        EXEC_RELEASE: begin
          exec_cpu_hold     <= 1'b0;
          exec_loader_state <= EXEC_IDLE;
        end

        default: exec_loader_state <= EXEC_IDLE;
      endcase
    end
  end

  // ─── VGA shadow framebuffer preload ────────────────────────
  // Copy the initialized framebuffer contents from BRAM into the VGA shadow
  // before releasing the CPU from reset. At 100 MHz this takes ~48 us.
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      vga_preload_active    <= ENABLE_VGA;
      vga_preload_pipe_valid<= 1'b0;
      vga_preload_valid     <= 1'b0;
      vga_preload_req_index <= '0;
      vga_preload_rsp_index <= '0;
      vga_preload_addr      <= '0;
      vga_preload_data      <= '0;
    end else begin
      vga_preload_valid <= 1'b0;
      if (ENABLE_VGA && vga_preload_active) begin
        if (!vga_preload_pipe_valid) begin
          vga_preload_pipe_valid <= 1'b1;
        end else begin
          vga_preload_valid <= 1'b1;
          vga_preload_addr  <= nexa_pkg::FB_BASE + vga_preload_rsp_index;
          vga_preload_data  <= bram_doutb;

          if (vga_preload_rsp_index < (nexa_pkg::FB_PIXEL_WORDS - 1))
            vga_preload_rsp_index <= vga_preload_rsp_index + 13'd1;
          else
            vga_preload_active <= 1'b0;
        end

        if (vga_preload_req_index < (nexa_pkg::FB_PIXEL_WORDS - 1))
          vga_preload_req_index <= vga_preload_req_index + 13'd1;
      end
    end
  end

  // ─── PS/2-tastatur (enkel implementasjon) ───────────────────
  nexa_ps2 ps2_inst (
    .clk      (clk),
    .rst      (rst),
    .ps2_clk  (ps2_clk),
    .ps2_data (ps2_data),
    .ascii    (kbd_ascii),
    .valid    (kbd_valid)
  );

  // ─── 7-segment display (4-sifret, Basys 3) ──────────────────
  // Viser PC (alle 4 hex-sifre) når kjørende
  // Dersom halted: vis 0xDEAD
  logic [15:0] seg_data;
  assign seg_data = cpu_halted ? 16'hDEAD : dbg_pc;

  nexa_7seg seg_inst (
    .clk  (clk),
    .rst  (rst),
    .data (seg_data),
    .seg  (seg),
    .an   (an)
  );

  // ─── LED-indikatorer ────────────────────────────────────────
  // Øverste byte: STATUS, nedre byte: PC[7:0]
  always_ff @(posedge clk) begin
    if (cpu_halted)
      led <= 16'hDEAD;
    else
      led <= {dbg_status[7:0], dbg_pc[7:0]};
  end

  // ─── VGA renderer ───────────────────────────────────────────
  // Uses a shadow framebuffer fed by CPU stores into 0xEC00–0xFEBF.
  // This keeps the CPU's dual-port BRAM model unchanged while enabling
  // live VGA output with the same text/pixel scaling as the JS frontend.
  generate
    if (ENABLE_VGA) begin : gen_vga
      nexa_vga vga_inst (
        .clk      (clk),
        .rst      (rst),
        .disp_mode(disp_mode_live),
        .fb_load_we(vga_preload_valid),
        .fb_load_addr(vga_preload_addr),
        .fb_load_data(vga_preload_data),
        .fb_we    ((disk_dma_active && disk_dma_we &&
                   (disk_dma_addr >= nexa_pkg::FB_BASE) &&
                   (disk_dma_addr <= nexa_pkg::FB_PIXEL_END)) ||
                   (!disk_dma_active && cpu_dmem_we &&
                   (cpu_dmem_addr >= nexa_pkg::FB_BASE) &&
                   (cpu_dmem_addr <= nexa_pkg::FB_PIXEL_END))),
        .fb_addr  (disk_dma_active ? disk_dma_addr : cpu_dmem_addr),
        .fb_wdata (disk_dma_active ? disk_dma_wdata : cpu_dmem_wdata),
        .vga_r    (vga_r),
        .vga_g    (vga_g),
        .vga_b    (vga_b),
        .vga_hs   (vga_hs),
        .vga_vs   (vga_vs)
      );
    end else begin : gen_no_vga
      assign vga_r  = 4'h0;
      assign vga_g  = 4'h0;
      assign vga_b  = 4'h0;
      assign vga_hs = 1'b1;
      assign vga_vs = 1'b1;
    end
  endgenerate

endmodule

// ═══════════════════════════════════════════════════════════
// nexa_ps2 — Enkel PS/2-tastatur-dekoder (set-2 → keycode)
// ═══════════════════════════════════════════════════════════
module nexa_ps2 (
  input  logic       clk,
  input  logic       rst,
  input  logic       ps2_clk,
  input  logic       ps2_data,
  output logic [7:0] ascii,
  output logic       valid
);
  logic [2:0]  ps2_clk_sync;
  logic [2:0]  ps2_data_sync;
  logic [10:0] frame_bits;
  logic [3:0]  bit_count;
  logic        break_pending;
  logic        extended_pending;
  logic        shift_active;
  logic        caps_lock;

  function automatic logic is_shift_scancode(input logic [7:0] scancode);
    is_shift_scancode = (scancode == 8'h12) || (scancode == 8'h59);
  endfunction

  function automatic logic [7:0] keycode_for_scancode(
    input logic [7:0] scancode,
    input logic       shift,
    input logic       caps,
    input logic       extended
  );
    logic upper_case;
    begin
      upper_case = shift ^ caps;
      if (extended) begin
        case (scancode)
          8'h6B: keycode_for_scancode = 8'd130;
          8'h75: keycode_for_scancode = 8'd131;
          8'h74: keycode_for_scancode = 8'd132;
          8'h72: keycode_for_scancode = 8'd133;
          8'h6C: keycode_for_scancode = 8'd134;
          8'h69: keycode_for_scancode = 8'd135;
          8'h7D: keycode_for_scancode = 8'd136;
          8'h7A: keycode_for_scancode = 8'd137;
          8'h70: keycode_for_scancode = 8'd138;
          8'h71: keycode_for_scancode = 8'd139;
          8'h5A: keycode_for_scancode = 8'h0A;
          8'h4A: keycode_for_scancode = 8'h2F;
          default: keycode_for_scancode = 8'h00;
        endcase
      end else begin
        case (scancode)
          8'h1C: keycode_for_scancode = upper_case ? 8'h41 : 8'h61;
          8'h32: keycode_for_scancode = upper_case ? 8'h42 : 8'h62;
          8'h21: keycode_for_scancode = upper_case ? 8'h43 : 8'h63;
          8'h23: keycode_for_scancode = upper_case ? 8'h44 : 8'h64;
          8'h24: keycode_for_scancode = upper_case ? 8'h45 : 8'h65;
          8'h2B: keycode_for_scancode = upper_case ? 8'h46 : 8'h66;
          8'h34: keycode_for_scancode = upper_case ? 8'h47 : 8'h67;
          8'h33: keycode_for_scancode = upper_case ? 8'h48 : 8'h68;
          8'h43: keycode_for_scancode = upper_case ? 8'h49 : 8'h69;
          8'h3B: keycode_for_scancode = upper_case ? 8'h4A : 8'h6A;
          8'h42: keycode_for_scancode = upper_case ? 8'h4B : 8'h6B;
          8'h4B: keycode_for_scancode = upper_case ? 8'h4C : 8'h6C;
          8'h3A: keycode_for_scancode = upper_case ? 8'h4D : 8'h6D;
          8'h31: keycode_for_scancode = upper_case ? 8'h4E : 8'h6E;
          8'h44: keycode_for_scancode = upper_case ? 8'h4F : 8'h6F;
          8'h4D: keycode_for_scancode = upper_case ? 8'h50 : 8'h70;
          8'h15: keycode_for_scancode = upper_case ? 8'h51 : 8'h71;
          8'h2D: keycode_for_scancode = upper_case ? 8'h52 : 8'h72;
          8'h1B: keycode_for_scancode = upper_case ? 8'h53 : 8'h73;
          8'h2C: keycode_for_scancode = upper_case ? 8'h54 : 8'h74;
          8'h3C: keycode_for_scancode = upper_case ? 8'h55 : 8'h75;
          8'h2A: keycode_for_scancode = upper_case ? 8'h56 : 8'h76;
          8'h1D: keycode_for_scancode = upper_case ? 8'h57 : 8'h77;
          8'h22: keycode_for_scancode = upper_case ? 8'h58 : 8'h78;
          8'h35: keycode_for_scancode = upper_case ? 8'h59 : 8'h79;
          8'h1A: keycode_for_scancode = upper_case ? 8'h5A : 8'h7A;
          8'h16: keycode_for_scancode = shift ? 8'h21 : 8'h31;
          8'h1E: keycode_for_scancode = shift ? 8'h40 : 8'h32;
          8'h26: keycode_for_scancode = shift ? 8'h23 : 8'h33;
          8'h25: keycode_for_scancode = shift ? 8'h24 : 8'h34;
          8'h2E: keycode_for_scancode = shift ? 8'h25 : 8'h35;
          8'h36: keycode_for_scancode = shift ? 8'h5E : 8'h36;
          8'h3D: keycode_for_scancode = shift ? 8'h26 : 8'h37;
          8'h3E: keycode_for_scancode = shift ? 8'h2A : 8'h38;
          8'h46: keycode_for_scancode = shift ? 8'h28 : 8'h39;
          8'h45: keycode_for_scancode = shift ? 8'h29 : 8'h30;
          8'h4E: keycode_for_scancode = shift ? 8'h5F : 8'h2D;
          8'h55: keycode_for_scancode = shift ? 8'h2B : 8'h3D;
          8'h54: keycode_for_scancode = shift ? 8'h7B : 8'h5B;
          8'h5B: keycode_for_scancode = shift ? 8'h7D : 8'h5D;
          8'h5D: keycode_for_scancode = shift ? 8'h7C : 8'h5C;
          8'h4C: keycode_for_scancode = shift ? 8'h3A : 8'h3B;
          8'h52: keycode_for_scancode = shift ? 8'h22 : 8'h27;
          8'h41: keycode_for_scancode = shift ? 8'h3C : 8'h2C;
          8'h49: keycode_for_scancode = shift ? 8'h3E : 8'h2E;
          8'h4A: keycode_for_scancode = shift ? 8'h3F : 8'h2F;
          8'h0E: keycode_for_scancode = shift ? 8'h7E : 8'h60;
          8'h29: keycode_for_scancode = 8'h20;
          8'h5A: keycode_for_scancode = 8'h0A;
          8'h66: keycode_for_scancode = 8'h08;
          8'h0D: keycode_for_scancode = 8'h09;
          8'h76: keycode_for_scancode = 8'h1B;
          8'h05: keycode_for_scancode = 8'd141;
          8'h06: keycode_for_scancode = 8'd142;
          8'h04: keycode_for_scancode = 8'd143;
          8'h0C: keycode_for_scancode = 8'd144;
          8'h03: keycode_for_scancode = 8'd145;
          8'h0B: keycode_for_scancode = 8'd146;
          8'h83: keycode_for_scancode = 8'd147;
          8'h0A: keycode_for_scancode = 8'd148;
          8'h01: keycode_for_scancode = 8'd149;
          8'h09: keycode_for_scancode = 8'd150;
          8'h78: keycode_for_scancode = 8'd151;
          8'h07: keycode_for_scancode = 8'd152;
          default: keycode_for_scancode = 8'h00;
        endcase
      end
    end
  endfunction

  wire ps2_falling_edge = (ps2_clk_sync[2:1] == 2'b10);
  wire sampled_data     = ps2_data_sync[2];

  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      ps2_clk_sync     <= 3'b111;
      ps2_data_sync    <= 3'b111;
      frame_bits       <= '0;
      bit_count        <= '0;
      break_pending    <= 1'b0;
      extended_pending <= 1'b0;
      shift_active     <= 1'b0;
      caps_lock        <= 1'b0;
      ascii            <= 8'h00;
      valid            <= 1'b0;
    end else begin
      ps2_clk_sync  <= {ps2_clk_sync[1:0], ps2_clk};
      ps2_data_sync <= {ps2_data_sync[1:0], ps2_data};
      valid         <= 1'b0;

      if (ps2_falling_edge) begin
        if (bit_count == 4'd0) begin
          if (!sampled_data) begin
            frame_bits[0] <= 1'b0;
            bit_count     <= 4'd1;
          end
        end else begin
          frame_bits[bit_count] <= sampled_data;
          if (bit_count == 4'd10) begin
            bit_count <= 4'd0;
            if ((frame_bits[0] == 1'b0) &&
                (sampled_data == 1'b1) &&
                ((^frame_bits[8:1] ^ frame_bits[9]) == 1'b1)) begin
              if (frame_bits[8:1] == 8'hE0) begin
                extended_pending <= 1'b1;
              end else if (frame_bits[8:1] == 8'hF0) begin
                break_pending <= 1'b1;
              end else begin
                if (is_shift_scancode(frame_bits[8:1])) begin
                  shift_active <= !break_pending;
                end else if (frame_bits[8:1] == 8'h58) begin
                  if (!break_pending)
                    caps_lock <= ~caps_lock;
                end else if (!break_pending) begin
                  ascii <= keycode_for_scancode(frame_bits[8:1], shift_active, caps_lock, extended_pending);
                  valid <= (keycode_for_scancode(frame_bits[8:1], shift_active, caps_lock, extended_pending) != 8'h00);
                end
                break_pending    <= 1'b0;
                extended_pending <= 1'b0;
              end
            end else begin
              // Bad parity or bad stop bit: discard this frame but preserve
              // break_pending / extended_pending so a noisy data byte following
              // a valid 0xF0 or 0xE0 prefix does not silently drop the modifier.
            end
          end else begin
            bit_count <= bit_count + 1'b1;
          end
        end
      end
    end
  end
endmodule

// ═══════════════════════════════════════════════════════════
// nexa_7seg — 4-sifret 7-segment multiplekser (Basys 3)
// ═══════════════════════════════════════════════════════════
module nexa_7seg (
  input  logic        clk,
  input  logic        rst,
  input  logic [15:0] data,
  output logic [7:0]  seg,
  output logic [3:0]  an
);
  logic [1:0]  digit_sel;
  logic [15:0] refresh_cnt;

  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      refresh_cnt <= '0;
      digit_sel   <= '0;
    end else begin
      refresh_cnt <= refresh_cnt + 1'b1;
      if (refresh_cnt == 16'd50000) begin
        refresh_cnt <= '0;
        digit_sel   <= digit_sel + 1'b1;
      end
    end
  end

  logic [3:0] nibble;
  always @* begin
    case (digit_sel)
      2'd0: nibble = data[3:0];
      2'd1: nibble = data[7:4];
      2'd2: nibble = data[11:8];
      2'd3: nibble = data[15:12];
    endcase

    // 4 anoder, aktiv lav
    an = ~(4'h1 << digit_sel);

    // 7-segment hex-koding (aktiv lav: seg={DP,CG,CF,CE,CD,CC,CB,CA})
    case (nibble)
      4'h0: seg = 8'b11000000;
      4'h1: seg = 8'b11111001;
      4'h2: seg = 8'b10100100;
      4'h3: seg = 8'b10110000;
      4'h4: seg = 8'b10011001;
      4'h5: seg = 8'b10010010;
      4'h6: seg = 8'b10000010;
      4'h7: seg = 8'b11111000;
      4'h8: seg = 8'b10000000;
      4'h9: seg = 8'b10010000;
      4'hA: seg = 8'b10001000;
      4'hB: seg = 8'b10000011;
      4'hC: seg = 8'b11000110;
      4'hD: seg = 8'b10100001;
      4'hE: seg = 8'b10000110;
      4'hF: seg = 8'b10001110;
      default: seg = 8'b11111111;
    endcase
  end
endmodule
