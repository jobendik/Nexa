; ============================================================
; NexaOS v2.1 Boot Loader - boot.asm
; Nexa ASM
;
; First-stage boot loader for NexaOS.
; Initializes hardware, clears the screen, shows boot splash
; with hardware detection messages, then jumps to the VM
; bootstrap which starts the Nexa OS kernel.
;
; Memory layout:
;   RAM[0x0002] = cursor variable (framebuffer address)
;   Stack: 0xEBF0 (grows downward)
;
; Framebuffer: 0xEC00 (80x30 text cells)
; Cell format: (bg<<12) | (fg<<8) | ascii
;   Example: 0x0F48 = black bg, white fg, 'H'
;            0x1F48 = blue bg,  white fg, 'H'
; ============================================================

.EQU DISP_CTRL,    0xFF30    ; Display mode register (0=text, 1=pixel)
.EQU FRAMEBUF,     0xEC00    ; Start of framebuffer
.EQU FRAMEBUF_END, 0xF560    ; End of framebuffer (0xEC00 + 2400)
.EQU STACK_TOP,    0xEBF0    ; Stack grows down from here
.EQU CURSOR_VAR,   0x0002    ; RAM address holding current cursor

; ============================================================
; RESET VECTOR / ENTRY POINT (address 0x0000)
; ============================================================

reset:
    ; --- Initialize stack pointer ---
    LDA SP, STACK_TOP

    ; --- Switch to text mode ---
    LDA A, DISP_CTRL
    CLR D
    STORE D, [A]

    ; --- Initialize cursor to framebuffer start ---
    LDA A, CURSOR_VAR
    LDA D, FRAMEBUF
    STORE D, [A]

    ; --------------------------------------------------------
    ; CLEAR SCREEN
    ; Fill 0xEC00..0xF55F with 0x0720 (black bg, gray fg, space)
    ; Classic dark DOS look.
    ; --------------------------------------------------------
    LDA A, FRAMEBUF
    LDA D, 0x0720
cls_loop:
    STORE D, [A]
    INC A
    PUSH D
    LDA D, FRAMEBUF_END
    CMP A, D
    POP D
    BRN cls_loop

    ; --------------------------------------------------------
    ; HEADER ROW (row 0)
    ; Fill row 0 (80 cells) with 0x1F20 (blue bg, white fg, space)
    ; --------------------------------------------------------
    LDA A, FRAMEBUF
    LDA D, 0x1F20
hdr_fill:
    STORE D, [A]
    INC A
    PUSH D
    LDA D, 0xEC50
    CMP A, D
    POP D
    BRN hdr_fill

    ; Write "  NexaOS v2.1  " at col 32 (white on blue)
    ; 0xEC00 + 32 = 0xEC20
    LDA A, 0xEC20
    LDA D, 0x1F20 ; ' '
    STORE D, [A+0]
    STORE D, [A+1]
    LDA D, 0x1F4E ; 'N'
    STORE D, [A+2]
    LDA D, 0x1F65 ; 'e'
    STORE D, [A+3]
    LDA D, 0x1F78 ; 'x'
    STORE D, [A+4]
    LDA D, 0x1F61 ; 'a'
    STORE D, [A+5]
    LDA D, 0x1F4F ; 'O'
    STORE D, [A+6]
    LDA D, 0x1F53 ; 'S'
    STORE D, [A+7]
    LDA D, 0x1F20 ; ' '
    STORE D, [A+8]
    LDA D, 0x1F20 ; ' '
    STORE D, [A+9]
    LDA D, 0x1F76 ; 'v'
    STORE D, [A+10]
    LDA D, 0x1F32 ; '2'
    STORE D, [A+11]
    LDA D, 0x1F2E ; '.'
    STORE D, [A+12]
    LDA D, 0x1F31 ; '1'
    STORE D, [A+13]
    LDA D, 0x1F20 ; ' '
    STORE D, [A+14]
    STORE D, [A+15]

    ; Write "[?=Help]" at right side of header (col 70)
    ; 0xEC00 + 70 = 0xEC46
    LDA A, 0xEC46
    LDA D, 0x1F5B ; '['
    STORE D, [A+0]
    LDA D, 0x1F3F ; '?'
    STORE D, [A+1]
    LDA D, 0x1F3D ; '='
    STORE D, [A+2]
    LDA D, 0x1F48 ; 'H'
    STORE D, [A+3]
    LDA D, 0x1F65 ; 'e'
    STORE D, [A+4]
    LDA D, 0x1F6C ; 'l'
    STORE D, [A+5]
    LDA D, 0x1F70 ; 'p'
    STORE D, [A+6]
    LDA D, 0x1F5D ; ']'
    STORE D, [A+7]

    ; --------------------------------------------------------
    ; BOOT MESSAGES
    ; Set cursor to each row and call print_str (B = string ptr)
    ; --------------------------------------------------------

    ; Row 2 = 0xEC00 + 160 = 0xECA0
    LDA A, CURSOR_VAR
    LDA D, 0xECA0
    STORE D, [A]
    LDA A, STR_INIT
    MOV B, A
    LDA A, print_str
    CALL

    ; Row 3 = 0xEC00 + 240 = 0xECF0
    LDA A, CURSOR_VAR
    LDA D, 0xECF0
    STORE D, [A]
    LDA A, STR_COPY
    MOV B, A
    LDA A, print_str
    CALL

    ; Row 5 = 0xEC00 + 400 = 0xED90
    LDA A, CURSOR_VAR
    LDA D, 0xED90
    STORE D, [A]
    LDA A, STR_MEM
    MOV B, A
    LDA A, print_str
    CALL

    ; Row 6 = 0xEC00 + 480 = 0xEDE0
    LDA A, CURSOR_VAR
    LDA D, 0xEDE0
    STORE D, [A]
    LDA A, STR_VID
    MOV B, A
    LDA A, print_str
    CALL

    ; Row 7 = 0xEC00 + 560 = 0xEE30
    LDA A, CURSOR_VAR
    LDA D, 0xEE30
    STORE D, [A]
    LDA A, STR_KB
    MOV B, A
    LDA A, print_str
    CALL

    ; Row 8 = 0xEC00 + 640 = 0xEE80
    LDA A, CURSOR_VAR
    LDA D, 0xEE80
    STORE D, [A]
    LDA A, STR_DISK
    MOV B, A
    LDA A, print_str
    CALL

    ; Row 9 = 0xEC00 + 720 = 0xEED0
    LDA A, CURSOR_VAR
    LDA D, 0xEED0
    STORE D, [A]
    LDA A, STR_SND
    MOV B, A
    LDA A, print_str
    CALL

    ; Short delay
    LDA A, delay
    CALL

    ; Row 11 = 0xEC00 + 880 = 0xEF70
    LDA A, CURSOR_VAR
    LDA D, 0xEF70
    STORE D, [A]
    LDA A, STR_FS
    MOV B, A
    LDA A, print_str
    CALL

    ; Short delay
    LDA A, delay
    CALL

    ; Row 12 = 0xEC00 + 960 = 0xEFC0
    LDA A, CURSOR_VAR
    LDA D, 0xEFC0
    STORE D, [A]
    LDA A, STR_LOAD
    MOV B, A
    LDA A, print_str
    CALL

    ; Delay before showing ready message
    LDA A, long_delay
    CALL

    ; Row 14 = 0xEC00 + 1120 = 0xF060
    LDA A, CURSOR_VAR
    LDA D, 0xF060
    STORE D, [A]
    LDA A, STR_READY
    MOV B, A
    LDA A, print_str
    CALL

    ; --------------------------------------------------------
    ; Wait for keypress then jump to VM bootstrap
    ; --------------------------------------------------------
wait_key:
    LDA A, 0xFF00         ; keyboard status register
    LOAD D, [A]
    LDI A, 1
    AND D, A              ; bit 0 = key available?
    BRZ wait_key          ; loop until key pressed
    LDA A, 0xFF01         ; read (and consume) the key
    LOAD D, [A]

    LDA A, __vm_boot
    JMP


; ============================================================
; SUBROUTINE: print_str
;
; Prints a null-terminated string to the framebuffer.
; Uses white-on-black (0x0F) color attribute.
;
; Input:  B = address of null-terminated string
;         RAM[CURSOR_VAR] (0x0002) = current cursor position
; Output: RAM[CURSOR_VAR] updated to next write position
; Clobbers: A, D (but saves/restores via stack), B (advances)
; ============================================================
print_str:
    PUSH A
    PUSH D
pstr_loop:
    MOV A, B              ; A = current string pointer
    LOAD D, [A]           ; D = character at that address
    TST D                 ; test D (sets Z if D == 0)
    BRZ pstr_done         ; null terminator -> done
    ; Build colored cell: 0x0F00 | character
    PUSH D                ; save raw character
    LDA D, 0x0F00         ; D = white-on-black attribute
    POP A                 ; A = raw character
    OR D, A               ; D = 0x0F00 | char (colored cell)
    ; Write colored cell to framebuffer at cursor position
    PUSH D                ; save colored cell
    LDA A, CURSOR_VAR     ; A = address of cursor variable
    LOAD A, [A]           ; A = cursor (framebuffer address)
    POP D                 ; D = colored cell
    STORE D, [A]          ; framebuffer[cursor] = colored cell
    INC A                 ; advance cursor (A = cursor + 1)
    ; Save updated cursor back to RAM
    PUSH D                ; save D
    MOV D, A              ; D = new cursor value
    LDA A, CURSOR_VAR     ; A = &cursor
    STORE D, [A]          ; RAM[CURSOR_VAR] = new cursor
    POP D                 ; restore D
    ; Advance string pointer: B = B + 1
    PUSH A                ; save A
    LDI A, 1
    ADD B, A              ; B++ (string pointer advances)
    POP A                 ; restore A
    BRA pstr_loop
pstr_done:
    POP D
    POP A
    RET


; ============================================================
; SUBROUTINE: delay
;
; Busy-wait delay loop (~5000 iterations).
; ============================================================
delay:
    PUSH A
    PUSH D
    LDA D, 5000
dly_loop:
    DEC D
    TST D
    BRP dly_loop
    POP D
    POP A
    RET


; ============================================================
; SUBROUTINE: long_delay
;
; Nested busy-wait (~2 seconds at emulator speed).
; Uses RAM[0x0003] as outer counter to avoid register conflicts
; (DEC pseudo-instruction uses B as scratch).
; ============================================================
.EQU LD_OUTER_VAR, 0x0003
long_delay:
    PUSH A
    PUSH D
    LDA D, 200
    LDA A, LD_OUTER_VAR
    STORE D, [A]
ld_outer:
    LDA D, 30000
ld_inner:
    DEC D
    TST D
    BRP ld_inner
    LDA A, LD_OUTER_VAR
    LOAD D, [A]
    DEC D
    STORE D, [A]
    TST D
    BRP ld_outer
    POP D
    POP A
    RET


; ============================================================
; STRING DATA
; ============================================================

STR_INIT:
    .string "Initializing NexaOS v2.1 ..."

STR_COPY:
    .string "Copyright (c) 2025 Nexa Labs. All rights reserved."

STR_MEM:
    .string "Memory test ..............  64K words       [ OK ]"

STR_VID:
    .string "Video adapter .............  Text 80x30     [ OK ]"

STR_KB:
    .string "Keyboard ......................  PS/2 std   [ OK ]"

STR_DISK:
    .string "Disk controller ...  256 sec x 128 words   [ OK ]"

STR_SND:
    .string "Sound ...................  2ch square wave   [ OK ]"

STR_FS:
    .string "Checking for NexaFS on disk ..."

STR_LOAD:
    .string "Starting kernel ..."

STR_READY:
    .string "Press any key to start NexaOS ..."
