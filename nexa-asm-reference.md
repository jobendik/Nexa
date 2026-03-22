# Nexa ASM Reference

> **Version:** NexaOS v4  
> **Purpose:** Complete reference for humans and LLMs writing Nexa ASM programs for the Nexa-16 ISA.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Registers](#2-registers)
3. [Number Formats](#3-number-formats)
4. [Instruction Set Architecture](#4-instruction-set-architecture)
   - [Instruction Encoding Summary](#instruction-encoding-summary)
   - [LDI — Load Immediate](#ldi--load-immediate)
   - [LDU — Load Upper](#ldu--load-upper)
   - [ADD, SUB, AND, OR — ALU Operations](#add-sub-and-or--alu-operations)
   - [ALU2: NOT, SHL, ASR, MOV, XOR](#alu2-not-shl-asr-mov-xor)
   - [LOAD — Memory Read](#load--memory-read)
   - [STORE — Memory Write](#store--memory-write)
   - [BR — Conditional Branch](#br--conditional-branch)
   - [JMP — Unconditional Jump](#jmp--unconditional-jump)
   - [CALL — Subroutine Call](#call--subroutine-call)
   - [RET — Return from Subroutine](#ret--return-from-subroutine)
   - [PUSH / POP — Stack Operations](#push--pop--stack-operations)
   - [TRAP — Software Trap](#trap--software-trap)
   - [SYS — System Instructions](#sys--system-instructions)
5. [Pseudo-Instructions](#5-pseudo-instructions)
6. [Assembler Directives](#6-assembler-directives)
7. [Labels and Symbols](#7-labels-and-symbols)
8. [Memory Map](#8-memory-map)
9. [Framebuffer](#9-framebuffer)
   - [Text Mode](#text-mode)
   - [Pixel Mode](#pixel-mode)
   - [CGA Color Palette](#cga-color-palette)
10. [I/O Device Registers](#10-io-device-registers)
    - [Keyboard](#keyboard-0xff00)
    - [Timer](#timer-0xff10)
    - [UART (Serial)](#uart-serial-0xff20)
    - [Display Controller](#display-controller-0xff30)
    - [Sound](#sound-0xff40)
    - [Disk Controller](#disk-controller-0xff50)
    - [System Control / Interrupt Controller](#system-control--interrupt-controller-0xfff0)
11. [Interrupt System](#11-interrupt-system)
12. [Fault System](#12-fault-system)
13. [Kernel/User Mode](#13-kerneluser-mode)
14. [Calling Conventions](#14-calling-conventions)
15. [Common Patterns and Idioms](#15-common-patterns-and-idioms)
16. [Critical Gotchas](#16-critical-gotchas)
17. [Complete Example Programs](#17-complete-example-programs)

---

## 1. Architecture Overview

The Nexa-16 is a **16-bit RISC processor** with:

- **16-bit word size** — all registers, memory words, and instructions are 16 bits
- **4 general-purpose registers** — A, D, B, SP
- **6 control registers** — STATUS, EPC, CAUSE, BASE, LIMIT, KSP
- **64K × 16-bit address space** (65,536 words)
- **16 opcodes** encoded in the top 4 bits of each instruction word
- **Two CPU flags** — N (negative) and Z (zero), set by ALU operations only
- **Hardware stack** using SP register (grows downward)
- **Kernel/user mode** with memory protection (BASE/LIMIT)
- **Interrupt and fault system** with fixed vector addresses
- **Memory-mapped I/O** at addresses 0xFF00–0xFFFF

---

## 2. Registers

### General-Purpose Registers

| Register | Index | Notes |
|----------|-------|-------|
| **A** | 0 | Accumulator. **Also used as the base register for all LOAD/STORE operations** and as the **jump target for JMP and CALL**. |
| **D** | 1 | Data register. General purpose. |
| **B** | 2 | Base register. General purpose. |
| **SP** | 3 | Stack pointer. Used by PUSH, POP, CALL, RET. Grows **downward** (PUSH decrements, POP increments). |

### CPU Flags

| Flag | Bit in STATUS | Description |
|------|---------------|-------------|
| **Z** (Zero) | Bit 0 | Set when an ALU result is zero |
| **N** (Negative) | Bit 1 | Set when an ALU result has bit 15 set (negative in two's complement) |

**Positive (P)** is derived: P = !N && !Z (result is nonzero and bit 15 is clear).

### Control Registers

| Register | Index | Bits | Description |
|----------|-------|------|-------------|
| **STATUS** | 0 | `[15:4] reserved, [3] MODE, [2] IE, [1] N, [0] Z` | Mode (0=kernel, 1=user), Interrupt Enable, flags |
| **EPC** | 1 | 16-bit | Exception/interrupt return address |
| **CAUSE** | 2 | For interrupts/faults: `[15:8] saved STATUS low byte, [7:0] cause code`; for `TRAP`, the 12-bit trap number is stored directly | Cause register |
| **BASE** | 3 | 16-bit | User mode memory base address (added to virtual addresses) |
| **LIMIT** | 4 | 16-bit | User mode memory size limit |
| **KSP** | 5 | 16-bit | Kernel stack pointer (swapped with SP on mode transitions) |

---

## 3. Number Formats

The assembler accepts these number formats in immediate values and directives:

| Format | Example | Description |
|--------|---------|-------------|
| Decimal | `42`, `-7` | Signed decimal integer |
| Hexadecimal | `0xFF`, `0x1A3F` | Prefixed with `0x` |
| Binary | `0b10110` | Prefixed with `0b` |

Labels and `.EQU` symbols can be used wherever an immediate value is expected.

---

## 4. Instruction Set Architecture

### Instruction Encoding Summary

All instructions are a single 16-bit word. The top 4 bits (bits [15:12]) encode the opcode:

| Opcode | Value | Mnemonic | Format |
|--------|-------|----------|--------|
| 0 | 0x0 | **LDI** | `[15:12]=0000 [11:10]=dst [9:0]=imm10` |
| 1 | 0x1 | **LDU** | `[15:12]=0001 [11:10]=dst [9:6]=reserved [5:0]=imm6` |
| 2 | 0x2 | **ADD** | `[15:12]=0010 [11:10]=dst [9:8]=src` |
| 3 | 0x3 | **SUB** | `[15:12]=0011 [11:10]=dst [9:8]=src` |
| 4 | 0x4 | **AND** | `[15:12]=0100 [11:10]=dst [9:8]=src` |
| 5 | 0x5 | **OR** | `[15:12]=0101 [11:10]=dst [9:8]=src` |
| 6 | 0x6 | **ALU2** | `[15:12]=0110 [11:10]=dst [9:7]=subop [6:5]=src` |
| 7 | 0x7 | **LOAD** | `[15:12]=0111 [11:10]=dst [7:0]=offset8` |
| 8 | 0x8 | **STORE** | `[15:12]=1000 [11:10]=src [7:0]=offset8` |
| 9 | 0x9 | **BR** | `[15:12]=1001 [11:9]=NZP [8:0]=offset9` |
| 10 | 0xA | **JMP** | `[15:12]=1010` |
| 11 | 0xB | **CALL** | `[15:12]=1011` |
| 12 | 0xC | **STACK** | `[15:12]=1100 [11]=dir [10:9]=reg` |
| 13 | 0xD | **TRAP** | `[15:12]=1101 [11:0]=trapnum12` |
| 14 | 0xE | **SYS** | `[15:12]=1110 [11:8]=subop [7:6]=reg [5:3]=ctrlreg` |
| 15 | 0xF | **RET** | `[15:12]=1111` |

---

### LDI — Load Immediate

```
LDI reg, imm10
```

Loads a **10-bit sign-extended** immediate value into the register. Range: **-512 to 511**.

**Encoding:** `0000 dd iiiiiiiiii`  
- `dd` = destination register (2 bits)  
- `iiiiiiiiii` = 10-bit signed immediate

**Flags:** Does **NOT** set flags.

**Example:**
```asm
LDI A, 42       ; A = 42
LDI D, -1       ; D = 0xFFFF (sign-extended)
LDI SP, 0x200   ; SP = 512
```

---

### LDU — Load Upper

```
LDU reg, imm6
```

Replaces the **upper 6 bits** (bits [15:10]) of the register while preserving the **lower 10 bits**.

**Encoding:** `0001 dd xxxx iiiiii`  
- `dd` = destination register  
- `iiiiii` = 6-bit unsigned value placed in bits [15:10]

**Flags:** Does **NOT** set flags.

**Usage:** Paired with LDI to load a full 16-bit value. First LDI loads the low 10 bits (sign-extended), then LDU sets the upper 6 bits.

**Example:**
```asm
; Load 0xEC00 into A (= 60416 decimal)
; Low 10 bits of 0xEC00: 0xEC00 & 0x3FF = 0x000 = 0
; Upper 6 bits: 0xEC00 >> 10 = 59 = 0x3B
LDI A, 0        ; A = 0x0000
LDU A, 59       ; A = 0xEC00
```

**Note:** The LDA pseudo-instruction automates this — use it instead.

---

### ADD, SUB, AND, OR — ALU Operations

```
ADD dst, src     ; dst = dst + src
SUB dst, src     ; dst = dst - src
AND dst, src     ; dst = dst & src
OR  dst, src     ; dst = dst | src
```

Two-register ALU operations. The result is stored in `dst`.

**Encoding:** `oooo dd ss xxxxxxxx`  
- `oooo` = opcode (ADD=0010, SUB=0011, AND=0100, OR=0101)  
- `dd` = destination register  
- `ss` = source register

**Flags:** **Sets** both N and Z flags based on the result.

**Example:**
```asm
ADD D, A       ; D = D + A, flags updated
SUB A, B       ; A = A - B, flags updated
AND D, B       ; D = D & B
OR  A, D       ; A = A | D
```

---

### ALU2: NOT, SHL, ASR, MOV, XOR

These instructions share opcode 6 (ALU2) with different sub-operations:

| Sub-op | Value | Mnemonic | Syntax | Operation |
|--------|-------|----------|--------|-----------|
| 0 | 000 | **NOT** | `NOT dst` | dst = ~dst (bitwise complement) |
| 1 | 001 | **SHL** | `SHL dst` | dst = dst << 1 (shift left, LSB=0) |
| 2 | 010 | **ASR** | `ASR dst` | dst = dst >> 1 (arithmetic shift right, sign-preserving) |
| 3 | 011 | **MOV** | `MOV dst, src` | dst = src (register copy) |
| 4 | 100 | **XOR** | `XOR dst, src` | dst = dst ^ src |

**Encoding:** `0110 dd sss ss xxxxx`  
- `dd` = destination register  
- `sss` = sub-operation (3 bits)  
- `ss` = source register (used by MOV and XOR; ignored by NOT, SHL, ASR)

**Flags:** All ALU2 operations **set** both N and Z flags.

**Example:**
```asm
NOT D          ; D = ~D
SHL A          ; A = A << 1  (multiply by 2)
ASR D          ; D = D >> 1  (divide by 2, preserving sign)
MOV B, D       ; B = D
XOR A, D       ; A = A ^ D
```

---

### LOAD — Memory Read

```
LOAD dst, [A]
LOAD dst, [A+offset]
LOAD dst, [A-offset]
```

Reads a 16-bit word from memory at address `A + offset` into the destination register.

**Encoding:** `0111 dd xx oooooooo`  
- `dd` = destination register  
- `oooooooo` = 8-bit signed offset (range: **-128 to +127**)

**Flags:** Does **NOT** set flags. ⚠️

**Important:** The base address is **always** register A. You cannot use any other register as the base.

**Example:**
```asm
LDA A, myData      ; A points to data
LOAD D, [A]        ; D = memory[A]
LOAD B, [A+1]      ; B = memory[A+1]
LOAD D, [A-3]      ; D = memory[A-3]
```

---

### STORE — Memory Write

```
STORE src, [A]
STORE src, [A+offset]
STORE src, [A-offset]
```

Writes the value of `src` register to memory at address `A + offset`.

**Encoding:** `1000 ss xx oooooooo`  
- `ss` = source register  
- `oooooooo` = 8-bit signed offset (range: **-128 to +127**)

**Flags:** Does **NOT** set flags.

**Important:** The base address is **always** register A.

**Example:**
```asm
LDA A, 0xEC00      ; A = framebuffer base
LDI D, 0x0F41      ; D = white 'A' on black (bg=0, fg=0xF, char=0x41='A')
STORE D, [A]        ; Write to first framebuffer position
STORE D, [A+1]      ; Write to second position
```

---

### BR — Conditional Branch

```
BRN  label    ; Branch if Negative (N=1)
BRZ  label    ; Branch if Zero (Z=1)
BRP  label    ; Branch if Positive (N=0 and Z=0)
BRNZ label    ; Branch if Negative or Zero
BRNP label    ; Branch if Negative or Positive (not zero)
BRZP label    ; Branch if Zero or Positive (not negative)
BRA  label    ; Branch Always (unconditional)
BRNZP label   ; Branch Always (synonym for BRA)
```

Branches to `label` if the condition (based on N, Z, P flags) is met.

**Encoding:** `1001 nzp ooooooooo`  
- `nzp` = 3 condition bits: N(bit 11), Z(bit 10), P(bit 9)  
- `ooooooooo` = 9-bit signed offset relative to **PC+1** (range: **-256 to +255** words)

**Condition truth table:**

| Mnemonic | NZP bits | Decimal | Branches when... |
|----------|----------|---------|------------------|
| BRP | 001 | 1 | Result > 0 (positive) |
| BRZ | 010 | 2 | Result == 0 |
| BRZP | 011 | 3 | Result >= 0 |
| BRN | 100 | 4 | Result < 0 (negative) |
| BRNP | 101 | 5 | Result != 0 |
| BRNZ | 110 | 6 | Result <= 0 |
| BRA | 111 | 7 | Always |

**Offset calculation:** `target_address = address_of_branch_instruction + 1 + offset`

When using labels, the assembler calculates the offset automatically. The range is ±256 words from the instruction following the branch.

**Example:**
```asm
        SUB D, B          ; Compare D and B
        BRZ  equal        ; Branch if D == B
        BRN  dLessThanB   ; Branch if D < B
        ; ... (D > B falls through)
equal:
        ; ...
dLessThanB:
        ; ...
```

---

### JMP — Unconditional Jump

```
JMP              ; PC = A
```

Sets PC to the value in register **A**. The instruction word has no operand fields — it always jumps to the address in A.

**Encoding:** `1010 000000000000`

**Note:** Although you may write `JMP label` in source code, the assembler **ignores** the label operand. You must load A with the target address before executing JMP.

**Example:**
```asm
LDA A, myLoop    ; Load address of myLoop into A
JMP              ; Jump to A
```

---

### CALL — Subroutine Call

```
CALL             ; Push PC to stack, then PC = A
```

Pushes the current PC (return address) onto the stack (SP decremented first), then jumps to the address in register **A**.

**Encoding:** `1011 000000000000`

⚠️ **CRITICAL:** The CALL instruction **always jumps to the address in register A**. Any label written after CALL in source code is **ignored by the assembler**. You **must** load A with the subroutine address before calling.

**Example:**
```asm
; Correct way to call a subroutine:
LDA A, mySub     ; A = address of mySub
CALL             ; Push return addr, jump to A

; WRONG — this does NOT jump to mySub!
; CALL mySub     ; ← The label is IGNORED. Jumps to whatever A contains.
```

---

### RET — Return from Subroutine

```
RET
```

Pops the return address from the stack into PC (SP incremented after read).

**Encoding:** `1111 000000000000`

**Sequence:**
1. Read `memory[SP]` → PC
2. SP = SP + 1

---

### PUSH / POP — Stack Operations

```
PUSH reg         ; SP = SP - 1, then memory[SP] = reg
POP  reg         ; reg = memory[SP], then SP = SP + 1
```

**Encoding:** `1100 d rr xxxxxxxxx`  
- `d` = direction (0 = PUSH, 1 = POP)  
- `rr` = register (2 bits)

**Flags:** Does **NOT** set flags.

**Special case:** `POP SP` loads SP directly from memory[SP] without incrementing SP afterward.

**Example:**
```asm
PUSH A           ; Save A on stack
PUSH D           ; Save D on stack
; ... do work ...
POP  D           ; Restore D
POP  A           ; Restore A
```

---

### TRAP — Software Trap

```
TRAP imm12
```

Triggers a software trap (system call). Saves PC to EPC, saves/clears mode bits, and jumps to the **trap vector at address 8**.

**Encoding:** `1101 tttttttttttt`  
- `tttttttttttt` = 12-bit unsigned trap number (0–4095), stored in CAUSE

**Sequence:**
1. EPC = PC (address after the TRAP)
2. CAUSE = trap number (stored directly, unlike interrupt/fault CAUSE encoding)
3. If in user mode: swap SP ↔ KSP
4. MODE = kernel, IE = 0
5. PC = 8 (trap vector)

---

### SYS — System Instructions

System-level instructions. **Kernel mode only** (causes privilege fault in user mode).

#### HALT

```
HALT
```

Stops the CPU. The `halted` flag is set and no more instructions execute.

**Encoding:** `1110 0011 00000000`

#### IRET — Interrupt/Exception Return

```
IRET
```

Returns from an interrupt or exception handler.

**Sequence:**
1. If STATUS.MODE is set (returning to user mode): swap SP ↔ KSP
2. PC = EPC
3. Clears internal fault handler flag

**Note:** You must manually restore the STATUS register (flags, IE) via `WRCTL STATUS` before executing IRET.

**Encoding:** `1110 0000 00000000`

#### RDCTL — Read Control Register

```
RDCTL dst, ctrlreg
```

Reads a control register into a general-purpose register.

**Encoding:** `1110 0001 dd ccc xxx`  
- `dd` = destination GP register  
- `ccc` = control register index

**Example:**
```asm
RDCTL D, STATUS    ; D = STATUS register
RDCTL A, CAUSE     ; A = CAUSE register
```

#### WRCTL — Write Control Register

```
WRCTL ctrlreg, src
```

Writes a general-purpose register value into a control register.

**Encoding:** `1110 0010 ss ccc xxx`  
- `ss` = source GP register  
- `ccc` = control register index

**Example:**
```asm
LDI D, 4           ; IE bit = bit 2
WRCTL STATUS, D     ; Enable interrupts
```

---

## 5. Pseudo-Instructions

Pseudo-instructions are assembled into one or more real instructions. The assembler handles them automatically.

### LDA — Load 16-bit Address/Value

```
LDA reg, value
```

Loads a full 16-bit value (address or constant) into a register. Expands to 2 words.

**Expansion:**
```asm
LDI reg, (value & 0x3FF)      ; Low 10 bits (sign-extended)
LDU reg, ((value >> 10) & 0x3F) ; Upper 6 bits
```

**Size:** 2 words.

**Example:**
```asm
LDA A, 0xEC00       ; A = 0xEC00 (framebuffer base)
LDA D, myLabel      ; D = address of myLabel
LDA SP, 0xEBF0      ; SP = VM/runtime stack anchor near top of RAM
```

---

### CMP — Compare Two Registers

```
CMP r1, r2
```

Sets flags as if computing `r1 - r2` without modifying either register.

**Expansion (normal case, r2 ≠ A):** 4 words
```asm
PUSH A
MOV  A, r1          ; A = r1
SUB  A, r2          ; A = r1 - r2 (flags set)
POP  A              ; Restore A
```

**Expansion (when r2 = A):** 3 words  
Uses an alternate algorithm to avoid destroying A's value:
```asm
PUSH r1
SUB  r1, A          ; r1 = r1 - A (flags set)
POP  r1             ; Restore r1
```

**Size:** 4 words (or 3 when r2 is A).

**Example:**
```asm
CMP D, B            ; Flags set for D - B
BRZ  equal          ; Branch if D == B
BRN  less           ; Branch if D < B (signed)
```

---

### CLR — Clear Register

```
CLR reg
```

Sets a register to zero.

**Expansion:**
```asm
LDI reg, 0
```

**Size:** 1 word.

---

### INC — Increment Register

```
INC reg
```

Adds 1 to a register.

**Expansion:** 4 words. Uses a temporary register (B normally, A if the target is B):
```asm
PUSH tmp             ; Save temporary register
LDI  tmp, 1
ADD  reg, tmp        ; reg = reg + 1 (flags set)
POP  tmp             ; Restore temporary register
```

**Size:** 4 words.

**Note:** Flags ARE set (by the ADD).

---

### DEC — Decrement Register

```
DEC reg
```

Subtracts 1 from a register.

**Expansion:** Identical to INC but uses SUB:
```asm
PUSH tmp
LDI  tmp, 1
SUB  reg, tmp        ; reg = reg - 1 (flags set)
POP  tmp
```

**Size:** 4 words.

---

### NEG — Negate Register

```
NEG reg
```

Computes `reg = -reg` (two's complement negation).

**Expansion:** 5 words:
```asm
NOT reg              ; reg = ~reg
PUSH B
LDI  B, 1
ADD  reg, B          ; reg = ~reg + 1 = -reg
POP  B
```

**Size:** 5 words.

---

### TST — Test Register (Set Flags)

```
TST reg
```

Sets flags based on the register's value without modifying it.

**Expansion:** 3 words:
```asm
PUSH A
MOV  A, reg          ; Flags set by MOV
POP  A
```

**Size:** 3 words.

**Tip:** For a lighter-weight test (1 word), use `OR reg, reg` — this also sets flags without changing the value.

---

### NOP — No Operation

```
NOP
```

Does nothing. Encoded as `BR` with NZP=0 (never branch).

**Size:** 1 word.

---

### BRA — Branch Always

```
BRA label
```

Unconditional branch. Same as `BRNZP label`. Uses 9-bit signed offset.

**Size:** 1 word.

---

## 6. Assembler Directives

### .ORG — Set Origin Address

```
.ORG address
```

Sets the current assembly address. Code/data following this directive will be placed starting at the specified address.

```asm
.ORG 0x1000
; Code here starts at address 0x1000
```

### .WORD — Emit Raw Data Words

```
.WORD value1, value2, ...
```

Emits one or more 16-bit data words at the current address.

```asm
myTable:
  .WORD 100, 200, 300
  .WORD 0xFFFF
```

### .STRING — Emit Null-Terminated String

```
.STRING "text"
```

Emits each character as a separate 16-bit word (one character per word), followed by a null terminator word (0).

**Supports escape sequences:** `\n` (newline), `\t` (tab), `\0` (null), `\\` (backslash), `\"` (quote).

```asm
greeting: .STRING "Hello, World!\n"
; Emits: 'H', 'e', 'l', 'l', 'o', ',', ' ', 'W', 'o', 'r', 'l', 'd', '!', 10, 0
; That's 15 words (14 characters + null terminator)
```

**Note:** Comments on `.STRING` lines are handled specially — only comments after the closing quote are stripped.

### .EQU — Define Named Constant

```
.EQU NAME value
```

Defines a symbolic constant. The name can be used as an immediate value anywhere.

```asm
.EQU SCREEN_BASE 0xEC00
.EQU SCREEN_WIDTH 80
.EQU SCREEN_HEIGHT 30

LDA A, SCREEN_BASE    ; Uses the defined constant
```

---

## 7. Labels and Symbols

Labels are defined by placing a name followed by a colon:

```asm
myLabel:               ; Defines label at current address
    LDI D, 42
anotherLabel: ADD D, A ; Label and instruction on same line
```

**Label rules:**
- Names can contain letters, digits, underscores, dots, and dollar signs: `[a-zA-Z_.$][a-zA-Z0-9_.$]*`
- Labels are case-sensitive
- Labels can be used as branch targets, immediate values, or with LDA
- Duplicate labels cause an assembly error

**Forward references:** Labels can be referenced before they are defined. The assembler uses two passes: pass 1 collects all label addresses, pass 2 resolves references.

---

## 8. Memory Map

```
+------------------+-------------------+
| Address Range    | Description       |
+------------------+-------------------+
| 0x0000 - 0x0003  | Reset vector area |
| 0x0004 - 0x0007  | IRQ vector        |
| 0x0008 - 0x000B  | TRAP vector       |
| 0x000C - 0x000F  | Fault vector      |
| 0x0010 - 0xEBFF  | General RAM       |
| 0xEC00 - 0xFEBF  | Framebuffer VRAM  |
|                  |  (4800 words)     |
| 0xFEC0 - 0xFEFF  | Display-reserved gap |
| 0xFF00 - 0xFFFF  | Memory-mapped I/O |
+------------------+-------------------+
```

**Runtime convention:** the VM bootstrap and linked stdlib reserve a few words near the top of general RAM for bookkeeping. In practice, code generated by the toolchain initializes `SP` to `0xEBF0`, so pushes land below that reserved area rather than at `0xEBFF`.

### Vector Table (Fixed Addresses)

| Address | Purpose |
|---------|---------|
| **0x0000** | Reset entry point — execution starts here |
| **0x0004** | Interrupt handler entry point |
| **0x0008** | TRAP handler entry point |
| **0x000C** | Fault handler entry point |

A typical boot sequence places a jump to the main program at address 0:

```asm
.ORG 0
LDA A, main
JMP
.ORG 4
; interrupt handler or jump
.ORG 8
; trap handler or jump
.ORG 12
; fault handler or jump

main:
    ; ... program starts here ...
```

---

## 9. Framebuffer

The framebuffer occupies addresses **0xEC00–0xFEBF** (4800 words). It supports two display modes controlled by the Display Controller.

### Text Mode

**Resolution:** 80 columns × 30 rows = 2400 words  
**Word format:** Each word encodes one character cell:

```
Bits [15:12] = background color (4-bit CGA palette index)
Bits [11:8]  = foreground color (4-bit CGA palette index)
Bits [7:0]   = ASCII character code
```

**Address formula:** `address = 0xEC00 + (row × 80) + column`

Character cells are rendered with an 8×8 font, each displayed as 8×16 pixels on the 640×480 display (doubled vertically).

**Example:** White 'A' on blue background:
```asm
; bg=1 (blue), fg=15 (white), char=0x41 ('A')
; word = 0x1F41
LDA A, 0xEC00
LDA D, 0x1F41
STORE D, [A]
```

### Pixel Mode

**Resolution:** 160 × 120 pixels  
**Pixels per word:** 4 (packed as nibbles, high nibble = leftmost pixel)  
**Row stride:** 40 words per row (160 pixels ÷ 4 pixels/word)  
**Total:** 40 × 120 = 4800 words

**Word layout:**
```
Bits [15:12] = pixel 0 (leftmost)  — CGA color index
Bits [11:8]  = pixel 1
Bits [7:4]   = pixel 2
Bits [3:0]   = pixel 3 (rightmost)
```

**Address formula:** `address = 0xEC00 + (y × 40) + (x ÷ 4)`

Each pixel is displayed as a 4×4 block on the 640×480 display.

**Example:** Draw 4 red pixels:
```asm
LDA A, 0xEC00        ; Top-left of screen
LDA D, 0x4444        ; 4 = red in CGA palette
STORE D, [A]         ; Pixels at (0,0), (1,0), (2,0), (3,0)
```

### Switching Display Modes

Write to the Display Controller mode register:

```asm
LDA A, 0xFF30        ; Display controller base
LDI D, 0             ; 0 = text mode
STORE D, [A]         ; Set text mode

LDI D, 1             ; 1 = pixel mode
STORE D, [A]         ; Set pixel mode
```

### CGA Color Palette

| Index | Hex | Color |
|-------|-----|-------|
| 0 | 0x0 | Black |
| 1 | 0x1 | Blue |
| 2 | 0x2 | Green |
| 3 | 0x3 | Cyan |
| 4 | 0x4 | Red |
| 5 | 0x5 | Magenta |
| 6 | 0x6 | Brown |
| 7 | 0x7 | Light Gray |
| 8 | 0x8 | Dark Gray |
| 9 | 0x9 | Bright Blue |
| 10 | 0xA | Bright Green |
| 11 | 0xB | Bright Cyan |
| 12 | 0xC | Bright Red |
| 13 | 0xD | Bright Magenta |
| 14 | 0xE | Yellow |
| 15 | 0xF | White |

---

## 10. I/O Device Registers

All I/O devices are memory-mapped at 0xFF00+. Access them via LOAD/STORE with A pointing to the device base address.

### Keyboard (0xFF00)

| Offset | Address | R/W | Description |
|--------|---------|-----|-------------|
| 0 | 0xFF00 | R | **Status** — 1 if a key is available, 0 otherwise |
| 1 | 0xFF01 | R | **Data** — ASCII code or special key code of pressed key (reading clears status) |

**Interrupt:** IRQ bit 1 fires when a key is pressed.

**Special key codes:** `130=Left`, `131=Up`, `132=Right`, `133=Down`, `134=Home`, `135=End`, `136=PageUp`, `137=PageDown`, `138=Insert`, `139=Delete`, `141..152=F1..F12`.

**Example:**
```asm
pollKey:
    LDA A, 0xFF00        ; Keyboard base
    LOAD D, [A]          ; D = keyboard status
    OR D, D              ; Set flags (LOAD doesn't set flags!)
    BRZ pollKey          ; Loop if no key
    LOAD D, [A+1]        ; D = ASCII key code (clears status)
```

### Timer (0xFF10)

| Offset | Address | R/W | Description |
|--------|---------|-----|-------------|
| 0 | 0xFF10 | R/W | **Control** — bit 0: enable (1=on, 0=off; disabling resets counter) |
| 1 | 0xFF11 | R/W | **Interval** — timer fires when counter reaches this value; writing resets counter |
| 2 | 0xFF12 | R | **Counter** — current count value |
| 3 | 0xFF13 | R | **Millis Low** — low 16 bits of the monotonic system millisecond clock |
| 4 | 0xFF14 | R | **Millis High** — high 16 bits of the monotonic system millisecond clock |

**Interrupt:** IRQ bit 0 fires when counter reaches interval.

**Timing note:** The monotonic millisecond clock advances from executed emulated cycles. Software that polls `0xFF13`/`0xFF14` requires timer progression, but does not require timer interrupts to be enabled or delivered.

### UART / Serial (0xFF20)

| Offset | Address | R/W | Description |
|--------|---------|-----|-------------|
| 0 | 0xFF20 | R | **TX Status** — 1 if ready to transmit |
| 1 | 0xFF21 | W | **TX Data** — write ASCII byte to transmit |
| 2 | 0xFF22 | R | **RX Status** — 1 if data received |
| 3 | 0xFF23 | R | **RX Data** — read received byte (reading clears status) |

**Interrupts:** IRQ bit 2 (RX), IRQ bit 3 (TX event after a transmit write).

**Example — Print a character:**
```asm
printChar:
    ; D = character to print
    LDA A, 0xFF20        ; UART base
    STORE D, [A+1]       ; Send character (TX always ready in emulator)
    RET
```

### Display Controller (0xFF30)

| Offset | Address | R/W | Description |
|--------|---------|-----|-------------|
| 0 | 0xFF30 | R/W | **Mode** — 0=text mode, 1=pixel mode |
| 1 | 0xFF31 | R/W | **Cursor Position** — cursor location in text mode |

### Sound (0xFF40)

4 voices, each with 2 registers. Voices 0-2 are tone voices; voice 3 is noise:

| Offset | Address | R/W | Description |
|--------|---------|-----|-------------|
| 0 | 0xFF40 | R/W | **Channel 0 Frequency** — period value (actual freq ≈ 1,000,000 / value Hz) |
| 1 | 0xFF41 | R/W | **Channel 0 Control** — `[9:8]=waveform, [7:4]=volume(0-15), [3]=enable` |
| 2 | 0xFF42 | R/W | **Channel 1 Frequency** |
| 3 | 0xFF43 | R/W | **Channel 1 Control** |
| 4 | 0xFF44 | R/W | **Channel 2 Frequency** |
| 5 | 0xFF45 | R/W | **Channel 2 Control** |
| 6 | 0xFF46 | R/W | **Channel 3 Noise Rate** — lower values produce faster/noisier playback |
| 7 | 0xFF47 | R/W | **Channel 3 Control** — `[9:8]=noise mode, [7:4]=volume(0-15), [3]=enable` |

**Control word bits:**
- Tone voices (channels 0-2), bits [9:8]: Waveform — 0=square, 1=triangle, 2=sawtooth, 3=sawtooth
- Noise voice (channel 3), bits [9:8]: Noise mode selector — modes 0..3 choose among the emulator's built-in noise variants
- Bit 3: Enable — 1=on, 0=off
- Bits [7:4]: Volume — 0–15

**Example — Play a tone:**
```asm
LDA A, 0xFF40        ; Sound base
LDA D, 2273          ; ~440 Hz (1000000/440 ≈ 2273)
STORE D, [A]         ; Set frequency
LDI D, 0x98          ; Enable (bit 3) + volume 9, waveform 0 (square)
; Actually: bits [7:4]=volume=9=1001, bit 3=enable=1 → 0b10011000 = 0x98
STORE D, [A+1]       ; Start sound
```

### Disk Controller (0xFF50)

| Offset | Address | R/W | Description |
|--------|---------|-----|-------------|
| 0 | 0xFF50 | R/W | **Command** — 0=idle, 1=read sector, 2=write sector (writing triggers action) |
| 1 | 0xFF51 | R/W | **Sector** — sector number (0–255) |
| 2 | 0xFF52 | R/W | **Memory Address** — RAM address for DMA transfer |
| 3 | 0xFF53 | R | **Status** — 0=idle, 1=busy, 2=complete, 4=error |

**Sector size:** 128 words. **Total disk:** 256 sectors × 128 words = 32,768 words.

**Interrupt:** IRQ bit 4 fires on completion.

**Example — Read sector 0 to RAM address 0x2000:**
```asm
LDA A, 0xFF50        ; Disk base
LDI D, 0
STORE D, [A+1]       ; Sector 0
LDA D, 0x2000
STORE D, [A+2]       ; DMA target address
LDI D, 1
STORE D, [A]         ; Execute read command
; Wait until status becomes nonzero (2=complete, 4=error)
waitDisk:
    LOAD D, [A+3]    ; Read status
    OR D, D
    BRZ waitDisk
```

### System Control / Interrupt Controller (0xFFF0)

| Offset | Address | R/W | Description |
|--------|---------|-----|-------------|
| 0 | 0xFFF0 | R/W | **Pending** — each bit = pending interrupt (write 1 to clear a bit) |
| 1 | 0xFFF1 | R/W | **Mask** — each bit = interrupt enable (1=enabled) |

**IRQ bit assignments:**

| Bit | IRQ | Source |
|-----|-----|--------|
| 0 | Timer | Timer interval elapsed |
| 1 | Keyboard | Key pressed |
| 2 | UART RX | UART data received |
| 3 | UART TX | UART transmit event after write |
| 4 | Disk | Disk operation complete |

An interrupt fires when `(pending & mask) != 0` and the CPU's IE bit is set.

---

## 11. Interrupt System

### How Interrupts Work

1. A device sets its pending interrupt bit in the System Control pending register
2. On each instruction, the CPU checks: `if IE && (pending & mask) != 0`
3. If triggered for IRQ `n`:
   - EPC = PC (current PC, pointing to next instruction)
   - CAUSE = `(saved_STATUS_low_byte << 8) | irq_number`
   - Clear the pending bit for this IRQ
   - MODE = kernel, IE = disabled
   - If was in user mode: swap SP ↔ KSP
   - PC = 4 (interrupt vector)

### Writing an Interrupt Handler

```asm
.ORG 4
    LDA A, irqHandler
    JMP

irqHandler:
    ; Save all registers you use
    PUSH A
    PUSH D
    PUSH B

    ; Read CAUSE to determine IRQ number
    RDCTL D, CAUSE
    LDI B, 0xFF
    AND D, B              ; D = IRQ number (low byte of CAUSE)

    ; Handle the interrupt...

    ; Restore STATUS from the saved low byte in CAUSE[15:8]
    RDCTL D, CAUSE
    LDI B, 8
.restoreStatus:
    ASR D
    DEC B
    BRP .restoreStatus
    LDI B, 0x0F
    AND D, B
    WRCTL STATUS, D

    ; Restore registers
    POP B
    POP D
    POP A
    IRET
```

---

## 12. Fault System

Faults occur for protection violations (user mode only, except double faults):

| Cause Code | Fault | Trigger |
|------------|-------|---------|
| 16 | FAULT_FETCH | PC outside LIMIT in user mode |
| 17 | FAULT_LOAD | LOAD address outside LIMIT |
| 18 | FAULT_STORE | STORE address outside LIMIT |
| 19 | FAULT_STACK | Stack operation outside LIMIT |
| 20 | FAULT_PRIVILEGE | SYS instruction in user mode |
| 21 | FAULT_IO | Access to I/O space (≥ 0xFF00) in user mode |

**Fault handler entry:**
- EPC = PC - 1 (address of faulting instruction)
- CAUSE = `(saved_STATUS_low_byte << 8) | fault_code`
- MODE = kernel, IE = disabled
- If was user mode: swap SP ↔ KSP
- PC = 12 (fault vector)

**Double fault:** If a fault occurs while already handling a fault, the CPU halts.

---

## 13. Kernel/User Mode

### STATUS Register Layout

```
Bit 3: MODE  — 0=kernel, 1=user
Bit 2: IE    — 0=interrupts disabled, 1=enabled
Bit 1: N     — negative flag
Bit 0: Z     — zero flag
```

### Kernel Mode

- Full access to all memory and I/O
- Can execute SYS instructions (HALT, IRET, RDCTL, WRCTL)
- No address translation (virtual = physical)

### User Mode

- Memory accesses are translated: `physical = BASE + virtual`
- Accesses beyond LIMIT cause faults
- I/O access (≥ 0xFF00) causes faults
- SYS instructions cause privilege faults
- System calls via TRAP instruction

### Switching to User Mode

```asm
; Set up user memory region
LDA D, 0x1000
WRCTL BASE, D        ; User memory starts at 0x1000
LDA D, 0x4000
WRCTL LIMIT, D       ; User can access 16K words

; Set up kernel stack pointer
WRCTL KSP, SP        ; Save current SP as kernel SP

; Set user's SP
LDA SP, 0x3FFF       ; User stack at top of user space

; Set EPC to user entry point
LDA D, 0             ; User code starts at virtual address 0
WRCTL EPC, D

; Set STATUS: MODE=1 (user), IE=1 (interrupts)
LDI D, 12            ; Bits 3 and 2: MODE=1, IE=1
WRCTL STATUS, D

; Enter user mode
IRET
```

---

## 14. Calling Conventions

The Nexa-16 hardware does not enforce any calling convention—it's up to the programmer. Here is a recommended convention:

### Simple Convention (for assembly programs)

1. **Arguments:** Pass via registers (D, B) or push onto stack
2. **Return value:** In D
3. **Callee-saved:** Save and restore any registers you modify
4. **Caller responsibility:** Load A with function address before CALL

```asm
; Caller:
LDI D, 42           ; Argument in D
LDA A, myFunction
CALL

; Callee:
myFunction:
    PUSH B               ; Save registers you'll use
    ; ... use D as input ...
    ; ... put result in D ...
    POP  B               ; Restore
    RET
```

### Stack-Based Convention (for compiled code)

Used by the Nexa compiler's VM translator:

1. Push arguments onto stack
2. CALL pushes return address
3. Callee pushes saved frame (return address is already on stack)
4. Local variables allocated on stack
5. Return value in D or on stack

---

## 15. Common Patterns and Idioms

### Loading a 16-bit constant

```asm
LDA A, 0xEC00        ; Use LDA pseudo-instruction (LDI + LDU, 2 words)
```

### Test a value without modifying it

```asm
; Option 1: OR with itself (1 word, works for any register)
OR D, D              ; Sets N and Z based on D — does NOT change D

; Option 2: TST pseudo-instruction (3 words, works for any register)
TST D                ; Expands to PUSH A / MOV A, D / POP A
```

### Check if LOAD result is zero

```asm
LOAD D, [A]          ; LOAD does NOT set flags!
OR D, D              ; Set flags based on D's value
BRZ isZero           ; Now you can branch
```

### Loop a fixed number of times

```asm
    LDI D, 10           ; Counter = 10
loop:
    ; ... loop body ...
    DEC D                ; D = D - 1 (sets flags via SUB)
    BRP loop             ; Loop while D > 0
```

### Multiply by a power of 2

```asm
; Multiply D by 4
SHL D                ; D = D * 2
SHL D                ; D = D * 4
```

### Read a string character by character

```asm
    LDA A, myString
readLoop:
    LOAD D, [A]          ; Get character
    OR D, D              ; Check for null terminator (LOAD doesn't set flags!)
    BRZ done             ; Null terminator = end of string
    ; ... process character in D ...
    PUSH B
    LDI B, 1
    ADD A, B             ; A = A + 1 (advance pointer)
    POP B
    BRA readLoop
done:
```

### Print a string via UART

```asm
printString:
    ; A = pointer to null-terminated string
    PUSH A
    PUSH D
    PUSH B
    MOV B, A             ; B = string pointer
.ps_loop:
    MOV A, B
    LOAD D, [A]
    OR D, D              ; Check for null
    BRZ .ps_done
    LDA A, 0xFF20        ; UART base
    STORE D, [A+1]       ; Transmit character
    PUSH A
    LDI A, 1
    ADD B, A             ; Advance string pointer
    POP A
    BRA .ps_loop
.ps_done:
    POP B
    POP D
    POP A
    RET
```

### Subroutine with stack-passed argument

```asm
; Caller:
    LDA D, 0xEC00
    PUSH D               ; Push argument
    LDA A, myFunc
    CALL
    POP D                ; Clean up argument from stack

; Callee:
myFunc:
    ; Return address is at [SP]
    ; Argument is at [SP+1]
    PUSH A
    MOV A, SP
    LOAD D, [A+2]        ; Load argument (skip saved A and return address)
    ; ... use D ...
    POP A
    RET
```

### Fill memory region

```asm
; Fill 80 words at 0xEC00 with value 0x0F20 (white space on black)
    LDA A, 0xEC00
    LDA D, 0x0F20        ; White on black, space character
    LDI B, 80            ; Counter
fillLoop:
    STORE D, [A]          ; Write value
    PUSH B                ; Save counter
    LDI B, 1
    ADD A, B              ; Advance address
    POP B
    DEC B                 ; Decrement counter (sets flags)
    BRP fillLoop          ; Loop while counter > 0
```

---

## 16. Critical Gotchas

### 1. LOAD Does NOT Set Flags

This is the #1 source of bugs. After a LOAD instruction, the CPU flags (N, Z) are **unchanged** from whatever set them last.

```asm
; WRONG:
LOAD D, [A]
BRZ target           ; ← Checks STALE flags, NOT D's value!

; CORRECT:
LOAD D, [A]
OR D, D              ; Sets flags based on D
BRZ target           ; Now this works correctly
```

### 2. LDI and LDU Do NOT Set Flags

Same issue — load immediate instructions don't affect flags.

```asm
; WRONG:
LDI D, 0
BRZ somewhere        ; ← Checks stale flags!

; CORRECT:
LDI D, 0
OR D, D              ; Force flag update
BRZ somewhere
```

### 3. CALL Ignores Its Label Operand

The assembler parses `CALL someLabel` but **discards the label**. CALL always jumps to whatever is in register A. You must explicitly load A first.

```asm
; WRONG:
CALL myFunction       ; ← Does NOT jump to myFunction!
                      ;    Jumps to whatever A currently holds.

; CORRECT:
LDA A, myFunction     ; Load function address into A
CALL                  ; Now jumps to myFunction
```

### 4. JMP Also Ignores Its Label Operand

Same as CALL — JMP always jumps to A.

```asm
; WRONG:
JMP someLabel         ; ← Jumps to A, not someLabel!

; CORRECT:
LDA A, someLabel
JMP
```

### 5. LOAD/STORE Always Use A as Base

You cannot use D, B, or SP as the base address for memory operations. Only A.

```asm
; WRONG (not possible in this ISA):
; LOAD D, [B+5]      ; ← Not supported

; CORRECT:
MOV A, B              ; Copy B to A first
LOAD D, [A+5]         ; Now use A as base
```

### 6. Branch Range is Limited

Branch offsets are 9-bit signed: **-256 to +255** words from the instruction after the branch. For longer jumps, use JMP:

```asm
; If target is too far for branch:
LDA A, farTarget
JMP
```

### 7. Register A is Special and Heavily Used

A is used as the base for LOAD/STORE and the target for JMP/CALL. This means you must carefully manage A's value. Save it to the stack before LOAD/STORE sequences if you need to preserve its value.

### 8. Pseudo-Instructions Can Clobber Temporary Registers

INC, DEC use B as a temp (or A if target is B). NEG uses B as a temp. TST and CMP use A as a temp. All save/restore the temp register via PUSH/POP, so this is generally safe — but be aware of the stack usage.

### 9. .STRING Stores One Character Per Word

Unlike x86 where strings are byte-packed, each character takes a full 16-bit word. A 10-character string uses 11 words (including null terminator).

### 10. Stack Grows Downward

PUSH decrements SP *before* writing. POP reads *then* increments SP. Initialize SP to an address **above** your data to avoid overwriting code/data.

```asm
LDA SP, 0xEBF0       ; VM/runtime stack anchor (leaves top bookkeeping words free)
```

### 11. STORE/LOAD Offset Range

The offset in LOAD/STORE is 8-bit signed: **-128 to +127**. For larger offsets, you must adjust A.

---

## 17. Complete Example Programs

### Example 1: Hello World (Text Mode)

```asm
; Writes "HELLO" to the screen in text mode
.ORG 0
    LDA SP, 0xEBF0       ; Initialize stack

    LDA A, 0xEC00         ; Framebuffer start (text mode)
    LDA D, 0x0F48          ; White 'H' on black: bg=0, fg=F, char=0x48
    STORE D, [A]
    LDA D, 0x0F45          ; 'E'
    STORE D, [A+1]
    LDA D, 0x0F4C          ; 'L'
    STORE D, [A+2]
    STORE D, [A+3]         ; 'L' again
    LDA D, 0x0F4F          ; 'O'
    STORE D, [A+4]

    HALT
```

### Example 2: Keyboard Echo

```asm
; Reads keyboard input and echoes to UART
.ORG 0
    LDA SP, 0xEBF0

mainLoop:
    LDA A, 0xFF00          ; Keyboard base
    LOAD D, [A]            ; Read status
    OR D, D                ; Set flags (LOAD doesn't!)
    BRZ mainLoop           ; No key? Loop

    LOAD D, [A+1]          ; Read key ASCII (clears status)

    LDA A, 0xFF20          ; UART base
    STORE D, [A+1]         ; Transmit character

    BRA mainLoop
```

### Example 3: Pixel Gradient

```asm
; Fills the entire pixel-mode screen with a color gradient
.ORG 0
    LDA SP, 0xEBF0

    ; Switch to pixel mode
    LDA A, 0xFF30
    LDI D, 1
    STORE D, [A]

    ; Fill 4800 words at 0xEC00
    ; Each word = 4 pixels, all same color nibble repeated
    ; Color increments every 300 words (wraps 0-F)
    LDA A, 0xEC00          ; Framebuffer base
    LDI D, 0               ; Color counter
    LDI B, 0               ; Word counter

fillLoop:
    STORE D, [A]           ; Write 4 pixels

    ; Advance A by 1
    PUSH B
    LDI B, 1
    ADD A, B
    POP B

    ; Increment word counter
    INC B

    ; Check if done (4800 words)
    PUSH A
    PUSH D
    LDA A, 4800
    CMP B, A               ; Note: CMP with A uses 3-word form
    POP D
    POP A
    BRZ done

    BRA fillLoop

done:
    HALT
```

### Example 4: Subroutine Call Example

```asm
; Demonstrates proper subroutine calling
.ORG 0
    LDA SP, 0xEBF0

    LDI D, 10               ; First argument
    LDA A, doubleIt
    CALL                     ; D = D * 2
    ; D now contains 20

    HALT

doubleIt:
    ; Input: D = value to double
    ; Output: D = value * 2
    SHL D                    ; D = D << 1 = D * 2
    RET
```

---

## Quick Reference Card

### Instructions that SET flags:
`ADD`, `SUB`, `AND`, `OR`, `NOT`, `SHL`, `ASR`, `MOV`, `XOR`

### Instructions that DO NOT set flags:
`LDI`, `LDU`, `LOAD`, `STORE`, `PUSH`, `POP`, `JMP`, `CALL`, `RET`, `BR`, `TRAP`, `NOP`

### Pseudo-instruction sizes:
| Pseudo | Words |
|--------|-------|
| NOP | 1 |
| CLR | 1 |
| BRA | 1 |
| LDA | 2 |
| TST | 3 |
| CMP (r2=A) | 3 |
| CMP (r2≠A) | 4 |
| INC | 4 |
| DEC | 4 |
| NEG | 5 |

### Register encoding:
| Register | Bits |
|----------|------|
| A | 00 |
| D | 01 |
| B | 10 |
| SP | 11 |

### Key addresses:
| Address | What |
|---------|------|
| 0x0000 | Reset vector |
| 0x0004 | IRQ vector |
| 0x0008 | TRAP vector |
| 0x000C | Fault vector |
| 0xEC00 | Framebuffer start |
| 0xFEBF | Framebuffer end |
| 0xFF00 | Keyboard |
| 0xFF10 | Timer |
| 0xFF20 | UART |
| 0xFF30 | Display |
| 0xFF40 | Sound |
| 0xFF50 | Disk |
| 0xFFF0 | System Control |
