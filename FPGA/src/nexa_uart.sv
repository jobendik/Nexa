// ============================================================
// nexa_uart.sv  —  Enkel 8N1 UART Sender/Mottaker
//
// Parametere:
//   CLK_HZ     : Systemklokkfrekvens (standard 100 MHz)
//   BAUD_RATE  : Baudrate (standard 115200)
//
// Sender:
//   tx_data   : Byte å sende
//   tx_valid  : Puls for å starte sending
//   tx_ready  : Høy når klar til å sende
//   tx        : Seriell TX-linje
//
// Mottaker:
//   rx_data   : Mottatt byte
//   rx_valid  : Høy i én syklus når byte er klar
//   rx        : Seriell RX-linje
// ============================================================
`timescale 1ns/1ps

module nexa_uart #(
  parameter int CLK_HZ    = 100_000_000,   // 100 MHz systemklokke
  parameter int BAUD_RATE = 115_200         // 115200 baud
)(
  input  logic       clk,
  input  logic       rst_n,

  // Sender
  input  logic [7:0] tx_data,
  input  logic       tx_valid,
  output logic       tx_ready,
  output logic       tx,

  // Mottaker
  output logic [7:0] rx_data,
  output logic       rx_valid,
  input  logic       rx
);

  // ── Baud-rate generator ───────────────────────────────────
  localparam int BAUD_DIV  = CLK_HZ / BAUD_RATE;          // ~868 ved 100MHz/115200
  localparam int BAUD_HALF = BAUD_DIV / 2;                 // Midt i bit-perioden

  // ── SENDER ────────────────────────────────────────────────
  typedef enum logic [1:0] {
    TX_IDLE  = 2'd0,
    TX_START = 2'd1,
    TX_DATA  = 2'd2,
    TX_STOP  = 2'd3
  } tx_state_t;

  tx_state_t   tx_state;
  logic [15:0] tx_baud_cnt;
  logic [7:0]  tx_shift;     // Skiftregister
  logic [3:0]  tx_bit_cnt;   // Bit-teller (0–7)

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      tx_state    <= TX_IDLE;
      tx_baud_cnt <= '0;
      tx_shift    <= '0;
      tx_bit_cnt  <= '0;
      tx          <= 1'b1;   // Idle = høy
      tx_ready    <= 1'b1;
    end else begin
      case (tx_state)

        TX_IDLE: begin
          tx       <= 1'b1;
          tx_ready <= 1'b1;
          if (tx_valid) begin
            tx_shift    <= tx_data;
            tx_baud_cnt <= '0;
            tx_state    <= TX_START;
            tx_ready    <= 1'b0;
          end
        end

        TX_START: begin
          tx <= 1'b0;  // Start-bit (lav)
          if (tx_baud_cnt >= BAUD_DIV - 1) begin
            tx_baud_cnt <= '0;
            tx_bit_cnt  <= '0;
            tx_state    <= TX_DATA;
          end else
            tx_baud_cnt <= tx_baud_cnt + 1;
        end

        TX_DATA: begin
          tx <= tx_shift[0];   // LSB først (8N1 standard)
          if (tx_baud_cnt >= BAUD_DIV - 1) begin
            tx_baud_cnt <= '0;
            tx_shift    <= {1'b0, tx_shift[7:1]};   // Skift høyre
            if (tx_bit_cnt >= 4'd7) begin
              tx_state <= TX_STOP;
            end else begin
              tx_bit_cnt <= tx_bit_cnt + 1;
            end
          end else
            tx_baud_cnt <= tx_baud_cnt + 1;
        end

        TX_STOP: begin
          tx <= 1'b1;   // Stop-bit (høy)
          if (tx_baud_cnt >= BAUD_DIV - 1) begin
            tx_baud_cnt <= '0;
            tx_state    <= TX_IDLE;
            tx_ready    <= 1'b1;
          end else
            tx_baud_cnt <= tx_baud_cnt + 1;
        end

      endcase
    end
  end

  // ── MOTTAKER ──────────────────────────────────────────────
  typedef enum logic [1:0] {
    RX_IDLE  = 2'd0,
    RX_START = 2'd1,
    RX_DATA  = 2'd2,
    RX_STOP  = 2'd3
  } rx_state_t;

  rx_state_t   rx_state;
  logic [15:0] rx_baud_cnt;
  logic [7:0]  rx_shift;
  logic [3:0]  rx_bit_cnt;
  logic        rx_sync1, rx_sync2;   // Synkronisering (metastabilitet)

  // Dobbel-flip-flop synkronisering for RX
  always_ff @(posedge clk) begin
    rx_sync1 <= rx;
    rx_sync2 <= rx_sync1;
  end

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      rx_state    <= RX_IDLE;
      rx_baud_cnt <= '0;
      rx_shift    <= '0;
      rx_bit_cnt  <= '0;
      rx_data     <= '0;
      rx_valid    <= 1'b0;
    end else begin
      rx_valid <= 1'b0;   // Standardverdi: ikke gyldig

      case (rx_state)

        RX_IDLE: begin
          if (!rx_sync2) begin   // Start-bit detektert (falling edge)
            rx_baud_cnt <= '0;
            rx_state    <= RX_START;
          end
        end

        RX_START: begin
          // Vent til midt i start-biten for å verifisere
          if (rx_baud_cnt >= BAUD_HALF - 1) begin
            if (!rx_sync2) begin   // Fortsatt lav = gyldig start-bit
              rx_baud_cnt <= '0;
              rx_bit_cnt  <= '0;
              rx_state    <= RX_DATA;
            end else begin
              rx_state <= RX_IDLE;   // Støy, prøv igjen
            end
          end else
            rx_baud_cnt <= rx_baud_cnt + 1;
        end

        RX_DATA: begin
          if (rx_baud_cnt >= BAUD_DIV - 1) begin
            rx_baud_cnt <= '0;
            // Sample midt i bit-perioden
            rx_shift    <= {rx_sync2, rx_shift[7:1]};   // LSB-first
            if (rx_bit_cnt >= 4'd7) begin
              rx_state <= RX_STOP;
            end else begin
              rx_bit_cnt <= rx_bit_cnt + 1;
            end
          end else
            rx_baud_cnt <= rx_baud_cnt + 1;
        end

        RX_STOP: begin
          if (rx_baud_cnt >= BAUD_DIV - 1) begin
            rx_baud_cnt <= '0;
            if (rx_sync2) begin   // Stop-bit = høy (gyldig)
              rx_data  <= rx_shift;
              rx_valid <= 1'b1;
            end
            rx_state <= RX_IDLE;
          end else
            rx_baud_cnt <= rx_baud_cnt + 1;
        end

      endcase
    end
  end

endmodule : nexa_uart
