`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_disk_tb;

  logic clk = 1'b0;
  logic rst = 1'b1;
  logic [15:0] addr = '0;
  logic [15:0] wdata = '0;
  logic we = 1'b0;
  logic re = 1'b0;
  logic [15:0] rdata;
  logic rdata_valid;
  logic irq_done;
  logic dma_active;
  logic dma_we;
  logic [15:0] dma_addr;
  logic [15:0] dma_wdata;
  logic [15:0] dma_rdata;

  logic [15:0] ram [0:65535];

  int pass_cnt = 0;
  int fail_cnt = 0;
  int irq_count = 0;

  nexa_disk dut (
    .clk(clk),
    .rst(rst),
    .addr(addr),
    .wdata(wdata),
    .we(we),
    .re(re),
    .rdata(rdata),
    .rdata_valid(rdata_valid),
    .irq_done(irq_done),
    .dma_active(dma_active),
    .dma_we(dma_we),
    .dma_addr(dma_addr),
    .dma_wdata(dma_wdata),
    .dma_rdata(dma_rdata)
  );

  always #5 clk = ~clk;

  always_ff @(posedge clk) begin
    if (dma_we) begin
      ram[dma_addr] <= dma_wdata;
      dma_rdata     <= dma_wdata;
    end else begin
      dma_rdata <= ram[dma_addr];
    end
  end

  always_ff @(posedge clk) begin
    if (irq_done)
      irq_count <= irq_count + 1;
  end

  task automatic chk_word(input string desc, input logic [15:0] exp, input logic [15:0] got);
    begin
      if (exp !== got) begin
        $display("  FEIL %-36s exp=0x%04X got=0x%04X", desc, exp, got);
        fail_cnt++;
      end else begin
        $display("  OK   %-36s = 0x%04X", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic chk_int(input string desc, input int got, input int exp_min);
    begin
      if (got < exp_min) begin
        $display("  FEIL %-36s got=%0d min=%0d", desc, got, exp_min);
        fail_cnt++;
      end else begin
        $display("  OK   %-36s got=%0d", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic mmio_write(input logic [3:0] offset, input logic [15:0] value);
    begin
      @(posedge clk);
      addr  <= IO_DISK_BASE + offset;
      wdata <= value;
      we    <= 1'b1;
      re    <= 1'b0;
      @(posedge clk);
      addr  <= '0;
      wdata <= '0;
      we    <= 1'b0;
    end
  endtask

  task automatic mmio_read(input logic [3:0] offset, output logic [15:0] value);
    begin
      @(posedge clk);
      addr <= IO_DISK_BASE + offset;
      re   <= 1'b1;
      we   <= 1'b0;
      @(posedge clk);
      #1;
      value = rdata;
      addr  <= '0;
      re    <= 1'b0;
    end
  endtask

  task automatic wait_for_complete(input int max_cycles);
    int count;
    begin
      count = 0;
      while ((dut.status_reg != 16'h0001) && (dut.status_reg != 16'h0004) && (count < max_cycles)) begin
        @(posedge clk);
        #1;
        count++;
      end
      while ((dut.status_reg == 16'h0001) && (count < max_cycles)) begin
        @(posedge clk);
        #1;
        count++;
      end
      if ((dut.status_reg == 16'h0000) || (dut.status_reg == 16'h0001)) begin
        $display("  FEIL disk timeout after %0d cycles", count);
        fail_cnt++;
      end
    end
  endtask

  integer idx;
  logic [15:0] status_value;
  initial begin
    $dumpfile("sim/nexa_disk_wave.vcd");
    $dumpvars(0, nexa_disk_tb);

    for (idx = 0; idx < 65536; idx = idx + 1)
      ram[idx] = '0;

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 disk DMA controller                ║");
    $display("╚════════════════════════════════════════════╝");

    repeat (4) @(posedge clk);
    rst = 1'b0;
    @(posedge clk);
    #1;

    for (idx = 0; idx < 128; idx = idx + 1)
      dut.storage[(2 * 128) + idx] = 16'h4000 + idx;

    mmio_write(4'h1, 16'd2);
    mmio_write(4'h2, 16'h0200);
    mmio_write(4'h0, 16'h0001);
    wait_for_complete(300);
    mmio_read(4'h3, status_value);

    chk_word("read status complete", 16'h0002, status_value);
    chk_word("read copied first word", 16'h4000, ram[16'h0200]);
    chk_word("read copied last word", 16'h407F, ram[16'h027F]);
    chk_word("command clears after read", 16'h0000, dut.command_reg);
    chk_int("read IRQ observed", irq_count, 1);

    for (idx = 0; idx < 128; idx = idx + 1)
      ram[16'h0300 + idx] = 16'h5000 + idx;

    mmio_write(4'h1, 16'd3);
    mmio_write(4'h2, 16'h0300);
    mmio_write(4'h0, 16'h0002);
    wait_for_complete(300);
    mmio_read(4'h3, status_value);

    chk_word("write status complete", 16'h0002, status_value);
    chk_word("write stored first word", 16'h5000, dut.storage[(3 * 128)]);
    chk_word("write stored last word", 16'h507F, dut.storage[(3 * 128) + 127]);
    chk_int("write IRQ observed", irq_count, 2);

    mmio_write(4'h2, 16'hFF00);
    mmio_write(4'h0, 16'h0001);
    @(posedge clk);
    #1;
    mmio_read(4'h3, status_value);

    chk_word("invalid DMA returns error", 16'h0004, status_value);
    chk_int("error does not raise IRQ", irq_count, 2);

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ Disk-DMA-kontrolleren besto alle tester");
    else
      $display("✗ %0d diskfeil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #5_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule