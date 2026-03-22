`timescale 1ns/1ps

module nexa_sound_tb;

  logic clk = 1'b0;
  logic rst = 1'b0;
  logic [15:0] sound_period [0:3];
  logic [15:0] sound_control [0:3];
  logic audio_pwm;
  logic [7:0] mix_level_dbg;
  logic signed [11:0] mix_sample_dbg;

  int pass_cnt = 0;
  int fail_cnt = 0;

  nexa_sound dut (
    .clk(clk),
    .rst(rst),
    .sound_period(sound_period),
    .sound_control(sound_control),
    .audio_pwm(audio_pwm),
    .mix_level_dbg(mix_level_dbg),
    .mix_sample_dbg(mix_sample_dbg)
  );

  always #5 clk = ~clk;

  task automatic reset_dut();
    int idx;
    begin
      rst = 1'b1;
      for (idx = 0; idx < 4; idx++) begin
        sound_period[idx] = 16'h0000;
        sound_control[idx] = 16'h0000;
      end
      repeat (8) @(posedge clk);
      #1;
      rst = 1'b0;
      repeat (8) @(posedge clk);
      #1;
    end
  endtask

  task automatic chk_signed_zero(input string desc, input logic signed [11:0] got);
    begin
      if (got !== 12'sd0) begin
        $display("  FEIL %-34s exp=0 got=%0d", desc, got);
        fail_cnt++;
      end else begin
        $display("  OK   %-34s = %0d", desc, got);
        pass_cnt++;
      end
    end
  endtask

  task automatic observe_window(
    input int cycles,
    output int min_sample,
    output int max_sample,
    output int pwm_toggles,
    output int sample_changes
  );
    int idx;
    logic prev_pwm;
    logic signed [11:0] prev_sample;
    begin
      min_sample =  100000;
      max_sample = -100000;
      pwm_toggles = 0;
      sample_changes = 0;
      prev_pwm = audio_pwm;
      prev_sample = mix_sample_dbg;
      for (idx = 0; idx < cycles; idx++) begin
        @(posedge clk);
        #1;
        if ($signed(mix_sample_dbg) < min_sample)
          min_sample = $signed(mix_sample_dbg);
        if ($signed(mix_sample_dbg) > max_sample)
          max_sample = $signed(mix_sample_dbg);
        if (audio_pwm != prev_pwm)
          pwm_toggles++;
        if (mix_sample_dbg != prev_sample)
          sample_changes++;
        prev_pwm = audio_pwm;
        prev_sample = mix_sample_dbg;
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
  int pwm_toggles;
  int sample_changes;

  initial begin
    $dumpfile("sim/nexa_sound_wave.vcd");
    $dumpvars(0, nexa_sound_tb);

    $display("╔════════════════════════════════════════════╗");
    $display("║  Nexa-16 sound generator verification       ║");
    $display("╚════════════════════════════════════════════╝");

    reset_dut();
    chk_signed_zero("silence sample", mix_sample_dbg);

    sound_period[0] = 16'd1000;
    sound_control[0] = 16'h0098;
    observe_window(250000, min_sample, max_sample, pwm_toggles, sample_changes);
    chk_range("square spans +/-", (min_sample < 0) && (max_sample > 0), min_sample, max_sample);
    chk_range("square pwm toggles", pwm_toggles > 100, pwm_toggles, 100);

    sound_control[0] = 16'h0198;
    observe_window(250000, min_sample, max_sample, pwm_toggles, sample_changes);
    chk_range("triangle varies", sample_changes > 20, sample_changes, 20);
    chk_range("triangle spans", (min_sample < 0) && (max_sample > 0), min_sample, max_sample);

    sound_period[3] = 16'd128;
    sound_control[3] = 16'h01C8;
    observe_window(150000, min_sample, max_sample, pwm_toggles, sample_changes);
    chk_range("noise changes sample", sample_changes > 20, sample_changes, 20);

    sound_control[0] = 16'h0000;
    sound_control[3] = 16'h0000;
    repeat (1000) @(posedge clk);
    #1;
    chk_signed_zero("silence after disable", mix_sample_dbg);

    $display("\n╔════════════════════════════════════════════╗");
    $display("║  Resultat: %2d bestått, %2d feil             ║", pass_cnt, fail_cnt);
    $display("╚════════════════════════════════════════════╝");
    if (fail_cnt == 0)
      $display("✓ Lydgeneratoren besto alle tester");
    else
      $display("✗ %0d lydfeil gjenstår", fail_cnt);
    $finish;
  end

  initial begin
    #400_000_000;
    $display("GLOBAL TIMEOUT");
    $finish;
  end

endmodule