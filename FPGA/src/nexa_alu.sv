// nexa_alu.sv — Nexa-16 ALU
// Fasit: cpu.js execALU() og execALU2()
`timescale 1ns/1ps
import nexa_pkg::*;

module nexa_alu (
  input  logic [15:0] src_a,
  input  logic [15:0] src_b,
  input  logic [3:0]  op,
  input  logic [2:0]  subop,
  output logic [15:0] result,
  output logic        flag_n,
  output logic        flag_z
);
  // Compute all results combinationally — no bit-selects inside always_comb
  // (iverilog 12 "constant selects" workaround: use assign for individual results)
  wire [15:0] r_add  = (src_a + src_b) & 16'hFFFF;
  wire [15:0] r_sub  = (src_a - src_b) & 16'hFFFF;
  wire [15:0] r_and  = src_a & src_b;
  wire [15:0] r_or   = src_a | src_b;
  wire [15:0] r_not  = ~src_a;
  wire [15:0] r_shl  = {src_a[14:0], 1'b0};
  wire [15:0] r_asr  = {src_a[15], src_a[15:1]};   // ASR: sign-extend
  wire [15:0] r_mov  = src_b;
  wire [15:0] r_xor  = src_a ^ src_b;

  logic [15:0] r;

  always_comb begin
    // Select based on opcode and subop (using == comparisons only)
    if (op == 4'd2)      r = r_add;
    else if (op == 4'd3) r = r_sub;
    else if (op == 4'd4) r = r_and;
    else if (op == 4'd5) r = r_or;
    else if (op == 4'd6) begin
      if      (subop == 3'd0) r = r_not;
      else if (subop == 3'd1) r = r_shl;
      else if (subop == 3'd2) r = r_asr;
      else if (subop == 3'd3) r = r_mov;
      else if (subop == 3'd4) r = r_xor;
      else                    r = 16'h0;
    end
    else r = 16'h0;
  end

  assign result = r;
  assign flag_n = r[15];
  assign flag_z = (r == 16'h0);
endmodule
