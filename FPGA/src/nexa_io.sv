// nexa_io.sv — Nexa-16 MMIO-system
// Fasit: devices.js, memory.js
`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_io #(
  parameter int CLK_HZ = 100_000_000
) (
  input  logic        clk,
  input  logic        rst,
  input  logic [15:0] addr,
  input  logic [15:0] wdata,
  input  logic        we,
  input  logic        re,
  output logic [15:0] rdata,
  output logic        rdata_valid,
  output logic [7:0]  irq_pending,
  output logic [7:0]  irq_mask,
  output logic        disp_mode_out,
  input  logic        disk_irq_done,
  input  logic [7:0]  kbd_ascii,
  input  logic        kbd_valid,
  input  logic        uart_rx_in,
  output logic        uart_tx_out
);

  // ─── Tastatur ───────────────────────────────────────────────
  logic [7:0] kbd_data_reg;
  logic       kbd_status;

  // ─── Timer ──────────────────────────────────────────────────
  logic        timer_en;
  logic [15:0] timer_interval;
  logic [15:0] timer_counter;
  logic        timer_irq;
  logic [31:0] timer_ms_count;
  logic [31:0] timer_ms_residue;

  // ─── UART ───────────────────────────────────────────────────
  logic [7:0] uart_rx_data;
  logic       uart_rx_valid;          // puls: byte klar fra UART-kjerne
  logic       uart_rx_status;         // latch: byte venter på lesing
  logic       uart_tx_ready;
  logic       uart_tx_valid_r;
  logic [7:0] uart_tx_data_r;
  logic       uart_tx_ready_prev;     // for stigende-flanke deteksjon

  // ─── Display ────────────────────────────────────────────────
  logic        disp_mode;
  logic [15:0] disp_cursor;

  // ─── Sound (3 tone + 1 noise, register-only MMIO model) ───
  logic [15:0] sound_period  [0:3];
  logic [15:0] sound_control [0:3];
  logic        sound_pwm;
  logic [7:0]  sound_mix_level;
  logic signed [11:0] sound_mix_sample;

  // ─── SystemControl ──────────────────────────────────────────
  logic [7:0] sys_pending_r;
  logic [7:0] sys_mask_r;

  // ─── UART-kjerne ────────────────────────────────────────────
  nexa_uart #(.CLK_HZ(CLK_HZ), .BAUD_RATE(115200)) uart_inst (
    .clk      (clk),
    .rst_n    (~rst),
    .tx_data  (uart_tx_data_r),
    .tx_valid (uart_tx_valid_r),
    .tx_ready (uart_tx_ready),
    .tx       (uart_tx_out),
    .rx_data  (uart_rx_data),
    .rx_valid (uart_rx_valid),
    .rx       (uart_rx_in)
  );

  // ─── Lydgenerator ─────────────────────────────────────────
  // Drives directly from the MMIO sound register bank. The current top-level
  // does not route PWM to a physical pin yet, but simulation and future board
  // bindings can observe this generator through the internal nets.
  nexa_sound #(.CLK_HZ(CLK_HZ)) sound_gen_inst (
    .clk           (clk),
    .rst           (rst),
    .sound_period  (sound_period),
    .sound_control (sound_control),
    .audio_pwm     (sound_pwm),
    .mix_level_dbg (sound_mix_level),
    .mix_sample_dbg(sound_mix_sample)
  );

  // ─── UART TX trigger ────────────────────────────────────────
  // Puls uart_tx_valid_r én syklus når CPU skriver til 0xFF21
  // og TX-en er klar. Lagre data i register.
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      uart_tx_valid_r <= 1'b0;
      uart_tx_data_r  <= '0;
    end else begin
      uart_tx_valid_r <= 1'b0;  // standard: ikke send
      if (we && (addr == 16'hFF21) && uart_tx_ready) begin
        uart_tx_valid_r <= 1'b1;
        uart_tx_data_r  <= wdata[7:0];
      end
    end
  end

  // ─── UART TX IRQ — stigende flanke på uart_tx_ready ─────────
  // Sender er ferdig når uart_tx_ready går fra lav til høy
  always_ff @(posedge clk or posedge rst) begin
    if (rst) uart_tx_ready_prev <= 1'b1;
    else     uart_tx_ready_prev <= uart_tx_ready;
  end
  wire uart_tx_done = uart_tx_ready && !uart_tx_ready_prev;

  // ─── UART RX latch ──────────────────────────────────────────
  // Latcher mottatt byte; clears ved lesing av 0xFF23
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      uart_rx_status <= 1'b0;
    end else begin
      if (uart_rx_valid)
        uart_rx_status <= 1'b1;
      if (re && (addr == 16'hFF23))
        uart_rx_status <= 1'b0;
    end
  end

  // ─── Tastatur ───────────────────────────────────────────────
  // Samlet i én blokk for å unngå multiple-driver på kbd_status.
  // NOTE: Dette er en 1-byte buffer, ikke en FIFO. Innkommende tegn blir
  // tapt dersom CPU-en ikke leser 0xFF01 før neste tegn ankommer
  // (f.eks. under lang interrupt-latens eller exec-loader hold).
  // For å unngå tap ved rask skriving: les 0xFF01 umiddelbart etter 0xFF00.
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      kbd_data_reg <= '0;
      kbd_status   <= 1'b0;
    end else begin
      if (kbd_valid && !kbd_status) begin
        kbd_data_reg <= kbd_ascii;
        kbd_status   <= 1'b1;
      end
      // Slett status ved lesing av tastatur-data (0xFF01)
      if (re && (addr == 16'hFF01))
        kbd_status <= 1'b0;
    end
  end

  // ─── Timer + Timer-MMIO-skriv (samlet i én blokk) ───────────
  // timer_counter drives fra både timer-logikk og MMIO-skriv →
  // må være i samme always_ff for å unngå multiple-driver.
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      timer_en <= '0; timer_interval <= '0;
      timer_counter <= '0; timer_irq <= '0;
      timer_ms_count <= '0; timer_ms_residue <= '0;
    end else begin
      timer_irq <= '0;
      // Monotonic millisecond clock derived from FPGA wall-clock.
      // 0xFF13/0xFF14 expose the low/high 16-bit words of this counter.
      if (timer_ms_residue >= (CLK_HZ - 1000)) begin
        timer_ms_residue <= timer_ms_residue + 32'd1000 - CLK_HZ;
        timer_ms_count   <= timer_ms_count + 32'd1;
      end else begin
        timer_ms_residue <= timer_ms_residue + 32'd1000;
      end
      // MMIO timer-skriv (override teller og konfig)
      if (we && ((addr & 16'hFFF0) == 16'hFF10)) begin
        case (addr[3:0])
          4'h0: begin
            timer_en <= wdata[0];
            if (!wdata[0]) timer_counter <= '0;
          end
          4'h1: begin
            timer_interval <= wdata;
            timer_counter  <= '0;
          end
          default: ;
        endcase
      end else begin
        // Normal timer-telling (kun om enabled og interval er satt)
        if (timer_en && timer_interval != 16'h0) begin
          if (timer_counter + 1 >= timer_interval) begin
            timer_counter <= '0;
            timer_irq     <= 1'b1;
          end else begin
            timer_counter <= timer_counter + 1'b1;
          end
        end
      end
    end
  end

  // ─── IRQ neste-tilstand (kombinasjonell) ────────────────────
  // Bruker always_comb + enkelt NBA for å unngå NBS-konflikt:
  // bit-sett og full-ord-nullstill i samme syklus ville kollidert.
  logic [7:0] sys_pending_next;

  always @* begin
    sys_pending_next = sys_pending_r;
    if (timer_irq)     sys_pending_next[IRQ_TIMER]   = 1'b1;
    if (kbd_valid)     sys_pending_next[IRQ_KBD]     = 1'b1;
    if (uart_rx_valid) sys_pending_next[IRQ_UART_RX] = 1'b1;
    if (uart_tx_done)  sys_pending_next[IRQ_UART_TX] = 1'b1;
    if (disk_irq_done) sys_pending_next[IRQ_DISK]    = 1'b1;
    // Acknowledge: pending &= ~value (skriv til 0xFFF0)
    if (we && (addr == 16'hFFF0))
      sys_pending_next = sys_pending_next & ~wdata[7:0];
  end

  // ─── IRQ-aggregering ────────────────────────────────────────
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      sys_pending_r <= '0;
      sys_mask_r    <= '0;
    end else begin
      sys_pending_r <= sys_pending_next;
      if (we && (addr == 16'hFFF1))
        sys_mask_r <= wdata[7:0];
    end
  end

  assign irq_pending   = sys_pending_r;
  assign irq_mask      = sys_mask_r;
  assign disp_mode_out = disp_mode;

  // ─── MMIO Les ───────────────────────────────────────────────
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      rdata <= '0; rdata_valid <= '0;
    end else begin
      rdata_valid <= '0;
      if (re) begin
        rdata_valid <= 1'b1;
        case (addr & 16'hFFF0)
          16'hFF00: case (addr[3:0])  // Keyboard
            4'h0: rdata <= {15'h0, kbd_status};
            4'h1: rdata <= {8'h0, kbd_data_reg};  // status slettet i kbd-blokk
            default: rdata <= '0;
          endcase
          16'hFF10: case (addr[3:0])  // Timer
            4'h0: rdata <= {15'h0, timer_en};
            4'h1: rdata <= timer_interval;
            4'h2: rdata <= timer_counter;
            4'h3: rdata <= timer_ms_count[15:0];
            4'h4: rdata <= timer_ms_count[31:16];
            default: rdata <= '0;
          endcase
          16'hFF20: case (addr[3:0])  // UART
            4'h0: rdata <= {15'h0, uart_tx_ready};   // TX status
            4'h1: rdata <= '0;
            4'h2: rdata <= {15'h0, uart_rx_status};  // RX status
            4'h3: rdata <= {8'h0, uart_rx_data};     // RX data
            default: rdata <= '0;
          endcase
          16'hFF30: case (addr[3:0])  // Display
            4'h0: rdata <= {15'h0, disp_mode};
            4'h1: rdata <= disp_cursor;
            default: rdata <= '0;
          endcase
          16'hFF40: case (addr[3:0])  // Sound
            4'h0: rdata <= sound_period[0];
            4'h1: rdata <= sound_control[0];
            4'h2: rdata <= sound_period[1];
            4'h3: rdata <= sound_control[1];
            4'h4: rdata <= sound_period[2];
            4'h5: rdata <= sound_control[2];
            4'h6: rdata <= sound_period[3];
            4'h7: rdata <= sound_control[3];
            default: rdata <= '0;
          endcase
          16'hFFF0: case (addr[3:0])  // SystemControl
            4'h0: rdata <= {8'h0, sys_pending_r};
            4'h1: rdata <= {8'h0, sys_mask_r};
            default: rdata <= '0;
          endcase
          default: rdata <= '0;
        endcase
      end
    end
  end

  // ─── MMIO Skriv — display ───────────────────────────────────
  // Timer-skriv håndteres i timer-blokken over (for å unngå
  // multiple-driver på timer_counter/timer_en/timer_interval).
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      disp_mode <= '0; disp_cursor <= '0;
    end else if (we && ((addr & 16'hFFF0) == 16'hFF30)) begin
      case (addr[3:0])
        4'h0: disp_mode   <= wdata[0];
        4'h1: disp_cursor <= wdata;
        default: ;
      endcase
    end
  end

  // ─── MMIO Skriv — sound ────────────────────────────────────
  integer sound_idx;
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      for (sound_idx = 0; sound_idx < 4; sound_idx = sound_idx + 1) begin
        sound_period[sound_idx]  <= '0;
        sound_control[sound_idx] <= '0;
      end
    end else if (we && ((addr & 16'hFFF0) == 16'hFF40)) begin
      case (addr[3:0])
        4'h0: sound_period[0]  <= wdata;
        4'h1: sound_control[0] <= wdata;
        4'h2: sound_period[1]  <= wdata;
        4'h3: sound_control[1] <= wdata;
        4'h4: sound_period[2]  <= wdata;
        4'h5: sound_control[2] <= wdata;
        4'h6: sound_period[3]  <= wdata;
        4'h7: sound_control[3] <= wdata;
        default: ;
      endcase
    end
  end

endmodule
