`timescale 1ns/1ps

module nexa_top_boot_os_tb;

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

  localparam logic [15:0] CURSOR_ADDR = 16'd60402;
  localparam logic [15:0] EXEC_MAGIC_ADDR = 16'hEEFE;
  localparam logic [15:0] HEADER_H_ADDR = 16'hEC24;
  localparam logic [15:0] PROMPT_ADDR0 = 16'hEDE0;
  localparam logic [15:0] PROMPT_ADDR1 = 16'hEDE1;
  localparam logic [15:0] PROMPT_ADDR2 = 16'hEDE2;
  localparam logic [15:0] PROMPT_ADDR3 = 16'hEDE3;
  localparam logic [15:0] PROMPT_ADDR4 = 16'hEDE4;

  nexa_top #(
    .PROGRAM_FILE("mem/nexaos_boot.mem"),
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
      ps2_clk = 1'b1;
      ps2_data = 1'b1;
      repeat (4) @(posedge clk);
      #1;
      rst_btn = 1'b0;
      repeat (2) @(posedge clk);
      #1;
    end
  endtask

  task automatic wait_for_shell_ready(input int max_cycles);
    int count;
    int stable_count;
    begin
      count = 0;
      stable_count = 0;
      while ((stable_count < 64) && (count < max_cycles)) begin
        @(posedge clk);
        #1;
        count++;

        if ((count % 500000) == 0)
          $display("  INFO boot wait count=%0d cursor=%0d pc=0x%04X halted=%0d magic=0x%04X prompt=%04X %04X %04X %04X %04X",
                   count, dut.ram_inst.mem[CURSOR_ADDR], dut.dbg_pc, dut.cpu_halted,
                   dut.ram_inst.mem[EXEC_MAGIC_ADDR],
                   dut.ram_inst.mem[PROMPT_ADDR0], dut.ram_inst.mem[PROMPT_ADDR1],
                   dut.ram_inst.mem[PROMPT_ADDR2], dut.ram_inst.mem[PROMPT_ADDR3],
                   dut.ram_inst.mem[PROMPT_ADDR4]);

        if (!dut.cpu_halted &&
          (dut.ram_inst.mem[EXEC_MAGIC_ADDR] != 16'h4558) &&
            (dut.ram_inst.mem[HEADER_H_ADDR] == 16'h1F48) &&
            (dut.ram_inst.mem[PROMPT_ADDR0] == 16'h0F43) &&
            (dut.ram_inst.mem[PROMPT_ADDR1] == 16'h0F3A) &&
            (dut.ram_inst.mem[PROMPT_ADDR2] == 16'h0F5C) &&
            (dut.ram_inst.mem[PROMPT_ADDR3] == 16'h0F3E) &&
            (dut.ram_inst.mem[PROMPT_ADDR4] == 16'h0F20) &&
            (dut.ram_inst.mem[CURSOR_ADDR] == 16'd485)) begin
          stable_count++;
        end else begin
          stable_count = 0;
        end
      end
      if (stable_count < 64) begin
        $display("  FEIL shell timeout after %0d cycles", count);
        $display("       cursor=%0d pc=0x%04X halted=%0d magic=0x%04X header=0x%04X prompt=%04X %04X %04X %04X %04X stable=%0d",
                 dut.ram_inst.mem[CURSOR_ADDR], dut.dbg_pc, dut.cpu_halted,
                 dut.ram_inst.mem[EXEC_MAGIC_ADDR], dut.ram_inst.mem[HEADER_H_ADDR],
                 dut.ram_inst.mem[PROMPT_ADDR0], dut.ram_inst.mem[PROMPT_ADDR1],
                 dut.ram_inst.mem[PROMPT_ADDR2], dut.ram_inst.mem[PROMPT_ADDR3],
                 dut.ram_inst.mem[PROMPT_ADDR4], stable_count);
        fail_cnt++;
      end else begin
        $display("  OK   shell ready after %0d cycles (stable=%0d)", count, stable_count);
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
        fail_cnt++;
      end else begin
        $display("  OK   %-34s after %0d cycles", desc, count);
        pass_cnt++;
      end
    end
  endtask

  task automatic wait_for_halt(input int max_cycles);
    int count;
    begin
      count = 0;
      while (!dut.cpu_halted && (count < max_cycles)) begin
        @(posedge clk);
        #1;
        count++;
      end
      if (!dut.cpu_halted) begin
        $display("  FEIL CPU halt timeout after %0d cycles", count);
        $display("       pc=0x%04X exec_state=%0d exec_hold=%0d exec_magic=0x%04X cursor=%0d prompt=%04X %04X %04X %04X",
                 dut.dbg_pc, dut.exec_loader_state, dut.exec_cpu_hold,
                 dut.ram_inst.mem[EXEC_MAGIC_ADDR], dut.ram_inst.mem[CURSOR_ADDR],
                 dut.ram_inst.mem[PROMPT_ADDR0], dut.ram_inst.mem[PROMPT_ADDR1],
                 dut.ram_inst.mem[PROMPT_ADDR2], dut.ram_inst.mem[PROMPT_ADDR3]);
        fail_cnt++;
      end
    end
  endtask

  task automatic wait_for_cursor_value(input logic [15:0] exp_cursor, input int max_cycles);
    int count;
    begin
      count = 0;
      while ((dut.ram_inst.mem[CURSOR_ADDR] != exp_cursor) && (count < max_cycles)) begin
        @(posedge clk);
        #1;
        count++;
      end
      if (dut.ram_inst.mem[CURSOR_ADDR] != exp_cursor) begin
        $display("  FEIL cursor wait timeout exp=%0d got=%0d after %0d cycles pc=0x%04X magic=0x%04X",
                 exp_cursor, dut.ram_inst.mem[CURSOR_ADDR], count,
                 dut.dbg_pc, dut.ram_inst.mem[EXEC_MAGIC_ADDR]);
        fail_cnt++;
      end
    end
  endtask

  task automatic inject_ascii_char(input logic [7:0] ascii_value);
    int count;
    begin
      count = 0;
      while (dut.io_inst.kbd_status && (count < 200000)) begin
        @(posedge clk);
        #1;
        count++;
      end
      if (dut.io_inst.kbd_status) begin
        $display("  FEIL keyboard buffer busy before injecting ascii=0x%02X", ascii_value);
        fail_cnt++;
      end else begin
        dut.io_inst.kbd_data_reg = ascii_value;
        dut.io_inst.kbd_status = 1'b1;
      end
    end
  endtask

  task automatic type_ascii_string(input string text);
    int idx;
    logic [15:0] next_cursor;
    begin
      for (idx = 0; idx < text.len(); idx = idx + 1) begin
        next_cursor = dut.ram_inst.mem[CURSOR_ADDR] + 16'd1;
        inject_ascii_char(text[idx]);
        wait_for_cursor_value(next_cursor, 200000);
        if (dut.ram_inst.mem[CURSOR_ADDR] != next_cursor) begin
          $display("  FEIL typed ascii 0x%02X not consumed at idx=%0d", text[idx], idx);
          idx = text.len();
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
        $display("✓ NexaOS boot og RUN besto alle tester");
      else
        $display("✗ %0d boot/RUN-feil gjenstår", fail_cnt);
      $finish;
    end
  endtask

  initial begin
    if ($test$plusargs("dump")) begin
      $dumpfile("sim/nexa_top_boot_os_wave.vcd");
      $dumpvars(0, nexa_top_boot_os_tb);
    end

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 boot into NexaOS + RUN            ║");
    $display("╚════════════════════════════════════════════╝");

    reset_dut();
    wait_for_shell_ready(5000000);
    if (fail_cnt != 0)
      finish_summary();

    chk_bit("NexaOS still running", 1'b0, dut.cpu_halted);
    chk_word("disk image magic", 16'h4844, dut.disk_inst.storage[0]);

    type_ascii_string("run hello.nxe");
    if (fail_cnt != 0)
      finish_summary();
    inject_ascii_char(8'h0A);
    $display("  INFO after command: cursor=%0d pc=0x%04X halted=%0d magic=0x%04X",
          dut.ram_inst.mem[CURSOR_ADDR], dut.dbg_pc, dut.cpu_halted,
          dut.ram_inst.mem[EXEC_MAGIC_ADDR]);

    wait_for_word("exec magic set", 16'hEEFE, 16'h4558, 5000000);
    wait_for_word("exec magic cleared", 16'hEEFE, 16'h0000, 30000000);
    wait_for_halt(15000000);
    @(posedge clk);
    #1;

    chk_bit("loaded program halted", 1'b1, dut.cpu_halted);
    chk_word("hello H", 16'h0F48, dut.ram_inst.mem[16'hECA2]);
    chk_word("hello E", 16'h0F45, dut.ram_inst.mem[16'hECA3]);
    chk_word("hello L", 16'h0F4C, dut.ram_inst.mem[16'hECA4]);
    chk_word("hello O", 16'h0F4F, dut.ram_inst.mem[16'hECA6]);
    chk_word("hello F", 16'h0F46, dut.ram_inst.mem[16'hECA8]);
    chk_word("exec magic cleared", 16'h0000, dut.ram_inst.mem[16'hEEFE]);
    chk_bit("heap break >= boot floor", 1'b1, dut.ram_inst.mem[16'd60401] >= 16'd8192);

    finish_summary();
  end

  initial begin
    #800_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule