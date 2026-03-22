`timescale 1ns/1ps

module nexa_ps2_tb;

  logic clk = 1'b0;
  logic rst = 1'b0;
  logic ps2_clk = 1'b1;
  logic ps2_data = 1'b1;
  logic [7:0] ascii;
  logic valid;
  logic [7:0] last_ascii = 8'h00;
  int valid_count = 0;
  int event_mark = 0;

  int pass_cnt = 0;
  int fail_cnt = 0;

  nexa_ps2 dut (
    .clk(clk),
    .rst(rst),
    .ps2_clk(ps2_clk),
    .ps2_data(ps2_data),
    .ascii(ascii),
    .valid(valid)
  );

  always #5 clk = ~clk;

  always_ff @(posedge clk) begin
    if (rst) begin
      last_ascii <= 8'h00;
      valid_count <= 0;
    end else if (valid) begin
      last_ascii <= ascii;
      valid_count <= valid_count + 1;
    end
  end

  task automatic chk_ascii(input string desc, input logic [7:0] exp, input logic [7:0] got);
    begin
      if (got !== exp) begin
        $display("  FEIL %-34s exp=0x%02X got=0x%02X", desc, exp, got);
        fail_cnt++;
      end else begin
        $display("  OK   %-34s = 0x%02X", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic expect_ascii(input string desc, input logic [7:0] exp, input int timeout_cycles);
    int cycles;
    begin
      cycles = 0;
      while ((valid_count == event_mark) && (cycles < timeout_cycles)) begin
        @(posedge clk);
        #1;
        cycles++;
      end
      if (valid_count == event_mark) begin
        $display("  FEIL %-34s timeout", desc);
        fail_cnt++;
      end else begin
        chk_ascii(desc, exp, last_ascii);
      end
    end
  endtask

  task automatic expect_no_valid(input string desc, input int observe_cycles);
    int start_count;
    int cycles;
    begin
      start_count = valid_count;
      for (cycles = 0; cycles < observe_cycles; cycles++) begin
        @(posedge clk);
        #1;
        if (valid_count != start_count) begin
          $display("  FEIL %-34s unexpected valid ascii=0x%02X", desc, last_ascii);
          fail_cnt++;
          disable expect_no_valid;
        end
      end
      $display("  OK   %-34s", desc);
      pass_cnt++;
    end
  endtask

  task automatic reset_dut();
    begin
      rst = 1'b1;
      ps2_clk = 1'b1;
      ps2_data = 1'b1;
      repeat (8) @(posedge clk);
      #1;
      rst = 1'b0;
      repeat (8) @(posedge clk);
      #1;
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
    $dumpfile("sim/nexa_ps2_wave.vcd");
    $dumpvars(0, nexa_ps2_tb);

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 PS/2 decoder verification          ║");
    $display("╚════════════════════════════════════════════╝");

    reset_dut();

    event_mark = valid_count;
    ps2_send_byte(8'h1C);
    expect_ascii("make code a", 8'h61, 4000);

    ps2_send_byte(8'hF0);
    ps2_send_byte(8'h1C);
    expect_no_valid("break code ignored", 1000);

    event_mark = valid_count;
    ps2_send_byte(8'h12);
    ps2_send_byte(8'h1C);
    expect_ascii("shifted A", 8'h41, 4000);
    ps2_send_byte(8'hF0);
    ps2_send_byte(8'h1C);
    ps2_send_byte(8'hF0);
    ps2_send_byte(8'h12);
    expect_no_valid("shift release ignored", 1000);

    event_mark = valid_count;
    ps2_send_byte(8'h58);
    ps2_send_byte(8'hF0);
    ps2_send_byte(8'h58);
    ps2_send_byte(8'h1C);
    expect_ascii("caps lock A", 8'h41, 4000);

    event_mark = valid_count;
    ps2_send_byte(8'h5A);
    expect_ascii("enter key", 8'h0D, 4000);

    event_mark = valid_count;
    ps2_send_extended_byte(8'h6B);
    expect_ascii("left arrow", 8'd130, 4000);

    event_mark = valid_count;
    ps2_send_extended_byte(8'h75);
    expect_ascii("up arrow", 8'd131, 4000);

    event_mark = valid_count;
    ps2_send_extended_byte(8'h71);
    expect_ascii("delete key", 8'd139, 4000);

    ps2_send_byte(8'hE0);
    ps2_send_byte(8'hF0);
    ps2_send_byte(8'h6B);
    expect_no_valid("left release ignored", 1000);

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ PS/2-dekoderen besto alle tester");
    else
      $display("✗ %0d PS/2-feil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #300_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule