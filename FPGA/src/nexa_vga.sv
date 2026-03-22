// ============================================================
// nexa_vga.sv — 640x480 VGA renderer for Nexa-16 framebuffer
//
// Uses a shadow framebuffer updated from CPU writes so VGA output
// does not consume an extra port on the main CPU BRAM.
//
// Text mode matches the JS renderer:
//   - 80x30 cells at 8x16 pixels
//   - 8x8 font doubled vertically
//   - word layout: [15:12]=BG [11:8]=FG [7:0]=ASCII
//
// Pixel mode matches the JS renderer:
//   - 160x120 logical pixels
//   - 4x vertical/horizontal scale to 640x480
//   - word layout: 4 packed 4-bit palette entries
// ============================================================
`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_vga #(
  parameter INIT_FILE = ""
) (
  input  logic        clk,
  input  logic        rst,
  input  logic        disp_mode,
  input  logic        fb_load_we,
  input  logic [15:0] fb_load_addr,
  input  logic [15:0] fb_load_data,
  input  logic        fb_we,
  input  logic [15:0] fb_addr,
  input  logic [15:0] fb_wdata,
  output logic [3:0]  vga_r,
  output logic [3:0]  vga_g,
  output logic [3:0]  vga_b,
  output logic        vga_hs,
  output logic        vga_vs
);

  localparam int H_ACTIVE = 640;
  localparam int H_FRONT  = 16;
  localparam int H_SYNC   = 96;
  localparam int H_BACK   = 48;
  localparam int H_TOTAL  = H_ACTIVE + H_FRONT + H_SYNC + H_BACK;

  localparam int V_ACTIVE = 480;
  localparam int V_FRONT  = 10;
  localparam int V_SYNC   = 2;
  localparam int V_BACK   = 33;
  localparam int V_TOTAL  = V_ACTIVE + V_FRONT + V_SYNC + V_BACK;

  // Pixel clock: 100 MHz / 4 = 25.000 MHz via pix_div[1] clock-enable.
  // VESA 640x480@60Hz standard requires 25.175 MHz, giving ~59.52 Hz actual.
  // Most monitors accept this deviation. For exact compliance, replace with a
  // Vivado MMCM/PLL generating 25.175 MHz and use that clock directly instead
  // of the clock-enable divider.
  logic [1:0] pix_div;
  logic [9:0] h_count;
  logic [9:0] v_count;
  logic [15:0] fb_shadow [0:FB_PIXEL_WORDS-1];
  logic [11:0] rgb_word;
  logic        active_video;
  logic        pixel_tick;
  logic [15:0] fb_word;
  logic [15:0] text_fb_word;
  logic [15:0] pixel_fb_word;
  logic [7:0]  glyph_bits;
  logic [3:0]  pixel_color_idx;
  logic [12:0] text_fb_index;
  logic [12:0] pixel_fb_index;
  integer      idx;
  reg   [15:0] init_mem [0:16'hFFFF];

  assign pixel_tick = (pix_div == 2'd3);

  initial begin
    if (INIT_FILE != "") begin
      $readmemh(INIT_FILE, init_mem);
      for (idx = 0; idx < FB_PIXEL_WORDS; idx = idx + 1)
        fb_shadow[idx] = init_mem[FB_BASE + idx];
    end else begin
      for (idx = 0; idx < FB_PIXEL_WORDS; idx = idx + 1)
        fb_shadow[idx] = '0;
    end
  end

  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      pix_div  <= '0;
      h_count  <= '0;
      v_count  <= '0;
    end else begin
      pix_div <= pix_div + 2'd1;
      if (fb_load_we && (fb_load_addr >= FB_BASE) && (fb_load_addr <= FB_PIXEL_END))
        fb_shadow[fb_load_addr - FB_BASE] <= fb_load_data;
      else if (fb_we && (fb_addr >= FB_BASE) && (fb_addr <= FB_PIXEL_END))
        fb_shadow[fb_addr - FB_BASE] <= fb_wdata;

      if (pixel_tick) begin
        if (h_count == H_TOTAL - 1) begin
          h_count <= '0;
          if (v_count == V_TOTAL - 1)
            v_count <= '0;
          else
            v_count <= v_count + 10'd1;
        end else begin
          h_count <= h_count + 10'd1;
        end
      end
    end
  end

  assign active_video = (h_count < H_ACTIVE) && (v_count < V_ACTIVE);
  assign text_fb_index = (v_count[8:4] * FB_TEXT_COLS) + h_count[9:3];
  assign pixel_fb_index = (v_count[8:2] * FB_PIXEL_COLS) + h_count[9:4];
  assign text_fb_word = (text_fb_index < FB_TEXT_WORDS) ? fb_shadow[text_fb_index] : 16'h0000;
  assign pixel_fb_word = (pixel_fb_index < FB_PIXEL_WORDS) ? fb_shadow[pixel_fb_index] : 16'h0000;
  assign fb_word = disp_mode ? pixel_fb_word : text_fb_word;
  assign glyph_bits = active_video && !disp_mode ? font_row(text_fb_word[7:0], v_count[3:1]) : 8'h00;

  always @* begin
    case (h_count[3:2])
      2'd0: pixel_color_idx = pixel_fb_word[15:12];
      2'd1: pixel_color_idx = pixel_fb_word[11:8];
      2'd2: pixel_color_idx = pixel_fb_word[7:4];
      default: pixel_color_idx = pixel_fb_word[3:0];
    endcase
  end

  assign rgb_word = !active_video ? 12'h000 :
                    !disp_mode ? (glyph_bits[7 - h_count[2:0]] ? palette12(text_fb_word[11:8])
                                                               : palette12(text_fb_word[15:12]))
                               : palette12(pixel_color_idx);

  assign vga_hs = ~((h_count >= (H_ACTIVE + H_FRONT)) &&
                    (h_count < (H_ACTIVE + H_FRONT + H_SYNC)));
  assign vga_vs = ~((v_count >= (V_ACTIVE + V_FRONT)) &&
                    (v_count < (V_ACTIVE + V_FRONT + V_SYNC)));

  assign vga_r = active_video ? rgb_word[11:8] : 4'h0;
  assign vga_g = active_video ? rgb_word[7:4]  : 4'h0;
  assign vga_b = active_video ? rgb_word[3:0]  : 4'h0;

  function automatic logic [11:0] palette12(input logic [3:0] idx_in);
    case (idx_in)
      4'h0: palette12 = 12'h000;
      4'h1: palette12 = 12'h00A;
      4'h2: palette12 = 12'h0A0;
      4'h3: palette12 = 12'h0AA;
      4'h4: palette12 = 12'hA00;
      4'h5: palette12 = 12'hA0A;
      4'h6: palette12 = 12'hA50;
      4'h7: palette12 = 12'hAAA;
      4'h8: palette12 = 12'h555;
      4'h9: palette12 = 12'h55F;
      4'hA: palette12 = 12'h5F5;
      4'hB: palette12 = 12'h5FF;
      4'hC: palette12 = 12'hF55;
      4'hD: palette12 = 12'hF5F;
      4'hE: palette12 = 12'hFF5;
      default: palette12 = 12'hFFF;
    endcase
  endfunction

  function automatic logic [7:0] font_row(
    input logic [7:0] ch,
    input logic [2:0] row
  );
    begin
      font_row = 8'h00;
      case (ch)
        8'd33: case (row)
          3'd0: font_row = 8'd24; 3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd24; 3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd24; 3'd5: font_row = 8'd0;
          3'd6: font_row = 8'd24; default: font_row = 8'd0;
        endcase
        8'd40: case (row)
          3'd0: font_row = 8'd12; 3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd48; 3'd3: font_row = 8'd48;
          3'd4: font_row = 8'd48; 3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd12; default: font_row = 8'd0;
        endcase
        8'd41: case (row)
          3'd0: font_row = 8'd48; 3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd12; 3'd3: font_row = 8'd12;
          3'd4: font_row = 8'd12; 3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd48; default: font_row = 8'd0;
        endcase
        8'd43: case (row)
          3'd0: font_row = 8'd0;  3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd24; 3'd3: font_row = 8'd126;
          3'd4: font_row = 8'd24; 3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd0;  default: font_row = 8'd0;
        endcase
        8'd44: case (row)
          3'd0: font_row = 8'd0;  3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd0;  3'd3: font_row = 8'd0;
          3'd4: font_row = 8'd0;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd24; default: font_row = 8'd48;
        endcase
        8'd45: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd0;   3'd3: font_row = 8'd126;
          3'd4: font_row = 8'd0;   3'd5: font_row = 8'd0;
          3'd6: font_row = 8'd0;   default: font_row = 8'd0;
        endcase
        8'd46: case (row)
          3'd0: font_row = 8'd0;  3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd0;  3'd3: font_row = 8'd0;
          3'd4: font_row = 8'd0;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd24; default: font_row = 8'd0;
        endcase
        8'd48: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd110; 3'd3: font_row = 8'd118;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd49: case (row)
          3'd0: font_row = 8'd24;  3'd1: font_row = 8'd56;
          3'd2: font_row = 8'd24;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd126; default: font_row = 8'd0;
        endcase
        8'd50: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd6;   3'd3: font_row = 8'd12;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd48;
          3'd6: font_row = 8'd126; default: font_row = 8'd0;
        endcase
        8'd51: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd6;   3'd3: font_row = 8'd28;
          3'd4: font_row = 8'd6;   3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd52: case (row)
          3'd0: font_row = 8'd12;  3'd1: font_row = 8'd28;
          3'd2: font_row = 8'd60;  3'd3: font_row = 8'd108;
          3'd4: font_row = 8'd126; 3'd5: font_row = 8'd12;
          3'd6: font_row = 8'd12;  default: font_row = 8'd0;
        endcase
        8'd53: case (row)
          3'd0: font_row = 8'd126; 3'd1: font_row = 8'd96;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd6;
          3'd4: font_row = 8'd6;   3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd54: case (row)
          3'd0: font_row = 8'd28;  3'd1: font_row = 8'd48;
          3'd2: font_row = 8'd96;  3'd3: font_row = 8'd124;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd55: case (row)
          3'd0: font_row = 8'd126; 3'd1: font_row = 8'd6;
          3'd2: font_row = 8'd12;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd48;  3'd5: font_row = 8'd48;
          3'd6: font_row = 8'd48;  default: font_row = 8'd0;
        endcase
        8'd56: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd60;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd57: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd62;
          3'd4: font_row = 8'd6;   3'd5: font_row = 8'd12;
          3'd6: font_row = 8'd56;  default: font_row = 8'd0;
        endcase
        8'd58: case (row)
          3'd0: font_row = 8'd0;  3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd24; 3'd3: font_row = 8'd0;
          3'd4: font_row = 8'd24; 3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd0;  default: font_row = 8'd0;
        endcase
        8'd61: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd126; 3'd3: font_row = 8'd0;
          3'd4: font_row = 8'd126; 3'd5: font_row = 8'd0;
          3'd6: font_row = 8'd0;   default: font_row = 8'd0;
        endcase
        8'd65: case (row)
          3'd0: font_row = 8'd24;  3'd1: font_row = 8'd60;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd126; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd66: case (row)
          3'd0: font_row = 8'd124; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd124;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd124; default: font_row = 8'd0;
        endcase
        8'd67: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd96;  3'd3: font_row = 8'd96;
          3'd4: font_row = 8'd96;  3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd68: case (row)
          3'd0: font_row = 8'd120; 3'd1: font_row = 8'd108;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd108;
          3'd6: font_row = 8'd120; default: font_row = 8'd0;
        endcase
        8'd69: case (row)
          3'd0: font_row = 8'd126; 3'd1: font_row = 8'd96;
          3'd2: font_row = 8'd96;  3'd3: font_row = 8'd124;
          3'd4: font_row = 8'd96;  3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd126; default: font_row = 8'd0;
        endcase
        8'd70: case (row)
          3'd0: font_row = 8'd126; 3'd1: font_row = 8'd96;
          3'd2: font_row = 8'd96;  3'd3: font_row = 8'd124;
          3'd4: font_row = 8'd96;  3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd96;  default: font_row = 8'd0;
        endcase
        8'd71: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd96;  3'd3: font_row = 8'd110;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd62;  default: font_row = 8'd0;
        endcase
        8'd72: case (row)
          3'd0: font_row = 8'd102; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd126;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd73: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd24;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd74: case (row)
          3'd0: font_row = 8'd6;   3'd1: font_row = 8'd6;
          3'd2: font_row = 8'd6;   3'd3: font_row = 8'd6;
          3'd4: font_row = 8'd6;   3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd75: case (row)
          3'd0: font_row = 8'd102; 3'd1: font_row = 8'd108;
          3'd2: font_row = 8'd120; 3'd3: font_row = 8'd112;
          3'd4: font_row = 8'd120; 3'd5: font_row = 8'd108;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd76: case (row)
          3'd0: font_row = 8'd96;  3'd1: font_row = 8'd96;
          3'd2: font_row = 8'd96;  3'd3: font_row = 8'd96;
          3'd4: font_row = 8'd96;  3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd126; default: font_row = 8'd0;
        endcase
        8'd77: case (row)
          3'd0: font_row = 8'd198; 3'd1: font_row = 8'd238;
          3'd2: font_row = 8'd254; 3'd3: font_row = 8'd214;
          3'd4: font_row = 8'd198; 3'd5: font_row = 8'd198;
          3'd6: font_row = 8'd198; default: font_row = 8'd0;
        endcase
        8'd78: case (row)
          3'd0: font_row = 8'd102; 3'd1: font_row = 8'd118;
          3'd2: font_row = 8'd126; 3'd3: font_row = 8'd126;
          3'd4: font_row = 8'd110; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd79: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd80: case (row)
          3'd0: font_row = 8'd124; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd124;
          3'd4: font_row = 8'd96;  3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd96;  default: font_row = 8'd0;
        endcase
        8'd81: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd106; 3'd5: font_row = 8'd108;
          3'd6: font_row = 8'd54;  default: font_row = 8'd0;
        endcase
        8'd82: case (row)
          3'd0: font_row = 8'd124; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd124;
          3'd4: font_row = 8'd108; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd83: case (row)
          3'd0: font_row = 8'd60;  3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd96;  3'd3: font_row = 8'd60;
          3'd4: font_row = 8'd6;   3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd84: case (row)
          3'd0: font_row = 8'd126; 3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd24;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd24;  default: font_row = 8'd0;
        endcase
        8'd85: case (row)
          3'd0: font_row = 8'd102; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd86: case (row)
          3'd0: font_row = 8'd102; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd60;
          3'd6: font_row = 8'd24;  default: font_row = 8'd0;
        endcase
        8'd87: case (row)
          3'd0: font_row = 8'd198; 3'd1: font_row = 8'd198;
          3'd2: font_row = 8'd198; 3'd3: font_row = 8'd214;
          3'd4: font_row = 8'd254; 3'd5: font_row = 8'd238;
          3'd6: font_row = 8'd198; default: font_row = 8'd0;
        endcase
        8'd88: case (row)
          3'd0: font_row = 8'd102; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd60;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd60;  3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd89: case (row)
          3'd0: font_row = 8'd102; 3'd1: font_row = 8'd102;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd60;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd24;  default: font_row = 8'd0;
        endcase
        8'd90: case (row)
          3'd0: font_row = 8'd126; 3'd1: font_row = 8'd6;
          3'd2: font_row = 8'd12;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd48;  3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd126; default: font_row = 8'd0;
        endcase
        8'd97: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd60;  3'd3: font_row = 8'd6;
          3'd4: font_row = 8'd62;  3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd62;  default: font_row = 8'd0;
        endcase
        8'd98: case (row)
          3'd0: font_row = 8'd96;  3'd1: font_row = 8'd96;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd124; default: font_row = 8'd0;
        endcase
        8'd99: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd60;  3'd3: font_row = 8'd96;
          3'd4: font_row = 8'd96;  3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd100: case (row)
          3'd0: font_row = 8'd6;   3'd1: font_row = 8'd6;
          3'd2: font_row = 8'd62;  3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd62;  default: font_row = 8'd0;
        endcase
        8'd101: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd60;  3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd126; 3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd102: case (row)
          3'd0: font_row = 8'd28;  3'd1: font_row = 8'd48;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd48;
          3'd4: font_row = 8'd48;  3'd5: font_row = 8'd48;
          3'd6: font_row = 8'd48;  default: font_row = 8'd0;
        endcase
        8'd103: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd62;  3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd62;
          3'd6: font_row = 8'd6;   default: font_row = 8'd60;
        endcase
        8'd104: case (row)
          3'd0: font_row = 8'd96;  3'd1: font_row = 8'd96;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd105: case (row)
          3'd0: font_row = 8'd24;  3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd56;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd106: case (row)
          3'd0: font_row = 8'd6;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd6;   3'd3: font_row = 8'd6;
          3'd4: font_row = 8'd6;   3'd5: font_row = 8'd6;
          3'd6: font_row = 8'd102; default: font_row = 8'd60;
        endcase
        8'd107: case (row)
          3'd0: font_row = 8'd96;  3'd1: font_row = 8'd96;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd108;
          3'd4: font_row = 8'd120; 3'd5: font_row = 8'd108;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd108: case (row)
          3'd0: font_row = 8'd56;  3'd1: font_row = 8'd24;
          3'd2: font_row = 8'd24;  3'd3: font_row = 8'd24;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd24;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd109: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd236; 3'd3: font_row = 8'd254;
          3'd4: font_row = 8'd214; 3'd5: font_row = 8'd198;
          3'd6: font_row = 8'd198; default: font_row = 8'd0;
        endcase
        8'd110: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd111: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd60;  3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd60;  default: font_row = 8'd0;
        endcase
        8'd112: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd124;
          3'd6: font_row = 8'd96;  default: font_row = 8'd96;
        endcase
        8'd113: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd62;  3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd62;
          3'd6: font_row = 8'd6;   default: font_row = 8'd6;
        endcase
        8'd114: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd96;  3'd5: font_row = 8'd96;
          3'd6: font_row = 8'd96;  default: font_row = 8'd0;
        endcase
        8'd115: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd62;  3'd3: font_row = 8'd96;
          3'd4: font_row = 8'd60;  3'd5: font_row = 8'd6;
          3'd6: font_row = 8'd124; default: font_row = 8'd0;
        endcase
        8'd116: case (row)
          3'd0: font_row = 8'd48;  3'd1: font_row = 8'd48;
          3'd2: font_row = 8'd124; 3'd3: font_row = 8'd48;
          3'd4: font_row = 8'd48;  3'd5: font_row = 8'd48;
          3'd6: font_row = 8'd28;  default: font_row = 8'd0;
        endcase
        8'd117: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd102;
          3'd6: font_row = 8'd62;  default: font_row = 8'd0;
        endcase
        8'd118: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd60;
          3'd6: font_row = 8'd24;  default: font_row = 8'd0;
        endcase
        8'd119: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd198; 3'd3: font_row = 8'd198;
          3'd4: font_row = 8'd214; 3'd5: font_row = 8'd254;
          3'd6: font_row = 8'd108; default: font_row = 8'd0;
        endcase
        8'd120: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd60;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd60;
          3'd6: font_row = 8'd102; default: font_row = 8'd0;
        endcase
        8'd121: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd102; 3'd3: font_row = 8'd102;
          3'd4: font_row = 8'd102; 3'd5: font_row = 8'd62;
          3'd6: font_row = 8'd6;   default: font_row = 8'd60;
        endcase
        8'd122: case (row)
          3'd0: font_row = 8'd0;   3'd1: font_row = 8'd0;
          3'd2: font_row = 8'd126; 3'd3: font_row = 8'd12;
          3'd4: font_row = 8'd24;  3'd5: font_row = 8'd48;
          3'd6: font_row = 8'd126; default: font_row = 8'd0;
        endcase
        default: font_row = 8'h00;
      endcase
    end
  endfunction

endmodule