# FPGA Continuation Notes

## First 10 Minutes Back

When resuming, do this first:

1. Open `FPGA/src/nexa_top.sv` and `FPGA/constraints/basys3.xdc`.
2. Confirm the active board target is still Basys 3.
3. Check that `FPGA/sim/fixtures/` still contains the expected boot and test fixture files.
4. Run or prepare the Vivado build for `nexa_top`.
5. If building on Windows again, verify tool paths before assuming `make` is available.
6. Start hardware bring-up in this order: UART, LEDs/7-seg, VGA, PS/2, NexaOS boot, `RUN HELLO.NXE`.

## Where We Paused

The FPGA work is in a good pause state.

- The FPGA tree was cleaned up.
- Simulation artifacts are no longer mixed with source files.
- Canonical sim inputs now live under `FPGA/sim/fixtures/`.
- Basys 3 is the active board target.
- Key top-level integration benches were run and passed.

This is a reasonable checkpoint to resume later with Vivado build and real board bring-up.

## Current Assessment

The design is ready enough for Basys 3 hardware bring-up, but it is not yet a fully finished board release.

What is likely ready:

- CPU core
- BRAM boot image loading
- VGA output
- UART
- PS/2 keyboard path
- Disk image preload and disk DMA path
- FPGA-side exec-loader for `RUN`
- LEDs and seven-segment output

What is not fully finished:

- Vivado synthesis/implementation has not been completed in this session
- Timing closure on Basys 3 has not been proven yet
- Physical audio output is not wired for the board yet
- Full on-board smoke test has not been performed yet

## Board Target

- Top module: `FPGA/src/nexa_top.sv`
- Basys 3 constraints: `FPGA/constraints/basys3.xdc`
- Part in Makefile: `xc7a35tcpg236-1`

## Important Project Layout

- RTL: `FPGA/src/`
- Constraints: `FPGA/constraints/`
- Memory images: `FPGA/mem/`
- Testbenches: `FPGA/sim/`
- Sim fixtures: `FPGA/sim/fixtures/`

Notes:

- Generated sim outputs (`.out`, `.vcd`, `.log`) should remain disposable.
- Some fixture `.mem` files are generated from matching `.asm` files.
- Avoid reintroducing generated files into version control.

## What Was Validated

The following FPGA integration benches passed during the last session:

- `nexa_top_ps2_tb`
- `nexa_top_sound_tb`
- `nexa_top_disk_init_tb`
- `nexa_top_vga_pixel_tb`
- `nexa_top_vga_tb`
- `nexa_top_exec_loader_tb`
- `nexa_top_exec_hello_tb`

Meaning:

- PS/2 path works in simulation
- Sound logic works in simulation
- VGA text and pixel rendering work in simulation
- Preloaded disk image path works in simulation
- Exec-loader path works in simulation
- HELLO.NXE boot and run flow works in simulation

## Changes Made Before Pausing

- Cleaned `FPGA/sim/` of committed simulator outputs
- Added cleanup and ignore rules for generated FPGA sim files
- Split testbenches from fixtures
- Updated benches to use `sim/fixtures/`
- Fixed stale VGA bench hierarchy references after the generated VGA block change
- Updated the synthetic exec-loader bench so it validates loader behavior directly

## Known Gaps

1. Vivado build has not been run to completion here.
2. No confirmed Basys 3 bitstream has been produced in this session.
3. Audio is still internal/simulation-side only unless board output wiring is added.
4. Real monitor/keyboard/UART behavior on the physical board still needs smoke testing.

## Resume Plan

When continuing, use this order:

1. Run Vivado synthesis against `FPGA/src/nexa_top.sv` with `FPGA/constraints/basys3.xdc`.
2. Check for synthesis errors and implementation warnings.
3. Generate a bitstream.
4. Program the Basys 3 board.
5. Do staged hardware bring-up:
   - UART first
   - LEDs and seven-segment
   - VGA
   - PS/2 keyboard
   - NexaOS boot
   - `RUN HELLO.NXE`

## Suggested Bring-Up Order

### Stage 1: Minimal life signs

- Confirm clock and reset behavior
- Confirm LEDs change as expected
- Confirm seven-segment display updates

### Stage 2: UART console

- Connect over the Basys 3 USB UART
- Verify serial settings and boot text behavior

### Stage 3: VGA

- Confirm sync and visible output on a real monitor
- Check text mode first, then pixel mode

### Stage 4: Keyboard

- Test PS/2 input path with simple key input

### Stage 5: Boot and exec-loader flow

- Confirm NexaOS boots from the preloaded image
- Confirm `RUN HELLO.NXE` works on actual hardware

## Files To Inspect First Next Time

- `FPGA/src/nexa_top.sv`
- `FPGA/constraints/basys3.xdc`
- `FPGA/Makefile`
- `FPGA/README.md`
- `FPGA/mem/nexaos_boot.mem`
- `FPGA/mem/nexaos_system_disk.mem`

If debugging board behavior, also inspect:

- `FPGA/src/nexa_io.sv`
- `FPGA/src/nexa_vga.sv`
- `FPGA/src/nexa_disk.sv`
- `FPGA/src/nexa_sound.sv`

## Practical Notes

- The shell used during validation did not have `make`, so direct `python`, `iverilog`, and `vvp` commands were used.
- That does not block Vivado-based continuation, but expect tool-path differences between shells on Windows.
- If resuming on the same machine, verify the active shell and tool paths before assuming the Makefile will work unchanged.

## Decision Point For Later

Once Basys 3 bring-up starts, decide whether audio should be:

- left as simulation/internal only for now, or
- wired to a real Basys 3-compatible output path as the next hardware feature

## Bottom Line

This is not the end of the FPGA effort, but it is a clean handoff point.

Resume with Vivado build plus staged Basys 3 hardware smoke testing.