# Nexa — A Complete 16-Bit Computer Platform

Nexa is a complete 16-bit computer platform built around the **Nexa-16 ISA**, with its own assembler, virtual machine, high-level language, operating system, and FPGA implementation.

Originally inspired by Nand2Tetris, Nexa has evolved into a distinct hardware and software ecosystem designed to be understandable from the transistor level up, while still being capable of running real programs, games, demos, and a full operating system — both in emulation and on real FPGA hardware.

---

## Table of Contents

- [What is Nexa?](#what-is-nexa)
- [Quick Start — Web IDE](#quick-start--web-ide)
- [Project Structure](#project-structure)
- [The Nexa-16 ISA](#the-nexa-16-isa)
- [The Nexa Language](#the-nexa-language)
- [Assembly Programming](#assembly-programming)
- [NexaOS](#nexaos)
- [FPGA Implementation](#fpga-implementation)
- [Running Simulations](#running-simulations)
- [Demos and Examples](#demos-and-examples)
- [Memory Map](#memory-map)

---

## What is Nexa?

The Nexa platform consists of several layers, all designed together:

| Layer | Description |
|-------|-------------|
| **Nexa-16 ISA** | A clean 16-bit RISC instruction set. 16 opcodes, 4 general-purpose registers, hardware stack, kernel/user mode, and a complete interrupt and fault system. |
| **JavaScript Emulator** | A full-speed browser-based emulator running at ~25 MHz. Supports display (text and pixel), keyboard, sound (4 voices), timer, UART, and disk. |
| **Browser IDE** | An in-browser IDE (`index.html`) with editor, compiler, assembler, emulator, and display — no installation required. |
| **Nexa Language** | A statically typed, class-based high-level language that compiles to Nexa VM bytecode, then to Nexa-16 assembly. |
| **Assembler** | A two-pass assembler available in both JavaScript (in-browser) and Python (command line). |
| **NexaOS** | A real operating system written in the Nexa language, with a shell, program loader, and filesystem. |
| **FPGA Implementation** | A complete SystemVerilog implementation targeting the Basys 3 board (Xilinx Artix-7), including CPU, VGA output, PS/2 keyboard, 4-channel sound, UART, and disk. |

---

## Quick Start — Web IDE

The fastest way to run Nexa is in the browser. No server or build step needed.

**Open `index.html` in a modern browser** (Chrome, Firefox, Edge).

The IDE opens with a code editor on the left and a display on the right. You can:

- Write programs in the **Nexa language** or **Nexa assembly**
- Compile and run with one click
- Use the built-in demos to explore what Nexa can do

### Hello World in Nexa

```nexa
fn main() {
    Output.printString("Hello, Nexa!");
    Output.println();
    halt();
}
```

### Hello World in Assembly

```asm
.ORG 0x0000

main:
    LDI  A, msg        ; A = address of message
    CALL print_str
    HALT

msg:
    .STRING "Hello, Nexa!\n"
```

---

## Project Structure

```
Nexa/
├── index.html              Web IDE entry point — open this in a browser
├── css/
│   └── style.css           IDE stylesheet
├── js/
│   ├── app.js              Main application and emulator control loop
│   ├── ide.js              IDE interface logic
│   ├── ui.js               Display and keyboard handling
│   ├── utils.js            Shared utilities
│   ├── compiler/
│   │   ├── assembler.js        Two-pass assembler
│   │   ├── disassembler.js     Disassembler
│   │   ├── nexa-compiler.js    Nexa language compiler → VM bytecode
│   │   └── vm-translator.js    VM bytecode → Nexa-16 assembly
│   ├── emulator/
│   │   ├── cpu.js              Nexa-16 CPU emulator (with runFast hot loop)
│   │   ├── memory.js           Memory and MMIO dispatch
│   │   ├── devices.js          Peripheral devices (keyboard, timer, UART, disk)
│   │   ├── sound.js            4-channel audio synthesis (Web Audio)
│   │   └── emu-worker.js       Web Worker wrapper for emulator
│   └── data/
│       ├── stdlib.js           Linked standard library (VM bytecode)
│       ├── graphics-data.js    Built-in font and graphics data
│       └── demos.js            Demo program definitions
├── OS/
│   ├── boot.asm                NexaOS bootloader (assembly)
│   ├── nexaos.nx               NexaOS kernel and shell (Nexa language)
│   └── NexaOS.html             Standalone OS development environment
├── demos/                  Demo programs (Nexa language source, .txt)
│   ├── Breakout.txt
│   ├── SpaceInvaders.txt
│   ├── Tetris.txt
│   └── ...
├── tests/                  Test suite (Node.js)
├── tools/
│   ├── build_fpga_system_image.js  Builds FPGA disk/boot images
│   └── export-demo-wav.js          Exports audio to .wav files
├── FPGA/
│   ├── src/                SystemVerilog source files
│   │   ├── nexa_pkg.sv         Package: types, constants, opcodes, fault codes
│   │   ├── nexa_cpu.sv         CPU core (2-phase FSM, all 16 opcodes)
│   │   ├── nexa_alu.sv         Combinational ALU (standalone reference)
│   │   ├── nexa_ram.sv         Dual-port Block RAM (64K × 16-bit)
│   │   ├── nexa_io.sv          Memory-mapped I/O (keyboard, timer, UART, sound, disk, sysctrl)
│   │   ├── nexa_vga.sv         VGA renderer (640×480, text + pixel mode)
│   │   ├── nexa_sound.sv       4-channel sound generator (tone + noise, sigma-delta PWM)
│   │   ├── nexa_disk.sv        256-sector BRAM-backed disk with DMA
│   │   ├── nexa_uart.sv        8N1 UART (115200 baud)
│   │   └── nexa_top.sv         Top-level integration module
│   ├── sim/                Testbenches and simulation fixtures
│   ├── constraints/
│   │   ├── basys3.xdc          Active board: Basys 3 (XC7A35T)
│   │   └── nexys_a7.xdc        Legacy/reference: Nexys A7 (XC7A100T)
│   ├── mem/                Pre-assembled boot images and disk images
│   ├── nexa_asm.py         Python command-line assembler
│   ├── Makefile            Build and simulation automation
│   └── README.md           Detailed FPGA implementation notes
├── nexa-asm-reference.md   Complete Nexa-16 assembly language reference
├── nexa-language-reference.md  Complete Nexa language reference
└── timing-architecture.md  Host pacing and guest timer model
```

---

## The Nexa-16 ISA

The Nexa-16 is a **16-bit RISC processor** with a fixed 16-bit instruction word.

### Registers

| Register | Role |
|----------|------|
| **A** | Accumulator. Also the base register for all LOAD/STORE and the jump target for JMP and CALL. |
| **D** | Data register. General purpose. |
| **B** | Base register. General purpose. |
| **SP** | Stack pointer. Grows downward (PUSH decrements, POP increments). |
| **STATUS** | CPU status flags and mode bits (kernel/user). |
| **EPC** | Exception program counter — PC saved on interrupt/fault. |
| **CAUSE** | Fault cause code. |
| **BASE / LIMIT** | User-mode memory protection bounds. |
| **KSP** | Kernel stack pointer — saved/restored on mode switch. |

### Instruction Set (16 opcodes)

| Opcode | Mnemonic | Description |
|--------|----------|-------------|
| 0 | `LDI rd, imm9` | Load 9-bit sign-extended immediate into register |
| 1 | `LDU rd, imm6` | Load upper: sets bits [15:10], clears [9:0] |
| 2 | `ADD rd, rs` | `rd = rd + rs` (sets N, Z flags) |
| 3 | `SUB rd, rs` | `rd = rd - rs` (sets N, Z flags) |
| 4 | `AND rd, rs` | `rd = rd & rs` |
| 5 | `OR rd, rs` | `rd = rd \| rs` |
| 6 | `ALU2` | NOT, SHL, ASR, MOV, XOR (subop field) |
| 7 | `LOAD rd, off8` | `rd = mem[A + off8]` — A is always the base |
| 8 | `STORE rs, off8` | `mem[A + off8] = rs` |
| 9 | `BR cond, off9` | Conditional branch (N/Z flags, 9-bit PC-relative offset) |
| 10 | `JMP` | Unconditional jump to A |
| 11 | `CALL` | Push PC to stack, jump to A |
| 12 | `RET` | Pop return address from stack, jump |
| 13 | `PUSH/POP rs` | Stack operations |
| 14 | `TRAP n` | Software trap — enters kernel mode, jumps to 0x0008 |
| 15 | `SYS op` | System instructions (HALT, RTI, SETBASE, etc.) |

### CPU Flags

Two flags are set by ALU operations (`ADD`, `SUB`, `AND`, `OR`, `ALU2`):
- **N** — result is negative (bit 15 set)
- **Z** — result is zero

### Exception Vectors

| Address | Event |
|---------|-------|
| `0x0000` | Reset |
| `0x0004` | Hardware interrupt (IRQ) |
| `0x0008` | Software trap (TRAP instruction) |
| `0x000C` | CPU fault |

### Fault Codes

| Code | Name | Cause |
|------|------|-------|
| 16 | FETCH | Instruction fetch outside user BASE/LIMIT |
| 17 | LOAD | Memory read outside user BASE/LIMIT |
| 18 | STORE | Memory write outside user BASE/LIMIT |
| 19 | STACK | Stack overflow outside user BASE/LIMIT |
| 20 | PRIVILEGE | SYS instruction from user mode |
| 21 | IO | MMIO access from user mode |

---

## The Nexa Language

Nexa is a **statically typed, class-based language** that compiles to Nexa VM bytecode and then to Nexa-16 assembly. It is inspired by languages like Jack, C, and Rust.

The full language reference is in [nexa-language-reference.md](nexa-language-reference.md).

### Key Features

- **16-bit integers** — all values are 16-bit words. No floats.
- **Classes** with instance fields, static fields, constructors, methods, and static functions
- **Structs** — lightweight value types with auto-generated constructor/destructor
- **Enums** — compile-time integer constants with auto-incrementing values
- **Arrays** — heap-allocated, manually managed
- **Control flow** — `if/else`, `while`, `for`, `loop`, `break`, `continue`
- **Short-circuit** `&&` and `||`
- **Bitwise operators** — `&`, `|`, `^`, `~`, `<<`, `>>`
- **Built-in hardware access** — `peek(addr)`, `poke(addr, value)`, `halt()`
- **Timing APIs** — `Time.millis()`, `FrameClock.init(fps)`, `FrameClock.waitNextFrame()`

### Compilation Pipeline

```
Nexa source (.nx)
    ↓  nexa-compiler.js
VM bytecode (stack-based IR)
    ↓  vm-translator.js
Nexa-16 assembly (.asm)
    ↓  assembler.js
16-bit machine code (.mem / in-memory)
    ↓
CPU emulator / FPGA
```

### Example Programs

**Fibonacci sequence:**
```nexa
fn main() {
    var a: int = 0;
    var b: int = 1;
    var i: int = 0;
    while (i < 15) {
        Output.printInt(a);
        Output.printChar(32);
        var temp: int = a + b;
        a = b;
        b = temp;
        i = i + 1;
    }
    halt();
}
```

**Pixel art with color palette:**
```nexa
fn main() {
    poke(0xFF30, 1);          // switch to pixel mode (160×120)
    Screen.clearScreen();

    var color: int = 1;
    var y: int = 0;
    while (y < 120) {
        Screen.setColor(color);
        Screen.drawRectangle(0, y, 159, y + 3);
        color = color + 1;
        if (color > 15) { color = 1; }
        y = y + 4;
    }
    halt();
}
```

**Game loop with frame clock:**
```nexa
fn main() {
    FrameClock.init(60);      // target 60 fps
    poke(0xFF30, 1);

    var x: int = 80;
    loop {
        FrameClock.waitNextFrame();
        Screen.clearScreen();
        Screen.setColor(15);
        Screen.drawCircle(x, 60, 8);
        x = x + 1;
        if (x > 160) { x = 0; }
    }
}
```

### Standard Library

| Class | Description |
|-------|-------------|
| `Output` | Text output: `printString`, `printInt`, `printChar`, `println`, `moveCursor` |
| `Screen` | Pixel graphics: `drawPixel`, `drawLine`, `drawRectangle`, `drawCircle`, `setColor` |
| `Keyboard` | Input: `keyPressed()`, `readChar()` |
| `Input` | Convenience aliases: `readKey()`, `isKeyDown(code)` |
| `Sound` | Audio: `setVoice(ch, period, volume, waveform)`, `stopVoice(ch)`, `silence()` |
| `Math` | `multiply`, `divide`, `modulo`, `sqrt`, `min`, `max`, `abs`, `xor`, `shiftLeft`, `shiftRight` |
| `String` | Heap strings: `new`, `dispose`, `length`, `charAt`, `appendChar`, `setCharAt` |
| `Array` | Heap arrays: `new(size)`, `dispose()` |
| `Memory` | Raw heap: `alloc(size)`, `deAlloc(addr)`, `peek`, `poke` |
| `Time` | Timing: `millis()`, `sleep(ms)`, `elapsedSince(start)` |
| `FrameClock` | Frame pacing: `init(fps)`, `waitNextFrame()`, `deltaMillis()` |
| `Sys` | `halt()`, `wait(ms)`, `error(code)` |

---

## Assembly Programming

The Nexa assembler supports a clean, label-based assembly syntax with several pseudo-instructions and directives.

The full assembly reference is in [nexa-asm-reference.md](nexa-asm-reference.md).

### Directives

| Directive | Example | Description |
|-----------|---------|-------------|
| `.ORG` | `.ORG 0x100` | Set assembly origin address |
| `.WORD` | `.WORD 42, 0xFF` | Emit raw data words |
| `.STRING` | `.STRING "Hello\n"` | Emit null-terminated ASCII string |
| `.EQU` | `.EQU MAX 100` | Define a constant symbol |

### Pseudo-Instructions

| Pseudo | Expands to | Description |
|--------|-----------|-------------|
| `NOP` | `ADD A, A` (no-op variant) | No operation |
| `HALT` | `SYS HALT` | Stop the CPU |
| `MOV rd, rs` | `ALU2 MOV rd, rs` | Register-to-register copy |
| `NOT rd` | `ALU2 NOT rd` | Bitwise NOT |
| `BRA offset` | `BR NZP, offset` | Unconditional branch (all conditions) |
| `BRN/BRZ/BRP/...` | `BR <cond>, offset` | Conditional branch shorthands |
| `LDA rd, label` | `LDI + LDU` pair | Load a full 16-bit address |

### Loading a 16-bit Address

Since `LDI` only provides a 9-bit immediate, a full address requires two instructions:

```asm
; Load address 0xEC00 (framebuffer start) into A:
LDI  A, 0       ; A[9:0] = 0
LDU  A, 59      ; A[15:10] = 59 = 0b111011 → A = 0xEC00

; Or use the LDA pseudo-instruction:
LDA  A, my_label
```

### Python Assembler (command line)

```bash
cd FPGA/
python3 nexa_asm.py mem/hallo.asm -o mem/test.mem --list
python3 nexa_asm.py --help
```

---

## NexaOS

NexaOS is a real operating system written in the Nexa language. It runs on both the emulator and real FPGA hardware.

**Features:**
- Interactive shell with command history
- Program loader — loads and executes `.NXE` binaries from disk
- Simple FAT-style filesystem (256 sectors × 128 words per sector)
- Built-in commands: `RUN <file>`, `DIR`, `HELP`, and more
- Kernel/user mode separation with memory protection

**On the FPGA**, the default configuration boots directly into NexaOS with a pre-formatted system disk containing `HELLO.NXE` and `BREAKOUT.NXE` ready to run:

```
> RUN HELLO.NXE
Hello, Nexa!

> RUN BREAKOUT.NXE
[game launches]
```

---

## FPGA Implementation

The FPGA implementation is a complete SystemVerilog design targeting the **Basys 3** board (Xilinx Artix-7 XC7A35T, 100 MHz).

### Hardware Modules

| Module | Description |
|--------|-------------|
| `nexa_top.sv` | Top-level integration: CPU, RAM, I/O, VGA, PS/2, 7-seg, exec-loader |
| `nexa_cpu.sv` | CPU core — 2-phase FSM (FETCH → EXECUTE), all 16 opcodes |
| `nexa_ram.sv` | Dual-port Block BRAM, 64K × 16-bit, `$readmemh` initialization |
| `nexa_io.sv` | All MMIO devices: keyboard, timer, UART, display, sound, disk, interrupt controller |
| `nexa_vga.sv` | VGA renderer — 640×480 @ ~60 Hz, text mode (80×30) and pixel mode (160×120 CGA) |
| `nexa_sound.sv` | 4-channel sound: 3 tone voices (square/triangle/saw) + 1 noise voice, sigma-delta PWM |
| `nexa_disk.sv` | 256 sectors × 128 words, BRAM-backed, DMA read/write |
| `nexa_uart.sv` | 8N1 UART at 115200 baud |
| `nexa_pkg.sv` | Package: all constants, enums, types, and fault codes |
| `nexa_alu.sv` | Standalone combinational ALU (reference / simulation use) |

### CPU Architecture

The CPU is a **2-phase FSM**:

```
FETCH → EXECUTE → FETCH → ...

For LOAD/POP/RET (1-cycle BRAM latency):
FETCH → EXECUTE → MEMWAIT → FETCH → ...

For MMIO reads:
FETCH → EXECUTE → MEMIO → FETCH → ...
```

**2 clock cycles per instruction** (most instructions)
**3 clock cycles** for LOAD, POP, RET, and MMIO reads

### Resource Usage (Basys 3, XC7A35T)

| Resource | Estimated | Available |
|----------|-----------|-----------|
| LUT | ~2,000–3,000 | 33,280 |
| Flip-flops | ~500–700 | 41,600 |
| BRAM (36K) | 4 | 50 |
| DSP | 0 | 90 |

### Synthesizing with Vivado

#### GUI method

1. Open Vivado → **Create Project** → RTL Project
2. **Add Sources** → select all `.sv` files from `FPGA/src/`
3. **Add Constraints** → select `FPGA/constraints/basys3.xdc`
4. Set **Top Module** to `nexa_top`
5. In the TCL console: `set_property generic {PROGRAM_FILE=mem/nexaos_boot.mem DISK_FILE=mem/nexaos_system_disk.mem} [current_fileset]`
6. **Run Synthesis** → **Run Implementation** → **Generate Bitstream** → **Program Device**

#### Command line

```bash
cd FPGA/
make synth
```

### Running on Basys 3

1. Connect the Basys 3 via USB (Micro-B)
2. Open a serial terminal at **115200 baud, 8N1**:
   ```bash
   # Linux
   screen /dev/ttyUSB1 115200

   # Windows — use PuTTY: Serial, 115200, 8N1
   ```
3. Press **BTNC** (center button) to reset
4. NexaOS boot message appears in the terminal; type `RUN HELLO.NXE` to run a program

### I/O on the Board

| Signal | Basys 3 Pin | Description |
|--------|-------------|-------------|
| Clock | W5 | 100 MHz oscillator |
| Reset | U18 (BTNC) | Active-high reset |
| UART TX | A18 | Serial output to USB-UART |
| UART RX | B18 | Serial input from USB-UART |
| VGA | (JB/JC headers) | 640×480 VGA via resistor DAC |
| PS/2 clock | C17 | Keyboard clock |
| PS/2 data | B17 | Keyboard data |
| LEDs [3:0] | U16..V19 | Debug LEDs (PC low bits) |
| 7-segment | (AN/SEG) | Shows current PC |

---

## Running Simulations

Requires: **Icarus Verilog** (`iverilog`) and optionally **GTKWave**.

```bash
cd FPGA/

# Run the full CPU verification testbench
make sim

# Run individual testbench targets
make sim-top-exec-loader     # Test NexaOS exec-loader / RUN flow
make sim-top-disk            # Test disk DMA read/write
make sim-top-vga             # Test VGA output
make sim-top-ps2             # Test PS/2 keyboard input
make sim-top-sound           # Test 4-channel sound

# Assemble a program manually
python3 nexa_asm.py mem/hallo.asm -o mem/test.mem --list

# Clean simulation artifacts
make clean
```

Expected output from the CPU verification testbench:
```
╔══════════════════════════════════════════════════════╗
║  NEXA-16 CPU Verification  —  Reference: cpu.js       ║
╚══════════════════════════════════════════════════════╝

── TEST 1: ADD/SUB/AND/OR ──
  OK   OR 0x55|0xAA: A=0x00FF ...
  ...
╔══════════════════════════════════════════════════════╗
║  Result: 43 passed,  0 failed                         ║
╚══════════════════════════════════════════════════════╝
✓ ALL GREEN — FPGA CPU matches the Nexa-16 emulator!
```

---

## Demos and Examples

The `demos/` directory contains programs written in the Nexa language:

| Demo | Description |
|------|-------------|
| `Breakout.txt` | Breakout / Arkanoid clone |
| `SpaceInvaders.txt` | Space Invaders clone |
| `Tetris.txt` | Tetris |
| `Demo1–4.txt` | Graphical demoscene effects |
| `DemoAssemblyCube.txt` | 3D rotating cube in assembly |
| `DemoAssemblySpaceInvaders.txt` | Space Invaders in assembly |
| `music.txt` | 4-channel music playback |
| `SimpleMelody.txt` | Basic sound demo |
| `SoundtrackStress.txt` | Sound stress test |
| `HelloDisk.txt` | Disk read/write demo |

Load any demo in the Web IDE by opening `index.html` and selecting it from the demo dropdown.

---

## Memory Map

| Address Range | Description |
|---------------|-------------|
| `0x0000–0x000F` | Reserved (reset/interrupt vectors, temporaries) |
| `0x0010–0x00FF` | Static variables |
| `0x0100–0xEBFF` | General RAM — heap, stack, code (SP initialized to `0xEBF0`) |
| `0xEC00–0xFEBF` | Active framebuffer (4800 words) |
| `0xFF00–0xFF01` | **Keyboard** — status / ASCII data |
| `0xFF10–0xFF14` | **Timer** — control, interval, counter, monotonic ms low/high |
| `0xFF20–0xFF23` | **UART** — TX status, TX data, RX status, RX data |
| `0xFF30–0xFF31` | **Display** — mode (0=text, 1=pixel), cursor position |
| `0xFF40–0xFF47` | **Sound** — 3 tone voices + 1 noise voice (period/control pairs) |
| `0xFF50–0xFF53` | **Disk** — command, sector, memory address, status |
| `0xFFF0–0xFFF1` | **System/IRQ controller** — pending flags, IRQ mask |

### Framebuffer Formats

**Text mode (mode 0):** 80×30 characters. Each word = `[15:12] BG color | [11:8] FG color | [7:0] ASCII`.

**Pixel mode (mode 1):** 160×120 pixels, 4 bits per pixel (CGA 16-color palette). Each word packs 4 pixels, MSB = leftmost.

### Interrupt Sources

| Bit | Source |
|-----|--------|
| 0 | Timer |
| 1 | Keyboard |
| 2 | UART RX |
| 3 | UART TX |
| 4 | Disk |

---

## Further Reading

- [nexa-asm-reference.md](nexa-asm-reference.md) — Complete Nexa-16 assembly reference (ISA encoding, all instructions, calling conventions, patterns, examples)
- [nexa-language-reference.md](nexa-language-reference.md) — Complete Nexa language reference (syntax, standard library, memory model)
- [timing-architecture.md](timing-architecture.md) — Host pacing and guest timer model
- [FPGA/README.md](FPGA/README.md) — FPGA implementation details, simulation guide, porting notes

---

*Nexa is an independent project built from scratch. The Nexa-16 ISA, language, compiler, OS, and FPGA implementation are original work.*
