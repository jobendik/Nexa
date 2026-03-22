`timescale 1ns/1ps

module nexa_top_sound_tb;

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
    .PROGRAM_FILE("sim/fixtures/top_sound_program.mem")
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

  task automatic observe_sound_window(output int min_sample, output int max_sample, output int sample_changes);
    int idx;
    logic signed [11:0] prev_sample;
    begin
      min_sample = 100000;
      max_sample = -100000;
      sample_changes = 0;
      prev_sample = dut.io_inst.sound_gen_inst.mix_sample_dbg;
      for (idx = 0; idx < 250000; idx++) begin
        @(posedge clk);
        #1;
        if ($signed(dut.io_inst.sound_gen_inst.mix_sample_dbg) < min_sample)
          min_sample = $signed(dut.io_inst.sound_gen_inst.mix_sample_dbg);
        if ($signed(dut.io_inst.sound_gen_inst.mix_sample_dbg) > max_sample)
          max_sample = $signed(dut.io_inst.sound_gen_inst.mix_sample_dbg);
        if (dut.io_inst.sound_gen_inst.mix_sample_dbg != prev_sample)
          sample_changes++;
        prev_sample = dut.io_inst.sound_gen_inst.mix_sample_dbg;
      end
    end
  endtask

  task automatic chk_range(input string desc, input bit cond, input int a, input int b);
    begin
      if (!cond) begin
        $display("  FEIL %-34s a=%0d b=%0d", desc, a, b);
        fail_cnt++;
      end else begin
        $display("  OK   %-34s a=%0d b=%0d", desc, a, b);
        pass_cnt++;
      end
    end
  endtask

  int min_sample;
  int max_sample;
  int sample_changes;

  initial begin
    $dumpfile("sim/nexa_top_sound_wave.vcd");
    $dumpvars(0, nexa_top_sound_tb);

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 top sound integration              ║");
    $display("╚════════════════════════════════════════════╝");

    reset_dut();
    wait_for_halt(20000);
    @(posedge clk);
    #1;

    chk_bit("CPU halted", 1'b1, dut.cpu_halted);
    chk_word("halt LED mirror", 16'hDEAD, led);
    chk_word("tone period reg", 16'd1000, dut.io_inst.sound_period[0]);
    chk_word("tone control reg", 16'h0198, dut.io_inst.sound_control[0]);
    chk_word("noise period reg", 16'd128, dut.io_inst.sound_period[3]);
    chk_word("noise control reg", 16'h01C8, dut.io_inst.sound_control[3]);

    observe_sound_window(min_sample, max_sample, sample_changes);
    chk_range("mixed sound spans", (min_sample < 0) && (max_sample > 0), min_sample, max_sample);
    chk_range("mixed sound changes", sample_changes > 20, sample_changes, 20);

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ Top-level lydintegrasjon besto alle tester");
    else
      $display("✗ %0d top-level lydfeil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #500_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule