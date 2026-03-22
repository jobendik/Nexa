`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_disk #(
  parameter INIT_FILE = ""
) (
  input  logic        clk,
  input  logic        rst,
  input  logic [15:0] addr,
  input  logic [15:0] wdata,
  input  logic        we,
  input  logic        re,
  output logic [15:0] rdata,
  output logic        rdata_valid,
  output logic        irq_done,
  input  logic        ctrl_start_read,
  input  logic [7:0]  ctrl_sector,
  input  logic [15:0] ctrl_mem_addr,
  output logic        ctrl_busy,
  output logic        ctrl_done,
  output logic        ctrl_error,
  output logic        dma_active,
  output logic        dma_we,
  output logic [15:0] dma_addr,
  output logic [15:0] dma_wdata,
  input  logic [15:0] dma_rdata
);

  localparam int DISK_SECTORS = 256;
  localparam int SECTOR_SIZE  = 128;
  localparam int DISK_WORDS   = DISK_SECTORS * SECTOR_SIZE;

  typedef enum logic [1:0] {
    DISK_IDLE  = 2'd0,
    DISK_READ  = 2'd1,
    DISK_WRITE = 2'd2
  } disk_state_t;

  logic [15:0] storage [0:DISK_WORDS-1];

  logic [15:0] command_reg;
  logic [15:0] sector_reg;
  logic [15:0] mem_addr_reg;
  logic [15:0] status_reg;

  disk_state_t state;
  logic [14:0] sector_base;
  logic [7:0]  req_index;
  logic [7:0]  rsp_index;
  logic        write_pipe_valid;
  logic        active_irq_enable;

  logic [16:0] dma_end_addr;
  logic        dma_addr_invalid;
  logic [14:0] current_word_index;

  assign dma_end_addr     = {1'b0, mem_addr_reg} + 17'(SECTOR_SIZE - 1);
  assign dma_addr_invalid = ({1'b0, mem_addr_reg} >= {1'b0, IO_BASE}) || (dma_end_addr >= {1'b0, IO_BASE});

  assign dma_active = (state != DISK_IDLE);
  assign ctrl_busy  = (state != DISK_IDLE);
  assign dma_we     = (state == DISK_READ);
  assign dma_addr   = mem_addr_reg + req_index;
  assign current_word_index = sector_base + req_index;
  assign dma_wdata  = storage[current_word_index];

`ifdef SIMULATION
  task automatic load_init_file;
    integer fd;
    integer scan_result;
    integer next_addr;
    integer line_addr;
    logic [15:0] line_word;
    reg [8*256-1:0] line_buf;
    begin
      fd = $fopen(INIT_FILE, "r");
      if (fd == 0) begin
        $error("nexa_disk: could not open init file %s", INIT_FILE);
      end else begin
        next_addr = 0;
        while (!$feof(fd)) begin
          line_buf = '0;
          void'($fgets(line_buf, fd));

          scan_result = $sscanf(line_buf, "@%h", line_addr);
          if (scan_result == 1) begin
            next_addr = line_addr;
          end else begin
            scan_result = $sscanf(line_buf, "%h", line_word);
            if (scan_result == 1) begin
              if (next_addr >= 0 && next_addr < DISK_WORDS) begin
                storage[next_addr] = line_word;
                next_addr = next_addr + 1;
              end else begin
                $error("nexa_disk: init address 0x%0h out of range for %s", next_addr, INIT_FILE);
              end
            end
          end
        end
        $fclose(fd);
      end
    end
  endtask
`endif

  integer disk_idx;
  initial begin
    for (disk_idx = 0; disk_idx < DISK_WORDS; disk_idx = disk_idx + 1)
      storage[disk_idx] = '0;
    if (INIT_FILE != "") begin
`ifdef SIMULATION
      load_init_file();
`else
      $readmemh(INIT_FILE, storage);
`endif
    end
  end

  always_ff @(posedge clk or posedge rst) begin
    logic [1:0] command_value;
    logic [14:0] next_sector_base;
    if (rst) begin
      command_reg       <= '0;
      sector_reg        <= '0;
      mem_addr_reg      <= '0;
      status_reg        <= '0;
      state             <= DISK_IDLE;
      sector_base       <= '0;
      req_index         <= '0;
      rsp_index         <= '0;
      write_pipe_valid  <= 1'b0;
      irq_done          <= 1'b0;
      ctrl_done         <= 1'b0;
      ctrl_error        <= 1'b0;
      active_irq_enable <= 1'b0;
    end else begin
      irq_done   <= 1'b0;
      ctrl_done  <= 1'b0;
      ctrl_error <= 1'b0;

      case (state)
        DISK_READ: begin
          if (req_index == SECTOR_SIZE - 1) begin
            state      <= DISK_IDLE;
            req_index  <= '0;
            status_reg <= 16'h0002;
            if (active_irq_enable)
              irq_done <= 1'b1;
            else
              ctrl_done <= 1'b1;
          end else begin
            req_index <= req_index + 8'd1;
          end
        end

        DISK_WRITE: begin
          if (write_pipe_valid) begin
            storage[sector_base + rsp_index] <= dma_rdata;
            if (rsp_index == SECTOR_SIZE - 1) begin
              state            <= DISK_IDLE;
              req_index        <= '0;
              rsp_index        <= '0;
              write_pipe_valid <= 1'b0;
              status_reg       <= 16'h0002;
              if (active_irq_enable)
                irq_done <= 1'b1;
              else
                ctrl_done <= 1'b1;
            end else begin
              rsp_index <= rsp_index + 8'd1;
            end
          end else begin
            write_pipe_valid <= 1'b1;
          end

          if (req_index < SECTOR_SIZE - 1)
            req_index <= req_index + 8'd1;
        end

        default: begin
        end
      endcase

      if ((state == DISK_IDLE) && ctrl_start_read) begin
        sector_reg   <= {8'h0, ctrl_sector};
        mem_addr_reg <= ctrl_mem_addr;
        if ((({1'b0, ctrl_mem_addr} + 17'(SECTOR_SIZE - 1)) >= {1'b0, IO_BASE}) || ({1'b0, ctrl_mem_addr} >= {1'b0, IO_BASE})) begin
          command_reg <= '0;
          status_reg  <= 16'h0004;
          ctrl_error  <= 1'b1;
        end else begin
          sector_base       <= {ctrl_sector, 7'b0};
          req_index         <= '0;
          rsp_index         <= '0;
          status_reg        <= 16'h0001;
          command_reg       <= '0;
          write_pipe_valid  <= 1'b0;
          active_irq_enable <= 1'b0;
          state             <= DISK_READ;
        end
      end else if (we) begin
        case (addr[3:0])
          4'h0: begin
            command_value = wdata[1:0];
            command_reg   <= {14'h0, command_value};
            if ((state == DISK_IDLE) && (command_value != 2'b00)) begin
              next_sector_base = {sector_reg[7:0], 7'b0};
              if (dma_addr_invalid) begin
                command_reg <= '0;
                status_reg  <= 16'h0004;
              end else begin
                sector_base       <= next_sector_base;
                req_index         <= '0;
                rsp_index         <= '0;
                status_reg        <= 16'h0001;
                command_reg       <= '0;
                active_irq_enable <= 1'b1;
                if (command_value == 2'b01) begin
                  state <= DISK_READ;
                end else if (command_value == 2'b10) begin
                  state            <= DISK_WRITE;
                  write_pipe_valid <= 1'b0;
                end else begin
                  status_reg <= 16'h0004;
                end
              end
            end else if ((state == DISK_IDLE) && (command_value == 2'b00)) begin
              command_reg <= '0;
            end
          end

          4'h1: begin
            if (state == DISK_IDLE)
              sector_reg <= wdata & 16'h00FF;
          end

          4'h2: begin
            if (state == DISK_IDLE)
              mem_addr_reg <= wdata;
          end

          default: begin
          end
        endcase
      end
    end
  end

  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      rdata       <= '0;
      rdata_valid <= 1'b0;
    end else begin
      rdata_valid <= 1'b0;
      if (re) begin
        rdata_valid <= 1'b1;
        case (addr[3:0])
          4'h0: rdata <= command_reg;
          4'h1: rdata <= sector_reg;
          4'h2: rdata <= mem_addr_reg;
          4'h3: rdata <= status_reg;
          default: rdata <= '0;
        endcase
      end
    end
  end

endmodule