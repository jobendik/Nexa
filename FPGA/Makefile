## ============================================================
## Makefile — Nexa-16 FPGA Byggeverktøy
##
## Mål:
##   make sim       — Kjør simulering med iverilog + GTKWave
##   make asm FILE=program.asm — Assembler en .asm-fil
##   make synth     — Synthesiser med Vivado (batch-modus)
##   make clean     — Slett bygge-filer
## ============================================================

# ─── Konfigurasjon ────────────────────────────────────────────
TOP       = nexa_top
TESTBENCH = nexa_tb
SOURCES   = src/nexa_pkg.sv \
	        src/nexa_alu.sv \
	        src/nexa_ram.sv \
	        src/nexa_uart.sv \
	        src/nexa_disk.sv \
	        src/nexa_sound.sv \
	        src/nexa_io.sv \
	        src/nexa_cpu.sv \
	        src/nexa_vga.sv \
	        src/nexa_top.sv
VGA_SOURCES = src/nexa_pkg.sv \
	          src/nexa_vga.sv
TOP_VGA_SOURCES = src/nexa_pkg.sv \
	              src/nexa_alu.sv \
	              src/nexa_ram.sv \
	              src/nexa_uart.sv \
	              src/nexa_disk.sv \
	              src/nexa_sound.sv \
	              src/nexa_io.sv \
	              src/nexa_cpu.sv \
	              src/nexa_vga.sv \
	              src/nexa_top.sv
SIM_DIR   = sim
SIM_FIXTURE_DIR = $(SIM_DIR)/fixtures
MEM_DIR   = mem

# Vivado-innstillinger (juster til riktig sti)
VIVADO    = vivado
PART      = xc7a35tcpg236-1    # Basys 3
PYTHON    := $(shell command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo python3)
IVERILOG  := $(shell command -v iverilog 2>/dev/null || command -v /ucrt64/bin/iverilog 2>/dev/null || echo iverilog)
VVP       := $(shell command -v vvp 2>/dev/null || command -v /ucrt64/bin/vvp 2>/dev/null || echo vvp)

# iverilog-flagg
IVFLAGS   = -g2012 -Wall -Wno-sensitivity-entire-vector

# ─── Simulering med iverilog ──────────────────────────────────
.PHONY: sim
sim: $(SIM_DIR)/nexa_wave.vcd
	@echo "Åpner GTKWave..."
	gtkwave $(SIM_DIR)/nexa_wave.vcd $(SIM_DIR)/wave.gtkw 2>/dev/null || \
	gtkwave $(SIM_DIR)/nexa_wave.vcd &

.PHONY: sim-vga
sim-vga: $(SIM_DIR)/nexa_vga_wave.vcd
	@echo "VGA-simulering fullført: $(SIM_DIR)/nexa_vga_wave.vcd"

.PHONY: sim-top-vga
sim-top-vga: $(SIM_DIR)/nexa_top_vga_wave.vcd
	@echo "Top-level VGA-simulering fullført: $(SIM_DIR)/nexa_top_vga_wave.vcd"

.PHONY: sim-top-vga-pixel
sim-top-vga-pixel: $(SIM_DIR)/nexa_top_vga_pixel_wave.vcd
	@echo "Top-level pixel-VGA-simulering fullført: $(SIM_DIR)/nexa_top_vga_pixel_wave.vcd"

.PHONY: sim-ps2
sim-ps2: $(SIM_DIR)/nexa_ps2_wave.vcd
	@echo "PS/2-simulering fullført: $(SIM_DIR)/nexa_ps2_wave.vcd"

.PHONY: sim-top-ps2
sim-top-ps2: $(SIM_DIR)/nexa_top_ps2_wave.vcd
	@echo "Top-level PS/2-simulering fullført: $(SIM_DIR)/nexa_top_ps2_wave.vcd"

.PHONY: sim-sound
sim-sound: $(SIM_DIR)/nexa_sound_wave.vcd
	@echo "Sound-simulering fullført: $(SIM_DIR)/nexa_sound_wave.vcd"

.PHONY: sim-top-sound
sim-top-sound: $(SIM_DIR)/nexa_top_sound_wave.vcd
	@echo "Top-level sound-simulering fullført: $(SIM_DIR)/nexa_top_sound_wave.vcd"

.PHONY: sim-disk
sim-disk: $(SIM_DIR)/nexa_disk_wave.vcd
	@echo "Disk-simulering fullført: $(SIM_DIR)/nexa_disk_wave.vcd"

.PHONY: sim-top-disk
sim-top-disk: $(SIM_DIR)/nexa_top_disk_wave.vcd
	@echo "Top-level disk-simulering fullført: $(SIM_DIR)/nexa_top_disk_wave.vcd"

.PHONY: sim-top-disk-init
sim-top-disk-init: $(SIM_DIR)/nexa_top_disk_init_wave.vcd
	@echo "Top-level disk-init-simulering fullført: $(SIM_DIR)/nexa_top_disk_init_wave.vcd"

.PHONY: system-image
system-image:
	node ../tools/build_fpga_system_image.js

.PHONY: sim-top-boot-os
sim-top-boot-os: $(SIM_DIR)/nexa_top_boot_os_wave.vcd
	@echo "Top-level NexaOS-boot-simulering fullført: $(SIM_DIR)/nexa_top_boot_os_wave.vcd"

.PHONY: sim-top-exec-loader
sim-top-exec-loader: $(SIM_DIR)/nexa_top_exec_loader_wave.vcd
	@echo "Top-level exec-loader-simulering fullført: $(SIM_DIR)/nexa_top_exec_loader_wave.vcd"

.PHONY: sim-top-exec-hello
sim-top-exec-hello: $(SIM_DIR)/nexa_top_exec_hello_wave.vcd
	@echo "Top-level HELLO.NXE exec-loader-simulering fullført: $(SIM_DIR)/nexa_top_exec_hello_wave.vcd"

$(SIM_DIR)/nexa_wave.vcd: $(SIM_DIR)/sim.out $(MEM_DIR)/test.mem
	@echo "Kjører simulering..."
	$(VVP) $(SIM_DIR)/sim.out

$(SIM_FIXTURE_DIR)/%.mem: $(SIM_FIXTURE_DIR)/%.asm nexa_asm.py
	$(PYTHON) nexa_asm.py $< -o $@

$(SIM_DIR)/sim.out: $(SOURCES) $(SIM_DIR)/nexa_tb.sv
	@echo "Kompilerer med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_tb.sv


$(SIM_DIR)/nexa_vga_wave.vcd: $(SIM_DIR)/nexa_vga.out $(SIM_FIXTURE_DIR)/vga_preload.mem
	@echo "Kjører VGA-simulering..."
	$(VVP) $(SIM_DIR)/nexa_vga.out

$(SIM_DIR)/nexa_vga.out: $(VGA_SOURCES) $(SIM_DIR)/nexa_vga_tb.sv
	@echo "Kompilerer VGA-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(VGA_SOURCES) $(SIM_DIR)/nexa_vga_tb.sv

$(SIM_DIR)/nexa_top_vga_wave.vcd: $(SIM_DIR)/nexa_top_vga.out $(SIM_FIXTURE_DIR)/top_vga_program.mem
	@echo "Kjører top-level VGA-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_vga.out

$(SIM_DIR)/nexa_top_vga.out: $(TOP_VGA_SOURCES) $(SIM_DIR)/nexa_top_vga_tb.sv
	@echo "Kompilerer top-level VGA-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(TOP_VGA_SOURCES) $(SIM_DIR)/nexa_top_vga_tb.sv

$(SIM_DIR)/nexa_top_vga_pixel_wave.vcd: $(SIM_DIR)/nexa_top_vga_pixel.out $(SIM_FIXTURE_DIR)/top_vga_pixel_program.mem
	@echo "Kjører top-level pixel-VGA-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_vga_pixel.out

$(SIM_DIR)/nexa_top_vga_pixel.out: $(TOP_VGA_SOURCES) $(SIM_DIR)/nexa_top_vga_pixel_tb.sv
	@echo "Kompilerer top-level pixel-VGA-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(TOP_VGA_SOURCES) $(SIM_DIR)/nexa_top_vga_pixel_tb.sv

$(SIM_DIR)/nexa_ps2_wave.vcd: $(SIM_DIR)/nexa_ps2.out
	@echo "Kjører PS/2-simulering..."
	$(VVP) $(SIM_DIR)/nexa_ps2.out

$(SIM_DIR)/nexa_ps2.out: $(SOURCES) $(SIM_DIR)/nexa_ps2_tb.sv
	@echo "Kompilerer PS/2-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_ps2_tb.sv

$(SIM_DIR)/nexa_top_ps2_wave.vcd: $(SIM_DIR)/nexa_top_ps2.out $(SIM_FIXTURE_DIR)/top_ps2_program.mem
	@echo "Kjører top-level PS/2-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_ps2.out

$(SIM_DIR)/nexa_top_ps2.out: $(SOURCES) $(SIM_DIR)/nexa_top_ps2_tb.sv
	@echo "Kompilerer top-level PS/2-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_top_ps2_tb.sv

$(SIM_DIR)/nexa_sound_wave.vcd: $(SIM_DIR)/nexa_sound.out
	@echo "Kjører sound-simulering..."
	$(VVP) $(SIM_DIR)/nexa_sound.out

$(SIM_DIR)/nexa_sound.out: $(SOURCES) $(SIM_DIR)/nexa_sound_tb.sv
	@echo "Kompilerer sound-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_sound_tb.sv

$(SIM_DIR)/nexa_top_sound_wave.vcd: $(SIM_DIR)/nexa_top_sound.out $(SIM_FIXTURE_DIR)/top_sound_program.mem
	@echo "Kjører top-level sound-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_sound.out

$(SIM_DIR)/nexa_top_sound.out: $(SOURCES) $(SIM_DIR)/nexa_top_sound_tb.sv
	@echo "Kompilerer top-level sound-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_top_sound_tb.sv

$(SIM_DIR)/nexa_disk_wave.vcd: $(SIM_DIR)/nexa_disk.out
	@echo "Kjører disk-simulering..."
	$(VVP) $(SIM_DIR)/nexa_disk.out

$(SIM_DIR)/nexa_disk.out: $(SOURCES) $(SIM_DIR)/nexa_disk_tb.sv
	@echo "Kompilerer disk-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_disk_tb.sv

$(SIM_DIR)/nexa_top_disk_wave.vcd: $(SIM_DIR)/nexa_top_disk.out $(SIM_FIXTURE_DIR)/top_disk_program.mem
	@echo "Kjører top-level disk-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_disk.out

$(SIM_DIR)/nexa_top_disk.out: $(SOURCES) $(SIM_DIR)/nexa_top_disk_tb.sv
	@echo "Kompilerer top-level disk-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_top_disk_tb.sv

$(SIM_DIR)/nexa_top_disk_init_wave.vcd: $(SIM_DIR)/nexa_top_disk_init.out $(SIM_FIXTURE_DIR)/top_disk_init_program.mem $(MEM_DIR)/nexaos_blank_disk.mem
	@echo "Kjører top-level disk-init-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_disk_init.out

$(SIM_DIR)/nexa_top_disk_init.out: $(SOURCES) $(SIM_DIR)/nexa_top_disk_init_tb.sv
	@echo "Kompilerer top-level disk-init-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_top_disk_init_tb.sv

$(SIM_DIR)/nexa_top_boot_os_wave.vcd: $(SIM_DIR)/nexa_top_boot_os.out $(MEM_DIR)/nexaos_boot.mem $(MEM_DIR)/nexaos_system_disk.mem
	@echo "Kjører top-level NexaOS-boot-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_boot_os.out

$(SIM_DIR)/nexa_top_boot_os.out: $(SOURCES) $(SIM_DIR)/nexa_top_boot_os_tb.sv
	@echo "Kompilerer top-level NexaOS-boot-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_top_boot_os_tb.sv

$(SIM_DIR)/nexa_top_exec_loader_wave.vcd: $(SIM_DIR)/nexa_top_exec_loader.out $(SIM_FIXTURE_DIR)/top_exec_loader_boot.mem $(SIM_FIXTURE_DIR)/top_exec_loader_program.mem
	@echo "Kjører top-level exec-loader-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_exec_loader.out +dump

$(SIM_DIR)/nexa_top_exec_loader.out: $(SOURCES) $(SIM_DIR)/nexa_top_exec_loader_tb.sv $(SIM_FIXTURE_DIR)/top_exec_loader_boot.mem $(SIM_FIXTURE_DIR)/top_exec_loader_program.mem
	@echo "Kompilerer top-level exec-loader-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_top_exec_loader_tb.sv

$(SIM_DIR)/nexa_top_exec_hello_wave.vcd: $(SIM_DIR)/nexa_top_exec_hello.out $(SIM_FIXTURE_DIR)/top_exec_loader_boot.mem $(MEM_DIR)/nexaos_system_disk.mem
	@echo "Kjører top-level HELLO.NXE exec-loader-simulering..."
	$(VVP) $(SIM_DIR)/nexa_top_exec_hello.out +dump

$(SIM_DIR)/nexa_top_exec_hello.out: $(SOURCES) $(SIM_DIR)/nexa_top_exec_hello_tb.sv $(SIM_FIXTURE_DIR)/top_exec_loader_boot.mem $(MEM_DIR)/nexaos_system_disk.mem
	@echo "Kompilerer top-level HELLO.NXE exec-loader-testbenk med iverilog..."
	@mkdir -p $(SIM_DIR)
	$(IVERILOG) $(IVFLAGS) -DSIMULATION -o $@ \
		$(SOURCES) $(SIM_DIR)/nexa_top_exec_hello_tb.sv


# ─── Simulering med Verilator ─────────────────────────────────
.PHONY: verilate
verilate: $(SOURCES)
	@echo "Linting med Verilator..."
	verilator --lint-only --sv $(SOURCES) \
		--top-module $(TOP) \
		-I src/ \
		-Wall

# ─── Assembler ────────────────────────────────────────────────
.PHONY: asm
asm:
ifndef FILE
	@echo "Bruk: make asm FILE=program.asm"
	@echo "Eksempel: make asm FILE=mem/hallo.asm"
else
	$(PYTHON) nexa_asm.py $(FILE) --list
endif

.PHONY: asm-test
asm-test:
	$(PYTHON) nexa_asm.py mem/hallo.asm -o mem/test.mem --list

# ─── Test-program oppretting ──────────────────────────────────
$(MEM_DIR)/test.mem: $(MEM_DIR)/hallo.asm nexa_asm.py
	$(PYTHON) nexa_asm.py $< -o $@

# ─── Vivado-syntese (batch-modus) ────────────────────────────
.PHONY: synth
synth: $(SIM_DIR)/hack_plus.tcl
	$(VIVADO) -mode batch -source $(SIM_DIR)/hack_plus.tcl

$(SIM_DIR)/hack_plus.tcl:
	@mkdir -p $(SIM_DIR)
	@cat > $@ << 'TCL'
	# Vivado batch TCL-script for Nexa-16 CPU
	create_project hack_plus ./vivado_proj -part $(PART) -force
	add_files { $(SOURCES) }
	add_files -fileset constrs_1 { constraints/basys3.xdc }
	add_files -fileset sim_1 { $(SIM_DIR)/nexa_tb.sv }
	set_property top $(TOP) [current_fileset]
	set_property top $(TESTBENCH) [get_filesets sim_1]
	set_property include_dirs {src} [current_fileset]
	launch_runs synth_1
	wait_on_run synth_1
	launch_runs impl_1 -to_step write_bitstream
	wait_on_run impl_1
	TCL

# ─── Vivado GUI ───────────────────────────────────────────────
.PHONY: gui
gui:
	$(VIVADO) &

# ─── Rydd ──────────────────────────────────────────────────────
.PHONY: clean
clean:
	rm -f $(SIM_DIR)/*.out $(SIM_DIR)/*.vcd $(SIM_DIR)/*.log
	rm -rf vivado_proj vivado_proj.cache vivado_proj.hw
	rm -f vivado*.log vivado*.jou *.log
	find . -name "*.pyc" -delete
	find . -name "__pycache__" -type d -prune -exec rm -rf {} +

# ─── Hjelp ─────────────────────────────────────────────────────
.PHONY: help
help:
	@echo "Nexa-16 FPGA byggeverktøy"
	@echo "─────────────────────────────────────────────────"
	@echo "  make sim          — Simuler med iverilog + GTKWave"
	@echo "  make sim-vga      — Kjør VGA-testbenken med iverilog"
	@echo "  make sim-top-vga  — Kjør top-level VGA-integrasjonstest"
	@echo "  make sim-top-vga-pixel — Kjør top-level pixel-VGA-integrasjonstest"
	@echo "  make sim-ps2      — Kjør PS/2-dekoder-testbenken"
	@echo "  make sim-top-ps2  — Kjør top-level PS/2-integrasjonstest"
	@echo "  make sim-sound    — Kjør lydgenerator-testbenken"
	@echo "  make sim-top-sound — Kjør top-level lydintegrasjonstest"
	@echo "  make sim-disk     — Kjør disk-DMA-testbenken"
	@echo "  make sim-top-disk — Kjør top-level diskintegrasjonstest"
	@echo "  make sim-top-disk-init — Kjør top-level test av forhåndslastet diskbilde"
	@echo "  make system-image — Bygg NexaOS-boot og systemdisk for FPGA"
	@echo "  make sim-top-boot-os — Kjør top-level NexaOS boot + RUN-test"
	@echo "  make verilate     — Lint koden med Verilator"
	@echo "  make asm FILE=f   — Assembler assembly-fil f"
	@echo "  make asm-test     — Assembler hallo.asm → test.mem"
	@echo "  make synth        — Synthesiser med Vivado"
	@echo "  make gui          — Åpne Vivado GUI"
	@echo "  make clean        — Slett genererte sim-/Vivado-filer"
	@echo ""
	@echo "Verktøykrav:"
	@echo "  iverilog ≥ 11.0 (simulering)"
	@echo "  GTKWave (waveform-visning)"
	@echo "  Verilator ≥ 4.0 (linting)"
	@echo "  Vivado 2022+ (syntese/implementasjon)"
	@echo "  Python ≥ 3.10 (assembler)"
