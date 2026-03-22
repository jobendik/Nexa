`timescale 1ns/1ps

module nexa_top_exec_loader_tb;

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

  localparam logic [7:0] TEST_SECTOR = 8'd7;
  localparam logic [15:0] TEST_WORDS = 16'd65;
  logic [15:0] prog_words [0:TEST_WORDS-1];

  nexa_top #(
    .PROGRAM_FILE("sim/fixtures/top_exec_loader_boot.mem"),
    .ENABLE_VGA(1'b0)
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
      end else begin
        $display("  OK   CPU halted after %0d cycles", count);
        pass_cnt++;
      end
    end
  endtask

  task automatic wait_for_word(input string desc, input logic [15:0] addr, input logic [15:0] exp, input int max_cycles);
    int count;
    begin
      count = 0;
      while ((dut.ram_inst.mem[addr] != exp) && (count < max_cycles)) begin
        @(posedge clk);
        #1;
        count++;
      end
      if (dut.ram_inst.mem[addr] != exp) begin
        $display("  FEIL %-34s timeout after %0d cycles (addr=0x%04X exp=0x%04X got=0x%04X)",
                 desc, count, addr, exp, dut.ram_inst.mem[addr]);
        $display("       state=%0d halted=%0d checked=%0d hold=%0d exec_active=%0d exec_we=%0d exec_addr=0x%04X bram=0x%04X busy=%0d done=%0d err=%0d",
                 dut.exec_loader_state, dut.cpu_halted, dut.exec_checked_halt,
                 dut.exec_cpu_hold, dut.exec_ram_active, dut.exec_ram_we,
                 dut.exec_ram_addr, dut.bram_doutb, dut.disk_ctrl_busy,
                 dut.disk_ctrl_done, dut.disk_ctrl_error);
        fail_cnt++;
      end else begin
        $display("  OK   %-34s after %0d cycles", desc, count);
        pass_cnt++;
      end
    end
  endtask

  integer idx;
  initial begin
    if ($test$plusargs("dump")) begin
      $dumpfile("sim/nexa_top_exec_loader_wave.vcd");
      $dumpvars(0, nexa_top_exec_loader_tb);
    end

    $readmemh("sim/fixtures/top_exec_loader_program.mem", prog_words);
    for (idx = 0; idx < TEST_WORDS; idx = idx + 1)
      dut.disk_inst.storage[(TEST_SECTOR * 128) + idx] = prog_words[idx];

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 top exec-loader path               ║");
    $display("╚════════════════════════════════════════════╝");

    reset_dut();
    wait_for_halt(200);

    dut.ram_inst.mem[16'hEE00] = 16'd1;
    dut.ram_inst.mem[16'hEE01] = {8'h00, TEST_SECTOR};
    dut.ram_inst.mem[16'hEEFF] = TEST_WORDS;
    dut.ram_inst.mem[16'hEEFE] = 16'h4558;
    dut.exec_checked_halt = 1'b0;

    wait_for_word("exec magic cleared", 16'hEEFE, 16'h0000, 50000);
    repeat (5000) @(posedge clk);
    @(posedge clk);
    #1;

    chk_bit("exec loader released CPU", 1'b0, dut.exec_cpu_hold);
    chk_bit("payload left halt state", 1'b0, dut.cpu_halted);
    chk_bit("PC entered loaded image", 1'b1, dut.dbg_pc < TEST_WORDS);
    chk_word("loaded word[1]", prog_words[1], dut.ram_inst.mem[16'h0001]);
    chk_word("loaded halt opcode", prog_words[34], dut.ram_inst.mem[16'h0022]);
    chk_word("loaded string H", prog_words[35], dut.ram_inst.mem[16'h0023]);
    chk_word("heap break set", 16'd8192, dut.ram_inst.mem[16'd60401]);
    chk_word("exec load sector", {8'h00, TEST_SECTOR}, dut.ram_inst.mem[16'hEE01]);

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ Top-level exec-loader besto alle tester");
    else
      $display("✗ %0d exec-loader-feil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #100_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule