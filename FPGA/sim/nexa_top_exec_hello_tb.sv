`timescale 1ns/1ps

module nexa_top_exec_hello_tb;

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

  localparam int FAT_BASE = 128;
  localparam int DIR_BASE = 384;
  localparam logic [15:0] HEAP_BREAK_ADDR = 16'd60401;

  logic [7:0] hello_sectors [0:250];
  int hello_sector_count;
  int hello_size;
  bit hello_found;

  nexa_top #(
    .PROGRAM_FILE("sim/fixtures/top_exec_loader_boot.mem"),
    .DISK_FILE("mem/nexaos_system_disk.mem"),
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
        if ((count % 250000) == 0)
          $display("  INFO halt wait count=%0d pc=0x%04X magic=0x%04X cursor=%0d header=0x%04X",
                   count, dut.dbg_pc, dut.ram_inst.mem[16'hEEFE],
                   dut.ram_inst.mem[16'd60402], dut.ram_inst.mem[16'hEC24]);
      end
      if (!dut.cpu_halted) begin
        $display("  FEIL CPU halt timeout after %0d cycles", count);
        $display("       pc=0x%04X exec_state=%0d exec_hold=%0d magic=0x%04X heap=0x%04X",
                 dut.dbg_pc, dut.exec_loader_state, dut.exec_cpu_hold,
                 dut.ram_inst.mem[16'hEEFE], dut.ram_inst.mem[HEAP_BREAK_ADDR]);
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

  task automatic locate_hello_file();
    int dir_idx;
    int entry_base;
    int cur_sec;
    int next_sec;
    begin
      hello_found = 1'b0;
      hello_sector_count = 0;
      hello_size = 0;

      for (dir_idx = 0; dir_idx < 16; dir_idx = dir_idx + 1) begin
        entry_base = DIR_BASE + (dir_idx * 16);
        if (((dut.disk_inst.storage[entry_base + 11] & 16'h0001) != 0) &&
            (dut.disk_inst.storage[entry_base + 0] == 16'd72) &&
            (dut.disk_inst.storage[entry_base + 1] == 16'd69) &&
            (dut.disk_inst.storage[entry_base + 2] == 16'd76) &&
            (dut.disk_inst.storage[entry_base + 3] == 16'd76) &&
            (dut.disk_inst.storage[entry_base + 4] == 16'd79) &&
            (dut.disk_inst.storage[entry_base + 8] == 16'd78) &&
            (dut.disk_inst.storage[entry_base + 9] == 16'd88) &&
            (dut.disk_inst.storage[entry_base + 10] == 16'd69)) begin
          hello_found = 1'b1;
          hello_size = dut.disk_inst.storage[entry_base + 13];
          cur_sec = dut.disk_inst.storage[entry_base + 12];

          while ((cur_sec > 0) && (cur_sec < 256) && (hello_sector_count < 251)) begin
            hello_sectors[hello_sector_count] = cur_sec[7:0];
            hello_sector_count = hello_sector_count + 1;
            next_sec = dut.disk_inst.storage[FAT_BASE + cur_sec];
            if ((next_sec == 16'hFFFF) || (next_sec == 16'h0000) || (next_sec == 16'hFFFE))
              cur_sec = 0;
            else
              cur_sec = next_sec;
          end
        end
      end
    end
  endtask

  task automatic finish_summary();
    begin
      $display("\n╔════════════════════════════════════════════╗");
      $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
      $display("╚════════════════════════════════════════════╝");
      if (fail_cnt == 0)
        $display("✓ HELLO.NXE exec-loader besto alle tester");
      else
        $display("✗ %0d HELLO.NXE-feil gjenstår", fail_cnt);
      $finish;
    end
  endtask

  int idx;
  initial begin
    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 exec-loader with HELLO.NXE         ║");
    $display("╚════════════════════════════════════════════╝");

    locate_hello_file();
    if (!hello_found) begin
      $display("  FEIL fant ikke HELLO.NXE i systemdisken");
      fail_cnt++;
      finish_summary();
    end

    $display("  INFO HELLO.NXE sectors=%0d size=%0d start=%0d",
             hello_sector_count, hello_size, hello_sectors[0]);

    reset_dut();
    wait_for_halt(200);

    dut.ram_inst.mem[16'hEE00] = hello_sector_count[15:0];
    for (idx = 0; idx < hello_sector_count; idx = idx + 1)
      dut.ram_inst.mem[16'hEE01 + idx] = {8'h00, hello_sectors[idx]};
    dut.ram_inst.mem[16'hEEFF] = hello_size[15:0];
    dut.ram_inst.mem[16'hEEFE] = 16'h4558;
    dut.exec_checked_halt = 1'b0;

    wait_for_word("exec magic cleared", 16'hEEFE, 16'h0000, 3000000);
    wait_for_halt(5000000);
    @(posedge clk);
    #1;

    chk_bit("loaded program halted", 1'b1, dut.cpu_halted);
    chk_bit("heap break >= boot floor", 1'b1, dut.ram_inst.mem[HEAP_BREAK_ADDR] >= 16'd8192);
    chk_word("hello H", 16'h0F48, dut.ram_inst.mem[16'hECA2]);
    chk_word("hello E", 16'h0F45, dut.ram_inst.mem[16'hECA3]);
    chk_word("hello L", 16'h0F4C, dut.ram_inst.mem[16'hECA4]);
    chk_word("hello O", 16'h0F4F, dut.ram_inst.mem[16'hECA6]);
    chk_word("hello F", 16'h0F46, dut.ram_inst.mem[16'hECA8]);
    chk_word("hello D", 16'h0F44, dut.ram_inst.mem[16'hECAD]);
    chk_word("hello K", 16'h0F4B, dut.ram_inst.mem[16'hECB0]);

    finish_summary();
  end

  initial begin
    #100_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule