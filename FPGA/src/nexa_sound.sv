`timescale 1ns/1ps

module nexa_sound #(
  parameter int CLK_HZ    = 100_000_000,
  parameter int SAMPLE_HZ = 1_000_000
) (
  input  logic               clk,
  input  logic               rst,
  input  logic [15:0]        sound_period  [0:3],
  input  logic [15:0]        sound_control [0:3],
  output logic               audio_pwm,
  output logic [7:0]         mix_level_dbg,
  output logic signed [11:0] mix_sample_dbg
);

  localparam int SAMPLE_DIV = CLK_HZ / SAMPLE_HZ;
  localparam int SAMPLE_DIV_W = (SAMPLE_DIV <= 1) ? 1 : $clog2(SAMPLE_DIV);

  logic [SAMPLE_DIV_W-1:0] sample_divider;
  logic                    sample_tick;

  logic [15:0] tone_phase [0:2];
  logic [15:0] noise_lfsr;
  logic [15:0] noise_counter;
  logic signed [11:0] mixed_sample;
  logic signed [11:0] tone_sample_0;
  logic signed [11:0] tone_sample_1;
  logic signed [11:0] tone_sample_2;
  logic signed [11:0] noise_sample_3;
  logic [8:0] pwm_accum;

  function automatic logic tone_enabled(input logic [15:0] control, input logic [15:0] period);
    tone_enabled = control[3] && (period != 16'h0000);
  endfunction

  function automatic logic [15:0] phase_step(input logic [15:0] period);
    logic [31:0] step_value;
    begin
      if (period <= 16'd1)
        phase_step = 16'hFFFF;
      else begin
        step_value = 32'd65536 / period;
        if (step_value == 0)
          phase_step = 16'd1;
        else if (step_value > 32'd65535)
          phase_step = 16'hFFFF;
        else
          phase_step = step_value[15:0];
      end
    end
  endfunction

  function automatic signed [11:0] tone_sample(
    input logic [15:0] phase,
    input logic [1:0]  waveform,
    input logic [3:0]  volume
  );
    integer signed amplitude;
    integer signed ramp;
    begin
      amplitude = volume * 8;
      case (waveform)
        2'd1: begin
          ramp = phase[15] ? (127 - $signed({1'b0, phase[14:8]})) : $signed({1'b0, phase[14:8]});
          tone_sample = ((ramp * (amplitude * 2 + 1)) >>> 6) - amplitude;
        end
        2'd2,
        2'd3: begin
          ramp = $signed({1'b0, phase[15:8]}) - 128;
          tone_sample = (ramp * amplitude) >>> 7;
        end
        default: begin
          tone_sample = phase[15] ? amplitude : -amplitude;
        end
      endcase
    end
  endfunction

  function automatic signed [11:0] noise_sample(
    input logic        bit_value,
    input logic [3:0]  volume
  );
    integer signed amplitude;
    begin
      amplitude = volume * 8;
      noise_sample = bit_value ? amplitude : -amplitude;
    end
  endfunction

  integer ch;
  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      sample_divider <= '0;
      sample_tick    <= 1'b0;
      for (ch = 0; ch < 3; ch = ch + 1)
        tone_phase[ch] <= '0;
      noise_lfsr    <= 16'hACE1;
      noise_counter <= 16'd1;
    end else begin
      sample_tick <= 1'b0;
      if (sample_divider == SAMPLE_DIV - 1) begin
        sample_divider <= '0;
        sample_tick    <= 1'b1;

        for (ch = 0; ch < 3; ch = ch + 1) begin
          if (tone_enabled(sound_control[ch], sound_period[ch]))
            tone_phase[ch] <= tone_phase[ch] + phase_step(sound_period[ch]);
          else
            tone_phase[ch] <= '0;
        end

        if (tone_enabled(sound_control[3], sound_period[3])) begin
          if (noise_counter <= 16'd1) begin
            noise_lfsr <= {noise_lfsr[14:0], noise_lfsr[15] ^ noise_lfsr[13] ^ noise_lfsr[12] ^ noise_lfsr[10]};
            case (sound_control[3][9:8])
              2'd0: noise_counter <= sound_period[3];
              2'd1: noise_counter <= sound_period[3] + (sound_period[3] >> 1);
              2'd2: noise_counter <= sound_period[3] + sound_period[3];
              default: noise_counter <= sound_period[3] + (sound_period[3] << 1);
            endcase
          end else begin
            noise_counter <= noise_counter - 16'd1;
          end
        end else begin
          noise_counter <= 16'd1;
          noise_lfsr    <= 16'hACE1;
        end
      end else begin
        sample_divider <= sample_divider + 1'b1;
      end
    end
  end

  assign tone_sample_0 = tone_enabled(sound_control[0], sound_period[0])
                       ? tone_sample(tone_phase[0], sound_control[0][9:8], sound_control[0][7:4])
                       : 12'sd0;
  assign tone_sample_1 = tone_enabled(sound_control[1], sound_period[1])
                       ? tone_sample(tone_phase[1], sound_control[1][9:8], sound_control[1][7:4])
                       : 12'sd0;
  assign tone_sample_2 = tone_enabled(sound_control[2], sound_period[2])
                       ? tone_sample(tone_phase[2], sound_control[2][9:8], sound_control[2][7:4])
                       : 12'sd0;
  assign noise_sample_3 = tone_enabled(sound_control[3], sound_period[3])
                        ? noise_sample(noise_lfsr[0], sound_control[3][7:4])
                        : 12'sd0;
  assign mixed_sample = tone_sample_0 + tone_sample_1 + tone_sample_2 + noise_sample_3;

  assign mix_level_dbg = (mixed_sample > 12'sd127)   ? 8'hFF :
                         (mixed_sample < -12'sd128) ? 8'h00 :
                         (mixed_sample[7:0] + 8'h80);

  assign mix_sample_dbg = mixed_sample;

  always_ff @(posedge clk or posedge rst) begin
    if (rst) begin
      pwm_accum <= '0;
      audio_pwm <= 1'b0;
    end else begin
      pwm_accum <= {1'b0, pwm_accum[7:0]} + {1'b0, mix_level_dbg};
      audio_pwm <= pwm_accum[8];
    end
  end

endmodule