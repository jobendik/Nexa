`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_vga_tb;

  logic        clk = 1'b0;
  logic        rst;
  logic        disp_mode;
  logic        fb_we;
  logic [15:0] fb_addr;
  logic [15:0] fb_wdata;
  logic [3:0]  vga_r;
  logic [3:0]  vga_g;
  logic [3:0]  vga_b;
  logic        vga_hs;
  logic        vga_vs;

  int pass_cnt = 0;
  int fail_cnt = 0;

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

  nexa_vga #(
    .INIT_FILE("sim/fixtures/vga_preload.mem")
  ) dut (
    .clk      (clk),
    .rst      (rst),
    .disp_mode(disp_mode),
    .fb_load_we(1'b0),
    .fb_load_addr(16'h0000),
    .fb_load_data(16'h0000),
    .fb_we    (fb_we),
    .fb_addr  (fb_addr),
    .fb_wdata (fb_wdata),
    .vga_r    (vga_r),
    .vga_g    (vga_g),
    .vga_b    (vga_b),
    .vga_hs   (vga_hs),
    .vga_vs   (vga_vs)
  );

  always #5 clk = ~clk;

  function automatic logic [11:0] expected_palette(input logic [3:0] idx_in);
    case (idx_in)
      4'h0: expected_palette = 12'h000;
      4'h1: expected_palette = 12'h00A;
      4'h2: expected_palette = 12'h0A0;
      4'h3: expected_palette = 12'h0AA;
      4'h4: expected_palette = 12'hA00;
      4'h5: expected_palette = 12'hA0A;
      4'h6: expected_palette = 12'hA50;
      4'h7: expected_palette = 12'hAAA;
      4'h8: expected_palette = 12'h555;
      4'h9: expected_palette = 12'h55F;
      4'hA: expected_palette = 12'h5F5;
      4'hB: expected_palette = 12'h5FF;
      4'hC: expected_palette = 12'hF55;
      4'hD: expected_palette = 12'hF5F;
      4'hE: expected_palette = 12'hFF5;
      default: expected_palette = 12'hFFF;
    endcase
  endfunction

  function automatic logic [11:0] current_rgb();
    current_rgb = {vga_r, vga_g, vga_b};
  endfunction

  task automatic chk_word(input string desc, input logic [15:0] exp, input logic [15:0] got);
    if (exp !== got) begin
      $display("  FEIL %-36s exp=0x%04X got=0x%04X", desc, exp, got);
      fail_cnt++;
    end else begin
      $display("  OK   %-36s = 0x%04X", desc, got);
      pass_cnt++;
    end
  endtask

  task automatic chk_rgb(input string desc, input logic [11:0] exp);
    logic [11:0] got;
    begin
      got = current_rgb();
      if (exp !== got) begin
        $display("  FEIL %-36s exp=0x%03X got=0x%03X", desc, exp, got);
        fail_cnt++;
      end else begin
        $display("  OK   %-36s = 0x%03X", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic reset_dut();
    begin
      rst       = 1'b1;
      disp_mode = 1'b0;
      fb_we     = 1'b0;
      fb_addr   = '0;
      fb_wdata  = '0;
      repeat (4) @(posedge clk);
      #1;
      rst = 1'b0;
      repeat (2) @(posedge clk);
      #1;
    end
  endtask

  task automatic fb_write_word(input logic [15:0] addr, input logic [15:0] data);
    begin
      fb_addr  = addr;
      fb_wdata = data;
      fb_we    = 1'b1;
      @(posedge clk);
      #1;
      fb_we    = 1'b0;
      fb_addr  = '0;
      fb_wdata = '0;
    end
  endtask

  task automatic advance_pixel();
    begin
      repeat (4) @(posedge clk);
      #1;
    end
  endtask

  task automatic wait_frame_start();
    int watchdog;
    begin
      watchdog = 0;
      while (!((dut.h_count == 10'd0) && (dut.v_count == 10'd0))) begin
        advance_pixel();
        watchdog++;
        if (watchdog > (H_TOTAL * V_TOTAL + 8)) begin
          $display("  FEIL wait_frame_start timeout");
          fail_cnt++;
          disable wait_frame_start;
        end
      end
    end
  endtask

  task automatic seek_coord(input int x, input int y);
    int watchdog;
    begin
      watchdog = 0;
      while (!((dut.h_count == x[9:0]) && (dut.v_count == y[9:0]))) begin
        advance_pixel();
        watchdog++;
        if (watchdog > (H_TOTAL * V_TOTAL + 8)) begin
          $display("  FEIL seek_coord timeout for (%0d,%0d)", x, y);
          fail_cnt++;
          disable seek_coord;
        end
      end
    end
  endtask

  task automatic test_text_mode();
    begin
      $display("\n-- VGA TEST 1: text mode colors --");
      reset_dut();
      fb_write_word(FB_BASE, 16'h1E41);

      wait_frame_start();
      seek_coord(0, 0);
      chk_rgb("text bg pixel", expected_palette(4'h1));

      seek_coord(3, 0);
      chk_rgb("text fg pixel", expected_palette(4'hE));

      seek_coord(4, 1);
      chk_rgb("text doubled scanline", expected_palette(4'hE));
    end
  endtask

  task automatic test_preload();
    begin
      $display("\n-- VGA TEST 0: init-file preload --");
      reset_dut();

      wait_frame_start();
      seek_coord(0, 0);
      chk_rgb("preload bg pixel", expected_palette(4'h1));

      seek_coord(3, 0);
      chk_rgb("preload fg pixel", expected_palette(4'hE));
    end
  endtask

  task automatic test_pixel_mode();
    begin
      $display("\n-- VGA TEST 2: pixel mode nibble unpacking --");
      reset_dut();
      disp_mode = 1'b1;
      fb_write_word(FB_BASE, 16'h1234);

      wait_frame_start();
      seek_coord(0, 0);
      chk_rgb("pixel nibble 0", expected_palette(4'h1));

      seek_coord(4, 0);
      chk_rgb("pixel nibble 1", expected_palette(4'h2));

      seek_coord(8, 0);
      chk_rgb("pixel nibble 2", expected_palette(4'h3));

      seek_coord(12, 0);
      chk_rgb("pixel nibble 3", expected_palette(4'h4));

      seek_coord(12, 3);
      chk_rgb("pixel vertical scale", expected_palette(4'h4));
    end
  endtask

  task automatic test_sync_and_blanking();
    int low_hs_pixels;
    int low_vs_lines;
    int pixel_idx;
    int line_idx;
    begin
      $display("\n-- VGA TEST 3: sync timing and blanking --");
      reset_dut();

      wait_frame_start();
      low_hs_pixels = 0;
      for (pixel_idx = 0; pixel_idx < H_TOTAL; pixel_idx++) begin
        if (!vga_hs)
          low_hs_pixels++;
        advance_pixel();
      end
      chk_word("hsync low width", 16'(H_SYNC), low_hs_pixels[15:0]);

      wait_frame_start();
      low_vs_lines = 0;
      for (line_idx = 0; line_idx < V_TOTAL; line_idx++) begin
        if (!vga_vs)
          low_vs_lines++;
        for (pixel_idx = 0; pixel_idx < H_TOTAL; pixel_idx++)
          advance_pixel();
      end
      chk_word("vsync low height", 16'(V_SYNC), low_vs_lines[15:0]);

      wait_frame_start();
      seek_coord(H_ACTIVE, 0);
      chk_rgb("horizontal blanking black", 12'h000);

      wait_frame_start();
      seek_coord(0, V_ACTIVE);
      chk_rgb("vertical blanking black", 12'h000);
    end
  endtask

  initial begin
    $dumpfile("sim/nexa_vga_wave.vcd");
    $dumpvars(0, nexa_vga_tb);

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 VGA verification                   ║");
    $display("╚════════════════════════════════════════════╝");

    test_preload();
    test_text_mode();
    test_pixel_mode();
    test_sync_and_blanking();

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ VGA-rendereren besto alle tester");
    else
      $display("✗ %0d VGA-feil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #200_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule