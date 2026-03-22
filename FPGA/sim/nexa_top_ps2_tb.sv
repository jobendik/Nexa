`timescale 1ns/1ps

module nexa_top_ps2_tb;

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

  nexa_top #(
    .PROGRAM_FILE("sim/fixtures/top_ps2_program.mem")
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

  task automatic reset_dut();
    begin
      rst_btn = 1'b1;
      ps2_clk = 1'b1;
      ps2_data = 1'b1;
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

  task automatic ps2_send_bit(input logic bit_value);
    begin
      ps2_data = bit_value;
      repeat (30) @(posedge clk);
      #1;
      ps2_clk = 1'b0;
      repeat (30) @(posedge clk);
      #1;
      ps2_clk = 1'b1;
      repeat (30) @(posedge clk);
      #1;
    end
  endtask

  task automatic ps2_send_byte(input logic [7:0] byte_value);
    logic parity_bit;
    int bit_idx;
    begin
      parity_bit = ~(^byte_value);
      ps2_send_bit(1'b0);
      for (bit_idx = 0; bit_idx < 8; bit_idx++)
        ps2_send_bit(byte_value[bit_idx]);
      ps2_send_bit(parity_bit);
      ps2_send_bit(1'b1);
      ps2_data = 1'b1;
      repeat (80) @(posedge clk);
      #1;
    end
  endtask

  task automatic ps2_send_extended_byte(input logic [7:0] byte_value);
    begin
      ps2_send_byte(8'hE0);
      ps2_send_byte(byte_value);
    end
  endtask

  initial begin
    $dumpfile("sim/nexa_top_ps2_wave.vcd");
    $dumpvars(0, nexa_top_ps2_tb);

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 top PS/2 integration               ║");
    $display("╚════════════════════════════════════════════╝");

    reset_dut();
    repeat (200) @(posedge clk);
    #1;

    ps2_send_extended_byte(8'h6B);
    wait_for_halt(30000);
    @(posedge clk);
    #1;

    chk_bit("CPU halted", 1'b1, dut.cpu_halted);
    chk_word("halt LED mirror", 16'hDEAD, led);
    chk_word("captured keycode", 16'h0082, dut.ram_inst.mem[16'h0100]);
    chk_bit("keyboard status cleared", 1'b0, dut.io_inst.kbd_status);
    chk_word("keyboard data latched", 16'h0082, {8'h00, dut.io_inst.kbd_data_reg});
    chk_bit("keyboard IRQ pending", 1'b1, dut.io_inst.sys_pending_r[1]);

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ Top-level PS/2-integrasjon besto alle tester");
    else
      $display("✗ %0d top-level PS/2-feil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #300_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule