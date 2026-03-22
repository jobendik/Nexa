`timescale 1ns/1ps

module nexa_top_vga_pixel_tb;

  logic clk = 1'b0;
  logic rst_btn = 1'b0;
  logic uart_rxd = 1'b1;
  logic ps2_clk = 1'b1;
  logic ps2_data = 1'b1;

  logic uart_txd;
  logic [15:0] led;
  logic [7:0] seg;
  logic [3:0] an;
  logic [3:0] vga_r;
  logic [3:0] vga_g;
  logic [3:0] vga_b;
  logic vga_hs;
  logic vga_vs;

  int pass_cnt = 0;
  int fail_cnt = 0;

  localparam int H_TOTAL = 800;
  localparam int V_TOTAL = 525;

  nexa_top #(
    .PROGRAM_FILE("sim/fixtures/top_vga_pixel_program.mem")
  ) dut (
    .clk(clk),
    .rst_btn(rst_btn),
    .uart_txd(uart_txd),
    .uart_rxd(uart_rxd),
    .led(led),
    .seg(seg),
    .an(an),
    .ps2_clk(ps2_clk),
    .ps2_data(ps2_data),
    .vga_r(vga_r),
    .vga_g(vga_g),
    .vga_b(vga_b),
    .vga_hs(vga_hs),
    .vga_vs(vga_vs)
  );

  always #5 clk = ~clk;

  function automatic logic [11:0] rgb_now();
    rgb_now = {vga_r, vga_g, vga_b};
  endfunction

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

  task automatic chk_word(input string desc, input logic [15:0] exp, input logic [15:0] got);
    begin
      if (exp !== got) begin
        $display("  FEIL %-34s exp=0x%04X got=0x%04X", desc, exp, got);
        fail_cnt++;
      end else begin
        $display("  OK   %-34s = 0x%04X", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic chk_bit(input string desc, input logic exp, input logic got);
    begin
      if (exp !== got) begin
        $display("  FEIL %-34s exp=%0d got=%0d", desc, exp, got);
        fail_cnt++;
      end else begin
        $display("  OK   %-34s = %0d", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic chk_rgb(input string desc, input logic [11:0] exp);
    logic [11:0] got;
    begin
      got = rgb_now();
      if (exp !== got) begin
        $display("  FEIL %-34s exp=0x%03X got=0x%03X", desc, exp, got);
        fail_cnt++;
      end else begin
        $display("  OK   %-34s = 0x%03X", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic reset_dut();
    begin
      rst_btn = 1'b1;
      repeat (4) @(posedge clk);
      #1;
      rst_btn = 1'b0;
      repeat (2) @(posedge clk);
      #1;
    end
  endtask

  task automatic wait_for_halt(input int max_cycles);
    int count;
    begin
      count = 0;
      while (!dut.cpu_halted && count < max_cycles) begin
        @(posedge clk);
        #1;
        count++;
      end
      if (!dut.cpu_halted) begin
        $display("  FEIL CPU halt timeout after %0d cycles", count);
        fail_cnt++;
      end
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
      while (!((dut.gen_vga.vga_inst.h_count == 10'd0) && (dut.gen_vga.vga_inst.v_count == 10'd0))) begin
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
      while (!((dut.gen_vga.vga_inst.h_count == x[9:0]) && (dut.gen_vga.vga_inst.v_count == y[9:0]))) begin
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

  initial begin
    $dumpfile("sim/nexa_top_vga_pixel_wave.vcd");
    $dumpvars(0, nexa_top_vga_pixel_tb);

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 top pixel VGA integration          ║");
    $display("╚════════════════════════════════════════════╝");

    reset_dut();
    wait_for_halt(20000);
    @(posedge clk);
    #1;

    chk_bit("CPU halted", 1'b1, dut.cpu_halted);
    chk_bit("pixel mode enabled", 1'b1, dut.disp_mode_live);
    chk_word("halt LED mirror", 16'hDEAD, led);
    chk_word("pixel framebuffer word", 16'h1234, dut.ram_inst.mem[16'hEC00]);

    wait_frame_start();
    seek_coord(0, 0);
    chk_rgb("pixel nibble 0 through top", expected_palette(4'h1));

    seek_coord(4, 0);
    chk_rgb("pixel nibble 1 through top", expected_palette(4'h2));

    seek_coord(8, 0);
    chk_rgb("pixel nibble 2 through top", expected_palette(4'h3));

    seek_coord(12, 0);
    chk_rgb("pixel nibble 3 through top", expected_palette(4'h4));

    seek_coord(12, 3);
    chk_rgb("pixel vertical scale top", expected_palette(4'h4));

    seek_coord(16, 0);
    chk_rgb("pixel background top", expected_palette(4'h0));

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ Top-level pixel-VGA-integrasjon besto alle tester");
    else
      $display("✗ %0d top-level pixel-VGA-feil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #200_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule