// Demo programs for Nexa-16 (assembly) and Nexa (high-level)
//
// Text framebuffer: 0xEC00, 80 cols x 30 rows = 2400 words.
// Word format: bits[15:12]=bg, bits[11:8]=fg, bits[7:0]=ASCII.
// Palette: 0=black 1=blue 2=green 3=cyan 4=red 5=magenta
//   6=brown 7=gray 8=dk gray 9=br blue A=br green B=br cyan
//   C=br red D=br magenta E=yellow F=white
// Pixel framebuffer: same base, 160x120, 4 pixels/word (nibbles).
// Display mode: 0xFF30 offset 0 (0=text, 1=pixel).

// ──────────────────────────────────────────────────────────────
// Demo 1: ALU Test
// ──────────────────────────────────────────────────────────────
var defaultProgram = `; Nexa-16 ALU Verification Test
; Tests every ALU operation and displays PASS/FAIL on screen.
; If all lines are green, the ALU works perfectly.

      LDA SP, 0xEBF0    ; init stack

      ; Set text mode
      LDA A, 0xFF30
      CLR D
      STORE D, [A]

      ; B = framebuffer cursor (text cell address)
      LDA B, 0xEC00

      ; ----- Test 1: ADD -----
      LDI D, 10
      LDI A, 20
      ADD D, A           ; D = 10+20 = 30
      PUSH B
      LDI B, 30
      SUB D, B           ; D = 30-30 = 0, Z flag set
      POP B
      BRZ t1pass
      LDA D, 1
      BRA t1show
t1pass:
      CLR D
t1show:
      ; D=0 means pass, D!=0 means fail
      PUSH D
      LDA A, str_add
      PUSH A
      LDI D, 1
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 2: SUB -----
      LDI D, 50
      LDI A, 30
      SUB D, A           ; D = 50-30 = 20
      PUSH B
      LDI B, 20
      SUB D, B           ; should be 0
      POP B
      BRZ t2pass
      LDA D, 1
      BRA t2show
t2pass:
      CLR D
t2show:
      PUSH D
      LDA A, str_sub
      PUSH A
      LDI D, 2
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 3: AND -----
      LDA D, 0xFF0F
      LDA A, 0x0FFF
      AND D, A           ; D = 0x0F0F
      PUSH B
      LDA B, 0x0F0F
      SUB D, B
      POP B
      BRZ t3pass
      LDA D, 1
      BRA t3show
t3pass:
      CLR D
t3show:
      PUSH D
      LDA A, str_and
      PUSH A
      LDI D, 3
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 4: OR -----
      LDA D, 0xF000
      LDA A, 0x00FF
      OR D, A            ; D = 0xF0FF
      PUSH B
      LDA B, 0xF0FF
      SUB D, B
      POP B
      BRZ t4pass
      LDA D, 1
      BRA t4show
t4pass:
      CLR D
t4show:
      PUSH D
      LDA A, str_or
      PUSH A
      LDI D, 4
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 5: XOR -----
      LDA D, 0xFF00
      LDA A, 0x0FF0
      XOR D, A           ; D = 0xF0F0
      PUSH B
      LDA B, 0xF0F0
      SUB D, B
      POP B
      BRZ t5pass
      LDA D, 1
      BRA t5show
t5pass:
      CLR D
t5show:
      PUSH D
      LDA A, str_xor
      PUSH A
      LDI D, 5
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 6: NOT -----
      LDA D, 0xFF00
      NOT D              ; D = 0x00FF
      PUSH B
      LDA B, 0x00FF
      SUB D, B
      POP B
      BRZ t6pass
      LDA D, 1
      BRA t6show
t6pass:
      CLR D
t6show:
      PUSH D
      LDA A, str_not
      PUSH A
      LDI D, 6
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 7: SHL -----
      LDI D, 1
      SHL D              ; D = 2
      SHL D              ; D = 4
      SHL D              ; D = 8
      PUSH B
      LDI B, 8
      SUB D, B
      POP B
      BRZ t7pass
      LDA D, 1
      BRA t7show
t7pass:
      CLR D
t7show:
      PUSH D
      LDA A, str_shl
      PUSH A
      LDI D, 7
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 8: ASR -----
      LDA D, 0x8000      ; -32768
      ASR D              ; D = 0xC000 (sign-extended)
      PUSH B
      LDA B, 0xC000
      SUB D, B
      POP B
      BRZ t8pass
      LDA D, 1
      BRA t8show
t8pass:
      CLR D
t8show:
      PUSH D
      LDA A, str_asr
      PUSH A
      LDI D, 8
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 9: MOV -----
      LDA A, 0x1234
      MOV D, A           ; D = 0x1234
      PUSH B
      LDA B, 0x1234
      SUB D, B
      POP B
      BRZ t9pass
      LDA D, 1
      BRA t9show
t9pass:
      CLR D
t9show:
      PUSH D
      LDA A, str_mov
      PUSH A
      LDI D, 9
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 10: Flag N (negative) -----
      LDI D, -1          ; D = 0xFFFF
      OR D, D            ; set flags: N=1, Z=0
      BRN t10pass
      LDA D, 1
      BRA t10show
t10pass:
      CLR D
t10show:
      PUSH D
      LDA A, str_flagn
      PUSH A
      LDI D, 10
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 11: Flag Z (zero) -----
      CLR D
      OR D, D            ; D=0, flags: N=0, Z=1
      BRZ t11pass
      LDA D, 1
      BRA t11show
t11pass:
      CLR D
t11show:
      PUSH D
      LDA A, str_flagz
      PUSH A
      LDI D, 11
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 12: Flag P (positive) -----
      LDI D, 42
      OR D, D            ; D>0, flags: N=0, Z=0 => P
      BRP t12pass
      LDA D, 1
      BRA t12show
t12pass:
      CLR D
t12show:
      PUSH D
      LDA A, str_flagp
      PUSH A
      LDI D, 12
      LDA A, printResult
      CALL
      POP A
      POP D

      HALT

; =========================================================
; printResult: prints "NN. <label> PASS" or "NN. <label> FAIL"
;   A = pointer to label string (null-terminated)
;   D = test number (1-based)
;   Stack: caller saved B (cursor), pass/fail flag below that
; Uses: A, D, B
; Screen cursor is at address in the word below B on stack.
; =========================================================
printResult:
      ; Load cursor from stack: SP points to retaddr, SP+1 = saved B (cursor)
      ; We receive: D = test number, A = string ptr
      ; TOS: [retAddr] [saved_B_cursor] [pass_flag]
      PUSH D             ; save test number

      ; Calculate row: each result on its own 80-char row
      ; row_addr = 0xEC00 + (testnum - 1) * 80
      ; D still has test number
      DEC D              ; D = testnum - 1
      ; Multiply by 80: D*80 = D*64 + D*16
      MOV A, D
      ; A = D = (testnum-1)
      SHL A              ; *2
      SHL A              ; *4
      SHL A              ; *8
      SHL A              ; *16
      MOV B, A           ; B = D*16
      SHL A              ; *32
      SHL A              ; *64
      ADD A, B           ; A = D*64 + D*16 = D*80
      LDA B, 0xEC00
      ADD A, B           ; A = framebuffer row address
      MOV B, A           ; B = write cursor

      ; Write test number (two digits)
      POP D              ; D = test number
      MOV A, D
      CLR D
pr_tens:
      PUSH B
      LDI B, 10
      CMP A, B
      POP B
      BRN pr_tens_done
      PUSH B
      LDI B, 10
      SUB A, B
      POP B
      INC D
      BRA pr_tens
pr_tens_done:
      ; D = tens, A = ones
      PUSH A             ; save ones
      ; Write tens digit
      MOV A, D
      PUSH B
      LDI B, 48          ; '0'
      ADD A, B           ; A = ASCII digit
      LDA B, 0x0F00      ; white on black
      OR A, B
      MOV D, A
      POP B
      MOV A, B
      STORE D, [A]       ; write tens digit
      INC B

      ; Write ones digit
      POP D              ; D = ones
      PUSH B
      LDI B, 48
      ADD D, B
      LDA B, 0x0F00
      OR D, B
      POP B
      MOV A, B
      STORE D, [A]
      INC B

      ; Write ". "
      LDA D, 0x0F2E      ; '.'
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x0F20      ; ' '
      MOV A, B
      STORE D, [A]
      INC B

      MOV A, SP
      LOAD A, [A+1]

      ; Print label string (null-terminated)
pr_str:
      LOAD D, [A]        ; load char
      OR D, D
      BRZ pr_str_done
      ; Build text cell: 0x0F00 | char
      PUSH A
      PUSH B
      MOV A, D
      LDA B, 0x0F00
      OR A, B
      MOV D, A
      POP B
      MOV A, B
      STORE D, [A]
      INC B
      POP A
      INC A
      BRA pr_str

pr_str_done:
      ; Write PASS or FAIL based on flag
      ; flag is at [SP+1] (below retaddr... actually it's gone)
      ; Rethink: the caller pushed pass_flag, then saved B cursor, then called us.
      ; On entry stack was: [pass_flag] [cursor_B] [retAddr]   (TOS = retAddr)
      ; We popped: PUSH A, PUSH D, POP D, PUSH A, ..., POP A, POP A
      ; Current stack: [retAddr] below that [cursor_B] [pass_flag]
      ; Actually we need to read the pass flag. Let's reconsider.
      ; The caller sets up: PUSH D (pass_flag), then LDA A, str, then PUSH B, LDA D testnum, CALL
      ; Stack at entry: retAddr / saved_B / pass_flag
      ; We did POP on string ptr and testnum but those were our own pushes.
      ; The "saved_B" and "pass_flag" are still underneath the return address.
      ; After RET, the caller does POP B, POP D to get them back.
      ; So we can't easily access pass_flag from here. Let's change approach:
      ; We need the caller to tell us. Let's peek at it via SP offset.
      ; Stack right now: [retAddr] [saved_B] [pass_flag]
      ; SP points to retAddr. pass_flag is at SP+2.
      MOV A, SP
      LOAD D, [A+2]      ; D = pass_flag (0=pass, nonzero=fail)
      OR D, D
      BRZ pr_pass

      ; FAIL (red)
      LDA D, 0x4C46      ; 'F' red on red
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C41      ; 'A'
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C49      ; 'I'
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C4C      ; 'L'
      MOV A, B
      STORE D, [A]
      RET

pr_pass:
      ; PASS (green)
      LDA D, 0x2A50      ; 'P' green on green
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A41      ; 'A'
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A53      ; 'S'
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A53      ; 'S'
      MOV A, B
      STORE D, [A]
      RET

; --- String data ---
str_add:   .STRING "ADD      "
str_sub:   .STRING "SUB      "
str_and:   .STRING "AND      "
str_or:    .STRING "OR       "
str_xor:   .STRING "XOR      "
str_not:   .STRING "NOT      "
str_shl:   .STRING "SHL      "
str_asr:   .STRING "ASR      "
str_mov:   .STRING "MOV      "
str_flagn: .STRING "Flag N   "
str_flagz: .STRING "Flag Z   "
str_flagp: .STRING "Flag P   "
`;

// ──────────────────────────────────────────────────────────────
// Demo 2: Memory & Stack Test — LOAD/STORE, PUSH/POP, CALL/RET
// and subroutine calling conventions.
// ──────────────────────────────────────────────────────────────
var memTestProgram = `; Nexa-16 Memory & Stack Verification Test
; Tests LOAD/STORE, PUSH/POP, CALL/RET, subroutines.
; Green PASS = good. Red FAIL = bug found.

      LDA SP, 0xEBF0

      ; Set text mode
      LDA A, 0xFF30
      CLR D
      STORE D, [A]

      LDA B, 0xEC00      ; cursor

      ; ----- Test 1: STORE then LOAD -----
      LDA A, 0x4000       ; scratch area
      LDA D, 0xBEEF
      STORE D, [A]        ; mem[0x4000] = 0xBEEF
      CLR D
      LOAD D, [A]         ; D should be 0xBEEF
      PUSH B
      LDA B, 0xBEEF
      SUB D, B
      POP B
      BRZ m1pass
      LDA D, 1
      BRA m1show
m1pass:
      CLR D
m1show:
      PUSH D
      LDA A, str_m_ldst
      PUSH A
      LDI D, 1
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 2: LOAD with offset -----
      LDA A, 0x4000
      LDA D, 0x1111
      STORE D, [A+0]
      LDA D, 0x2222
      STORE D, [A+1]
      LDA D, 0x3333
      STORE D, [A+2]
      ; Read back offset 2
      LOAD D, [A+2]
      PUSH B
      LDA B, 0x3333
      SUB D, B
      POP B
      BRZ m2pass
      LDA D, 1
      BRA m2show
m2pass:
      CLR D
m2show:
      PUSH D
      LDA A, str_m_off
      PUSH A
      LDI D, 2
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 3: PUSH then POP -----
      LDA D, 0xCAFE
      PUSH D
      CLR D
      POP D              ; D should be 0xCAFE
      PUSH B
      LDA B, 0xCAFE
      SUB D, B
      POP B
      BRZ m3pass
      LDA D, 1
      BRA m3show
m3pass:
      CLR D
m3show:
      PUSH D
      LDA A, str_m_push
      PUSH A
      LDI D, 3
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 4: Multiple PUSH/POP order -----
      LDA D, 0x1111
      PUSH D
      LDA D, 0x2222
      PUSH D
      LDA D, 0x3333
      PUSH D
      ; Pop in reverse
      POP D              ; should be 0x3333
      PUSH B
      LDA B, 0x3333
      SUB D, B
      POP B
      BRZ m4a
      LDA D, 1
      BRA m4show
m4a:
      POP D              ; should be 0x2222
      PUSH B
      LDA B, 0x2222
      SUB D, B
      POP B
      BRZ m4b
      LDA D, 1
      BRA m4show
m4b:
      POP D              ; should be 0x1111
      PUSH B
      LDA B, 0x1111
      SUB D, B
      POP B
      BRZ m4pass
      LDA D, 1
      BRA m4show
m4pass:
      CLR D
m4show:
      PUSH D
      LDA A, str_m_stk
      PUSH A
      LDI D, 4
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 5: CALL and RET -----
      ; Call a subroutine that returns a known value in D
      LDA A, sub_return42
      CALL
      ; D should be 42
      PUSH B
      LDI B, 42
      SUB D, B
      POP B
      BRZ m5pass
      LDA D, 1
      BRA m5show
m5pass:
      CLR D
m5show:
      PUSH D
      LDA A, str_m_call
      PUSH A
      LDI D, 5
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 6: Nested CALL -----
      LDA A, sub_nested
      CALL
      ; D should be 100
      PUSH B
      LDI B, 100
      SUB D, B
      POP B
      BRZ m6pass
      LDA D, 1
      BRA m6show
m6pass:
      CLR D
m6show:
      PUSH D
      LDA A, str_m_nest
      PUSH A
      LDI D, 6
      LDA A, printResult
      CALL
      POP A
      POP D

      HALT

; --- Subroutines ---
sub_return42:
      LDI D, 42
      RET

sub_nested:
      ; Calls sub_return42, adds 58 to result
      PUSH A
      LDA A, sub_return42
      CALL
      ; D = 42
      PUSH B
      LDI B, 58
      ADD D, B
      POP B
      POP A
      RET                ; D = 100

; --- Reuse printResult from ALU test ---
printResult:
      PUSH D
      DEC D
      MOV A, D
      SHL A
      SHL A
      SHL A
      SHL A
      MOV B, A
      SHL A
      SHL A
      ADD A, B
      LDA B, 0xEC00
      ADD A, B
      MOV B, A
      POP D
      MOV A, D
      CLR D
pr_tens:
      PUSH B
      LDI B, 10
      CMP A, B
      POP B
      BRN pr_tens_done
      PUSH B
      LDI B, 10
      SUB A, B
      POP B
      INC D
      BRA pr_tens
pr_tens_done:
      PUSH A
      MOV A, D
      PUSH B
      LDI B, 48
      ADD A, B
      LDA B, 0x0F00
      OR A, B
      MOV D, A
      POP B
      MOV A, B
      STORE D, [A]
      INC B
      POP D
      PUSH B
      LDI B, 48
      ADD D, B
      LDA B, 0x0F00
      OR D, B
      POP B
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x0F2E
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x0F20
      MOV A, B
      STORE D, [A]
      INC B
      MOV A, SP

      LOAD A, [A+1]
pr_str:
      LOAD D, [A]
      OR D, D
      BRZ pr_str_done
      PUSH A
      PUSH B
      MOV A, D
      LDA B, 0x0F00
      OR A, B
      MOV D, A
      POP B
      MOV A, B
      STORE D, [A]
      INC B
      POP A
      INC A
      BRA pr_str
pr_str_done:
      MOV A, SP
      LOAD D, [A+2]
      OR D, D
      BRZ pr_pass
      LDA D, 0x4C46
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C41
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C49
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C4C
      MOV A, B
      STORE D, [A]
      RET
pr_pass:
      LDA D, 0x2A50
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A41
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A53
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A53
      MOV A, B
      STORE D, [A]
      RET

str_m_ldst:  .STRING "LOAD/STORE  "
str_m_off:   .STRING "Offset      "
str_m_push:  .STRING "PUSH/POP    "
str_m_stk:   .STRING "Stack order "
str_m_call:  .STRING "CALL/RET    "
str_m_nest:  .STRING "Nested CALL "
`;

// ──────────────────────────────────────────────────────────────
// Demo 3: Pixel Gradient — fills the 160x120 pixel framebuffer
// with a full-screen color gradient showing all 16 CGA palette
// colors in vertical stripes. Proves pixel mode and looping.
// ──────────────────────────────────────────────────────────────
var pixelProgram = `; Nexa-16 Pixel Gradient Demo
; Fills the entire 160x120 pixel framebuffer with vertical stripes
; showing all 16 CGA colors. Each word = 4 pixels (one nibble each).
; 160 pixels / 4 = 40 words per row. 120 rows = 4800 words total.

      LDA SP, 0xEBF0

      ; Set pixel mode
      LDA A, 0xFF30
      LDI D, 1
      STORE D, [A]

      ; Fill framebuffer: 40 words per row, 120 rows
      ; Each column group of 10 words = 40 pixels of one color pair
      ; Pattern: word = (col*4/10) nibble repeated = col_index * 0x1111
      ;
      ; Simpler approach: 16 color stripes, each 10 pixels wide = 160 px
      ; 10 pixels = 2.5 words. Use 2-word + alternating pattern.
      ;
      ; Simplest: fill each row with the 40-word pattern:
      ;   words 0-1: color 0 (0x0000, 0x0000) — actually 8 pixels
      ;   words 2-3: color 1 (0x1111, 0x1111)  ... up to
      ;   words 38-39: color F (0xFFFF)
      ;   But 16 colors * 2 words = 32, not 40. So use 2-3 words each.
      ;
      ; Even simpler: cycle 40 words, each word = 4 pixels of same color
      ;   word[i] = ((i*16/40) & 0xF) * 0x1111
      ;   Approximate: word[i] = (i / 2.5) -> i*2/5
      ;
      ; Simplest working approach: just fill repeating 0-F pattern,
      ; each color gets ~2-3 words.

      LDA B, 0xEC00       ; framebuffer start
      LDA A, 0xFE80       ; end = 0xEC00 + 4800 = 0xFF00 actually hits I/O
                           ; Framebuffer is 4800 words: 0xEC00..0xFEBF
      ; Actually 0xEC00 + 4800 = 0xEC00 + 0x12C0 = 0xFEC0

      ; Strategy: for each row (40 words), write a cycling color pattern.
      ; We'll make each stripe 2 words wide (8 pixels), cycling 0-F,
      ; wrapping after 16 = 32 words, then repeat for remaining 8 words.

      ; Outer loop: fill all 4800 words
      ; D = color word, cycles through: 0x0000, 0x1111, ..., 0xFFFF
      ; Each color gets 2 consecutive words (= 8 pixels)

      CLR D               ; start at color 0

fill_loop:
      ; Write current color word twice
      MOV A, B
      STORE D, [A]
      INC B
      MOV A, B
      STORE D, [A]
      INC B

      ; Advance to next color: add 0x1111
      PUSH A
      LDA A, 0x1111
      ADD D, A
      POP A

      ; Check if we reached end
      PUSH A
      LDA A, 0xFEC0
      CMP B, A
      POP A
      BRN fill_loop       ; B < end, continue

      HALT
`;

// ──────────────────────────────────────────────────────────────
// Demo 4: Branch & Loop Test — verifies all 7 branch conditions
// and loop constructs with visible results.
// ──────────────────────────────────────────────────────────────
var branchTestProgram = `; Nexa-16 Branch Verification Test
; Tests every branch condition with known flag states.
; Green PASS = branch taken correctly. Red FAIL = wrong behavior.

      LDA SP, 0xEBF0

      LDA A, 0xFF30
      CLR D
      STORE D, [A]

      LDA B, 0xEC00

      ; ----- Test 1: BRZ taken when zero -----
      CLR D
      OR D, D             ; Z=1, N=0
      BRZ br1pass
      LDA D, 1
      BRA br1show
br1pass:
      CLR D
br1show:
      PUSH D
      LDA A, str_brz
      PUSH A
      LDI D, 1
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 2: BRZ NOT taken when nonzero -----
      LDI D, 5
      OR D, D             ; Z=0, N=0
      BRZ br2fail
      CLR D               ; correct: didn't branch
      BRA br2show
br2fail:
      LDA D, 1
br2show:
      PUSH D
      LDA A, str_brz_nt
      PUSH A
      LDI D, 2
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 3: BRN taken when negative -----
      LDI D, -1
      OR D, D             ; N=1, Z=0
      BRN br3pass
      LDA D, 1
      BRA br3show
br3pass:
      CLR D
br3show:
      PUSH D
      LDA A, str_brn
      PUSH A
      LDI D, 3
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 4: BRP taken when positive -----
      LDI D, 1
      OR D, D             ; N=0, Z=0 => P
      BRP br4pass
      LDA D, 1
      BRA br4show
br4pass:
      CLR D
br4show:
      PUSH D
      LDA A, str_brp
      PUSH A
      LDI D, 4
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 5: BRNZ taken when N=1 -----
      LDI D, -5
      OR D, D             ; N=1
      BRNZ br5pass
      LDA D, 1
      BRA br5show
br5pass:
      CLR D
br5show:
      PUSH D
      LDA A, str_brnz
      PUSH A
      LDI D, 5
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 6: BRNZ taken when Z=1 -----
      CLR D
      OR D, D             ; Z=1
      BRNZ br6pass
      LDA D, 1
      BRA br6show
br6pass:
      CLR D
br6show:
      PUSH D
      LDA A, str_brnz2
      PUSH A
      LDI D, 6
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 7: BRZP taken when Z=1 -----
      CLR D
      OR D, D             ; Z=1
      BRZP br7pass
      LDA D, 1
      BRA br7show
br7pass:
      CLR D
br7show:
      PUSH D
      LDA A, str_brzp
      PUSH A
      LDI D, 7
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 8: BRZP taken when P -----
      LDI D, 99
      OR D, D
      BRZP br8pass
      LDA D, 1
      BRA br8show
br8pass:
      CLR D
br8show:
      PUSH D
      LDA A, str_brzp2
      PUSH A
      LDI D, 8
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 9: BRA always taken -----
      BRA br9pass
      LDA D, 1
      BRA br9show
br9pass:
      CLR D
br9show:
      PUSH D
      LDA A, str_bra
      PUSH A
      LDI D, 9
      LDA A, printResult
      CALL
      POP A
      POP D

      ; ----- Test 10: Counted loop -----
      ; Sum 1+2+3+...+10 = 55
      CLR D               ; accumulator
      LDI A, 1            ; counter
lp10:
      ADD D, A            ; D += A
      PUSH B
      LDI B, 10
      CMP A, B
      POP B
      BRZP lp10done
      INC A
      BRA lp10
lp10done:
      ; D should be 55
      PUSH B
      LDI B, 55
      SUB D, B
      POP B
      BRZ br10pass
      LDA D, 1
      BRA br10show
br10pass:
      CLR D
br10show:
      PUSH D
      LDA A, str_loop
      PUSH A
      LDI D, 10
      LDA A, printResult
      CALL
      POP A
      POP D

      HALT

; --- printResult (same pattern) ---
printResult:
      PUSH D
      DEC D
      MOV A, D
      SHL A
      SHL A
      SHL A
      SHL A
      MOV B, A
      SHL A
      SHL A
      ADD A, B
      LDA B, 0xEC00
      ADD A, B
      MOV B, A
      POP D
      MOV A, D
      CLR D
pr_tens:
      PUSH B
      LDI B, 10
      CMP A, B
      POP B
      BRN pr_tens_done
      PUSH B
      LDI B, 10
      SUB A, B
      POP B
      INC D
      BRA pr_tens
pr_tens_done:
      PUSH A
      MOV A, D
      PUSH B
      LDI B, 48
      ADD A, B
      LDA B, 0x0F00
      OR A, B
      MOV D, A
      POP B
      MOV A, B
      STORE D, [A]
      INC B
      POP D
      PUSH B
      LDI B, 48
      ADD D, B
      LDA B, 0x0F00
      OR D, B
      POP B
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x0F2E
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x0F20
      MOV A, B
      STORE D, [A]
      INC B
      MOV A, SP

      LOAD A, [A+1]
pr_str:
      LOAD D, [A]
      OR D, D
      BRZ pr_str_done
      PUSH A
      PUSH B
      MOV A, D
      LDA B, 0x0F00
      OR A, B
      MOV D, A
      POP B
      MOV A, B
      STORE D, [A]
      INC B
      POP A
      INC A
      BRA pr_str
pr_str_done:
      MOV A, SP
      LOAD D, [A+2]
      OR D, D
      BRZ pr_pass
      LDA D, 0x4C46
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C41
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C49
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x4C4C
      MOV A, B
      STORE D, [A]
      RET
pr_pass:
      LDA D, 0x2A50
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A41
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A53
      MOV A, B
      STORE D, [A]
      INC B
      LDA D, 0x2A53
      MOV A, B
      STORE D, [A]
      RET

str_brz:    .STRING "BRZ taken    "
str_brz_nt: .STRING "BRZ skipped  "
str_brn:    .STRING "BRN taken    "
str_brp:    .STRING "BRP taken    "
str_brnz:   .STRING "BRNZ neg     "
str_brnz2:  .STRING "BRNZ zero    "
str_brzp:   .STRING "BRZP zero    "
str_brzp2:  .STRING "BRZP pos     "
str_bra:    .STRING "BRA always   "
str_loop:   .STRING "Loop sum     "
`;

// ============================================================
// Nexa Demo Programs
// ============================================================

var nexaHelloDemo = `// Nexa Hello World
// Prints text to the screen using Output

fn main() {
  // Direct char test first
  Output.printChar(72);  // H
  Output.printChar(105); // i
  Output.printChar(33);  // !
  Output.printChar(32);  // space
  
  Output.printString("Hello, Nexa!");
  Output.println();
  Output.printString("Running on Nexa-16 CPU");
  Output.println();

  var i: int = 1;
  while (i <= 10) {
      Output.printInt(i);
      Output.printChar(32);
      i = i + 1;
  }

  Output.println();
  Output.printString("Done!");
  halt();
}
`;

var nexaMathDemo = `// Nexa Math Demo
// Demonstrates arithmetic, loops, and screen output

fn main() {
  Output.printString("Fibonacci:");
  Output.println();

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

  Output.println();
  Output.println();

  // Factorial of 7
  Output.printString("7! = ");
  var fact: int = 1;
  var n: int = 1;
  while (n <= 7) {
      fact = fact * n;
      n = n + 1;
  }
  Output.printInt(fact);
  Output.println();

  // Demonstrate if/else
  if (fact > 5000) {
      Output.printString("That is big!");
  } else {
      Output.printString("That is small.");
  }

  halt();
}
`;

var nexaPixelDemo = `// Nexa Pixel Art Demo
// Draws colored rectangles in pixel mode

fn main() {
  // Switch to pixel mode
  poke(0xFF30, 1);

  // Clear screen
  Screen.clearScreen();

  // Draw colored bars
  var color: int = 1;
  var y: int = 0;
  while (y < 120) {
      Screen.setColor(color);
      Screen.drawRectangle(0, y, 159, y + 5);
      color = color + 1;
      if (color > 15) {
          color = 1;
      }
      y = y + 6;
  }

  // Draw a centered white box
  Screen.setColor(15);
  Screen.drawRectangle(42, 30, 118, 90);

  // Draw inner black box
  Screen.setColor(0);
  Screen.drawRectangle(49, 36, 111, 84);

  // Draw colored squares inside
  Screen.setColor(9);
  Screen.drawRectangle(55, 48, 68, 73);
  Screen.setColor(10);
  Screen.drawRectangle(71, 48, 84, 73);
  Screen.setColor(12);
  Screen.drawRectangle(88, 48, 100, 73);

  halt();
}
`;

var nexaClassDemo = `// Nexa Class Demo
// Demonstrates classes, methods, constructors

class Counter {
  field count: int;
  field step: int;

  new(initialStep: int) {
      this.count = 0;
      this.step = initialStep;
  }

  method increment() {
      this.count = this.count + this.step;
  }

  method getValue() -> int {
      return this.count;
  }

  method printValue() {
      Output.printString("Count: ");
      Output.printInt(this.count);
      Output.println();
  }
}

fn main() {
  Output.printString("=== Class Demo ===");
  Output.println();

  var c: Counter = Counter.new(3);
  var i: int = 0;

  while (i < 8) {
      c.printValue();
      c.increment();
      i = i + 1;
  }

  Output.println();
  Output.printString("Final: ");
  Output.printInt(c.getValue());
  Output.println();

  // Demonstrate a second counter
  var c2: Counter = Counter.new(7);
  i = 0;
  while (i < 5) {
      c2.increment();
      i = i + 1;
  }
  Output.printString("Counter2: ");
  Output.printInt(c2.getValue());

  halt();
}
`;

// ============================================================
// Demoscene Megademo
// ============================================================

var nexaDemoSceneDemo = `// Nexa Machine Tour Demoscene
// 7 scenes alternating text and pixel modes to exercise the whole machine.

class Demo {
    static FB: int;
    static SEED: int;
    static SINTAB: Array;

    fn setVoice(channel: int, period: int, volume: int, wave: int) {
        var base: int = 0xFF40 + (channel * 2);
        if ((period < 1) | (volume < 1)) {
            poke(base + 1, 0);
            return;
        }
        poke(base, period);
        poke(base + 1, (wave << 8) | (volume << 4) | 8);
    }

    fn stopMusic() {
        poke(0xFF41, 0);
        poke(0xFF43, 0);
    }

    fn scoreLead(scene: int, step: int) -> int {
        var s: int = step & 7;
        if (scene == 0) {
            if (s == 0) { return 3034; }
            if (s == 1) { return 2551; }
            if (s == 2) { return 2273; }
            if (s == 3) { return 1911; }
            if (s == 4) { return 2273; }
            if (s == 5) { return 2551; }
            if (s == 6) { return 3034; }
            return 3822;
        }
        if (scene == 1) {
            if (s == 0) { return 1517; }
            if (s == 1) { return 1276; }
            if (s == 2) { return 1136; }
            if (s == 3) { return 956; }
            if (s == 4) { return 1136; }
            if (s == 5) { return 1276; }
            if (s == 6) { return 1517; }
            return 1703;
        }
        if (scene == 2) {
            if (s == 0) { return 2273; }
            if (s == 1) { return 2551; }
            if (s == 2) { return 3034; }
            if (s == 3) { return 2551; }
            if (s == 4) { return 2273; }
            if (s == 5) { return 1911; }
            if (s == 6) { return 2273; }
            return 2551;
        }
        if (scene == 3) {
            if (s == 0) { return 1703; }
            if (s == 1) { return 1517; }
            if (s == 2) { return 1276; }
            if (s == 3) { return 1517; }
            if (s == 4) { return 1703; }
            if (s == 5) { return 1911; }
            if (s == 6) { return 1703; }
            return 1517;
        }
        if (scene == 4) {
            if (s == 0) { return 3034; }
            if (s == 1) { return 2863; }
            if (s == 2) { return 2551; }
            if (s == 3) { return 2273; }
            if (s == 4) { return 2551; }
            if (s == 5) { return 2863; }
            if (s == 6) { return 3034; }
            return 3405;
        }
        if (scene == 5) {
            if (s == 0) { return 1911; }
            if (s == 1) { return 1703; }
            if (s == 2) { return 1517; }
            if (s == 3) { return 1432; }
            if (s == 4) { return 1517; }
            if (s == 5) { return 1703; }
            if (s == 6) { return 1911; }
            return 2273;
        }
        if (s == 0) { return 1517; }
        if (s == 1) { return 1276; }
        if (s == 2) { return 1136; }
        if (s == 3) { return 956; }
        if (s == 4) { return 1136; }
        if (s == 5) { return 1276; }
        if (s == 6) { return 1517; }
        return 1911;
    }

    fn scoreBass(scene: int, step: int) -> int {
        var s: int = step & 3;
        if (scene == 0) {
            if ((s == 0) | (s == 1)) { return 6068; }
            if (s == 2) { return 5102; }
            return 4545;
        }
        if (scene == 1) {
            if ((s == 0) | (s == 1)) { return 4545; }
            if (s == 2) { return 3822; }
            return 3405;
        }
        if (scene == 2) {
            if ((s == 0) | (s == 1)) { return 5102; }
            if (s == 2) { return 4545; }
            return 3822;
        }
        if (scene == 3) {
            if ((s == 0) | (s == 1)) { return 3822; }
            if (s == 2) { return 3405; }
            return 3034;
        }
        if (scene == 4) {
            if ((s == 0) | (s == 1)) { return 7644; }
            if (s == 2) { return 6068; }
            return 5102;
        }
        if (scene == 5) {
            if ((s == 0) | (s == 1)) { return 6803; }
            if (s == 2) { return 5102; }
            return 4545;
        }
        if ((s == 0) | (s == 1)) { return 4545; }
        if (s == 2) { return 3822; }
        return 3034;
    }

    fn musicStep(scene: int, step: int) {
        var lead: int = Demo.scoreLead(scene, step);
        var bass: int = Demo.scoreBass(scene, step);
        var wave0: int = scene & 1;
        var wave1: int = 1 + (scene & 1);
        Demo.setVoice(0, lead, 11, wave0);
        if ((step & 1) == 0) {
            Demo.setVoice(1, bass, 8, wave1);
        } else {
            Demo.setVoice(1, bass, 6, wave1);
        }
    }

    fn musicTick(scene: int, frame: int) {
        if ((frame & 7) != 0) { return; }
        Demo.musicStep(scene, frame / 8);
    }

    fn sting(lead: int, bass: int, frames: int) {
        var t: int = 0;
        while (t < frames) {
            if (t < (frames - 4)) {
                Demo.setVoice(0, lead, 12, 2);
                Demo.setVoice(1, bass, 8, 1);
            } else {
                Demo.setVoice(0, lead, 6, 2);
                Demo.setVoice(1, bass, 4, 1);
            }
            t = t + 1;
        }
    }

    fn holdScene(scene: int, ticks: int) {
        var t: int = 0;
        while (t < ticks) {
            Demo.musicStep(scene, t);
            Time.sleep(120);
            t = t + 1;
        }
    }

    fn sceneTick(scene: int, step: int) {
        Demo.musicStep(scene, step);
        Time.sleep(60);
    }

    fn rng() -> int {
        SEED = SEED ^ (SEED << 7);
        SEED = SEED & 32767;
        SEED = SEED ^ (SEED >> 5);
        SEED = SEED & 32767;
        SEED = SEED ^ (SEED << 3);
        SEED = SEED & 32767;
        if (SEED == 0) { SEED = 1; }
        return SEED;
    }

    fn buildSinTable() {
        SINTAB = Array.new(64);
        SINTAB[0]  =  0; SINTAB[1]  =  2; SINTAB[2]  =  3; SINTAB[3]  =  5;
        SINTAB[4]  =  6; SINTAB[5]  =  7; SINTAB[6]  =  9; SINTAB[7]  = 10;
        SINTAB[8]  = 11; SINTAB[9]  = 12; SINTAB[10] = 13; SINTAB[11] = 14;
        SINTAB[12] = 15; SINTAB[13] = 15; SINTAB[14] = 16; SINTAB[15] = 16;
        SINTAB[16] = 16; SINTAB[17] = 16; SINTAB[18] = 16; SINTAB[19] = 15;
        SINTAB[20] = 15; SINTAB[21] = 14; SINTAB[22] = 13; SINTAB[23] = 12;
        SINTAB[24] = 11; SINTAB[25] = 10; SINTAB[26] =  9; SINTAB[27] =  7;
        SINTAB[28] =  6; SINTAB[29] =  5; SINTAB[30] =  3; SINTAB[31] =  2;
        SINTAB[32] =  0; SINTAB[33] = -2; SINTAB[34] = -3; SINTAB[35] = -5;
        SINTAB[36] = -6; SINTAB[37] = -7; SINTAB[38] = -9; SINTAB[39] =-10;
        SINTAB[40] =-11; SINTAB[41] =-12; SINTAB[42] =-13; SINTAB[43] =-14;
        SINTAB[44] =-15; SINTAB[45] =-15; SINTAB[46] =-16; SINTAB[47] =-16;
        SINTAB[48] =-16; SINTAB[49] =-16; SINTAB[50] =-16; SINTAB[51] =-15;
        SINTAB[52] =-15; SINTAB[53] =-14; SINTAB[54] =-13; SINTAB[55] =-12;
        SINTAB[56] =-11; SINTAB[57] =-10; SINTAB[58] = -9; SINTAB[59] = -7;
        SINTAB[60] = -6; SINTAB[61] = -5; SINTAB[62] = -3; SINTAB[63] = -2;
    }

    fn sin(idx: int) -> int {
        return SINTAB[idx & 63];
    }

    fn init() {
        FB = 0xEC00;
        SEED = 24681;
        Demo.buildSinTable();
        Demo.stopMusic();
    }

    fn clearPixel() {
        var i: int = 0;
        while (i < 4800) {
            poke(FB + i, 0);
            i = i + 1;
        }
    }

    fn clearText() {
        var i: int = 0;
        while (i < 2400) {
            poke(FB + i, 0);
            i = i + 1;
        }
    }

    fn putCell(x: int, y: int, color: int, ch: int) {
        if ((x < 0) | (x > 79) | (y < 0) | (y > 29)) { return; }
        poke(FB + y * 80 + x, (color << 8) | ch);
    }

    fn printAt(x: int, y: int, color: int, text: String) {
        var i: int = 0;
        var len: int = text.length();
        while (i < len) {
            Demo.putCell(x + i, y, color, text.charAt(i));
            i = i + 1;
        }
    }

    fn drawFrame(title: String, subtitle: String, accent: int) {
        var i: int = 0;
        while (i < 80) {
            Demo.putCell(i, 0, accent, 205);
            Demo.putCell(i, 29, accent, 205);
            i = i + 1;
        }
        i = 1;
        while (i < 29) {
            Demo.putCell(0, i, accent, 186);
            Demo.putCell(79, i, accent, 186);
            i = i + 1;
        }
        Demo.putCell(0, 0, accent, 201);
        Demo.putCell(79, 0, accent, 187);
        Demo.putCell(0, 29, accent, 200);
        Demo.putCell(79, 29, accent, 188);
        Demo.printAt(3, 2, 15, title);
        Demo.printAt(3, 4, accent, subtitle);
    }

    fn putPixel(x: int, y: int, color: int) {
        if ((x < 0) | (x > 159) | (y < 0) | (y > 119)) { return; }
        var addr: int = FB + (y * 40) + (x / 4);
        var nib: int = 3 - (x & 3);
        var shift: int = nib * 4;
        var mask: int = 15 << shift;
        var old: int = peek(addr);
        poke(addr, (old & (~mask)) | (color << shift));
    }

    fn sceneBoot() {
        poke(0xFF30, 0);
        Demo.clearText();
        Demo.drawFrame("NEXA-16 MACHINE TOUR", "SCENE 1/7  TEXT BUS + STATUS PANEL", 11);
        Demo.printAt(3, 7, 7, "CPU  : 16-BIT CORE / ALU / BRANCH / STACK / CALL");
        Demo.printAt(3, 9, 7, "VRAM : TEXT 80X30  AND  PIXEL 160X120");
        Demo.printAt(3, 11, 7, "HEAP : ARRAYS, STRINGS AND OBJECT CALLS");
        Demo.printAt(3, 13, 7, "PIPE : NEXA -> VM -> ASM -> MACHINE CODE");
        Demo.printAt(3, 16, 14, "RUNNING POWER-ON SELF TEST...");
        Demo.printAt(3, 25, 8, "SCENES WILL SWITCH MODES TO PROVE THE WHOLE PIPELINE.");

        var t: int = 0;
        while (t < 18) {
            var i: int = 0;
            while (i < 60) {
                var fill: int = (t * 60) / 72;
                var color: int = 8;
                var ch: int = 176;
                if (i < fill) {
                    color = 9 + ((i + t) & 5);
                    ch = 219;
                }
                Demo.putCell(10 + i, 20, color, ch);
                i = i + 1;
            }
            Demo.putCell(10 + ((t / 3) % 60), 22 + (Demo.sin(t * 2) / 12), 14, 42);
            Demo.sceneTick(0, t);
            t = t + 1;
        }
        Demo.holdScene(0, 5);
        Demo.sting(1911, 3822, 4);
    }

    fn sceneRaster() {
        poke(0xFF30, 1);
        var t: int = 0;
        while (t < 12) {
            var y: int = 0;
            var off: int = 0;
            while (y < 120) {
                var baseColor: int = ((y / 6) + t) & 15;
                if (baseColor == 0) { baseColor = 1; }
                var wave: int = 20 + ((Demo.sin(y + t * 3) + 16) / 2);
                var x4: int = 0;
                while (x4 < 40) {
                    var c0: int = baseColor;
                    var c1: int = baseColor;
                    var c2: int = baseColor;
                    var c3: int = baseColor;
                    if ((x4 > (wave - 2)) & (x4 < (wave + 2))) {
                        c0 = 15; c1 = 14; c2 = 13; c3 = 12;
                    }
                    poke(FB + off + x4, (c0 << 12) | (c1 << 8) | (c2 << 4) | c3);
                    x4 = x4 + 1;
                }
                y = y + 1;
                off = off + 40;
            }
            Demo.sceneTick(1, t);
            t = t + 1;
        }
        Demo.holdScene(1, 3);
        Demo.sting(1517, 3405, 4);
    }

    fn sceneScopeText() {
        poke(0xFF30, 0);
        Demo.clearText();
        Demo.drawFrame("SIGNAL SCOPE", "SCENE 3/7  STRINGS + LOOPS + SINE TABLE", 10);
        Demo.printAt(3, 7, 7, "ANIMATED WAVEFORM ACROSS THE TEXT FRAMEBUFFER");
        Demo.printAt(3, 9, 7, "THIS SCENE STRESSES INDEXING, MODULO AND CHAR OUTPUT");
        Demo.printAt(3, 24, 8, "MESSAGE BUS:");

        var msg: String = "   NEXA-16 MACHINE TOUR  |  TEXT MODE  |  PIXEL MODE  |  ARRAYS  |  HEAP  |  CALLS  |  BRANCHES  |  ";
        var mlen: int = msg.length();
        var scroll: int = 0;
        var t: int = 0;
        while (t < 36) {
            var row: int = 11;
            while (row < 22) {
                var col: int = 2;
                while (col < 78) {
                    Demo.putCell(col, row, 0, 32);
                    col = col + 1;
                }
                row = row + 1;
            }

            var x: int = 0;
            while (x < 76) {
                var wave: int = 16 + (Demo.sin((x * 2) + (t * 3)) / 3);
                var ci: int = (scroll + x) % mlen;
                var ch: int = msg.charAt(ci);
                if ((wave > 10) & (wave < 22)) {
                    Demo.putCell(2 + x, wave, ((x + t) & 14) + 1, ch);
                }
                x = x + 1;
            }

            x = 0;
            while (x < 70) {
                var fill: int = ((t * 70) / 180);
                var c: int = 8;
                var box: int = 176;
                if (x < fill) {
                    c = 10 + ((x + t) & 3);
                    box = 219;
                }
                Demo.putCell(6 + x, 26, c, box);
                x = x + 1;
            }

            scroll = scroll + 1;
            if (scroll >= mlen) { scroll = 0; }
            Demo.sceneTick(2, t);
            t = t + 1;
        }
        Demo.holdScene(2, 4);
        Demo.sting(2273, 4545, 4);
    }

    fn sceneStarfield() {
        poke(0xFF30, 1);
        Demo.clearPixel();
        SEED = 404;

        var n: int = 40;
        var sx: Array = Array.new(n);
        var sy: Array = Array.new(n);
        var sz: Array = Array.new(n);
        var i: int = 0;
        while (i < n) {
            sx[i] = (Demo.rng() & 127) - 64;
            sy[i] = (Demo.rng() & 63) - 32;
            sz[i] = (Demo.rng() % 10) + 2;
            i = i + 1;
        }

        var t: int = 0;
        while (t < 72) {
            Demo.clearPixel();
            i = 0;
            while (i < n) {
                var px: int = (sx[i] * 10) / sz[i] + 80;
                var py: int = (sy[i] * 10) / sz[i] + 60;
                var col: int = 15;
                if (sz[i] > 6) { col = 7; }
                if (sz[i] > 8) { col = 8; }
                Demo.putPixel(px, py, col);
                if (sz[i] < 3) {
                    Demo.putPixel(px + 1, py, col);
                    Demo.putPixel(px, py + 1, col);
                }
                sz[i] = sz[i] - 1;
                if (sz[i] < 1) {
                    sx[i] = (Demo.rng() & 127) - 64;
                    sy[i] = (Demo.rng() & 63) - 32;
                    sz[i] = (Demo.rng() % 10) + 7;
                }
                i = i + 1;
            }
            Demo.sceneTick(3, t);
            t = t + 1;
        }
        sx.dispose();
        sy.dispose();
        sz.dispose();
        Demo.holdScene(3, 4);
        Demo.sting(1703, 3034, 4);
    }

    fn sceneMemoryGrid() {
        poke(0xFF30, 0);
        Demo.clearText();
        Demo.drawFrame("HEAP + MEMORY GRID", "SCENE 5/7  ARRAYS / RNG / CHECKSUM", 13);
        Demo.printAt(3, 7, 7, "64 CELLS OF HEAP DATA ARE MUTATED AND REDRAWN LIVE");
        Demo.printAt(3, 9, 7, "BLOCK BRIGHTNESS TRACKS EACH WORD VALUE");

        var mem: Array = Array.new(64);
        var i: int = 0;
        while (i < 64) {
            mem[i] = Demo.rng() & 255;
            i = i + 1;
        }

        var t: int = 0;
        while (t < 48) {
            if ((t & 3) == 0) {
                i = 0;
                while (i < 64) {
                    mem[i] = (mem[i] + (Demo.rng() & 31)) & 255;
                    i = i + 1;
                }
            }

            var y: int = 0;
            while (y < 8) {
                var x: int = 0;
                while (x < 8) {
                    var v: int = mem[y * 8 + x];
                    var col: int = 8 + ((v >> 5) & 7);
                    var ch: int = 176;
                    if (v > 63) { ch = 177; }
                    if (v > 127) { ch = 178; }
                    if (v > 191) { ch = 219; }
                    Demo.putCell(14 + x * 6, 12 + y * 2, col, ch);
                    Demo.putCell(15 + x * 6, 12 + y * 2, col, ch);
                    Demo.putCell(16 + x * 6, 12 + y * 2, col, ch);
                    Demo.putCell(17 + x * 6, 12 + y * 2, col, ch);
                    x = x + 1;
                }
                y = y + 1;
            }

            var checksum: int = 0;
            i = 0;
            while (i < 64) {
                checksum = (checksum + mem[i]) & 32767;
                i = i + 1;
            }
            i = 0;
            while (i < 60) {
                var c: int = 8;
                var fill: int = checksum % 60;
                var box: int = 176;
                if (i < fill) {
                    c = 11 + ((i + t) & 3);
                    box = 219;
                }
                Demo.putCell(10 + i, 27, c, box);
                i = i + 1;
            }
            Demo.sceneTick(4, t);
            t = t + 1;
        }
        mem.dispose();
        Demo.holdScene(4, 4);
        Demo.sting(2551, 5102, 4);
    }

    fn sceneFire() {
        poke(0xFF30, 1);
        Demo.clearPixel();
        SEED = 9001;

        var t: int = 0;
        while (t < 6) {
            var base: int = FB + (119 * 40);
            var x4: int = 0;
            while (x4 < 40) {
                var r: int = Demo.rng();
                var f0: int = (r & 3) + 4;
                var f1: int = ((r >> 2) & 3) + 5;
                var f2: int = ((r >> 4) & 3) + 7;
                var f3: int = ((r >> 6) & 3) + 8;
                if ((Demo.rng() & 7) == 0) { f0 = 15; }
                if ((Demo.rng() & 7) == 0) { f3 = 14; }
                poke(base + x4, (f0 << 12) | (f1 << 8) | (f2 << 4) | f3);
                x4 = x4 + 1;
            }

            base = FB + (118 * 40);
            x4 = 0;
            while (x4 < 40) {
                var r2: int = Demo.rng();
                poke(base + x4, ((((r2 >> 0) & 3) + 4) << 12) | ((((r2 >> 2) & 3) + 5) << 8) | ((((r2 >> 4) & 3) + 6) << 4) | (((r2 >> 6) & 3) + 7));
                x4 = x4 + 1;
            }

            var y: int = 0;
            var dst: int = 0;
            while (y < 118) {
                var src1: int = dst + 40;
                var src2: int = dst + 80;
                x4 = 0;
                while (x4 < 40) {
                    var below: int = peek(FB + src1 + x4);
                    var below2: int = peek(FB + src2 + x4);
                    var p0: int = ((below >> 12) & 15 + (below2 >> 12) & 15) / 2;
                    var p1: int = ((below >> 8) & 15 + (below2 >> 8) & 15) / 2;
                    var p2: int = ((below >> 4) & 15 + (below2 >> 4) & 15) / 2;
                    var p3: int = ((below & 15) + (below2 & 15)) / 2;
                    if (p0 > 0) { p0 = p0 - 1; }
                    if (p1 > 0) { p1 = p1 - 1; }
                    if (p2 > 0) { p2 = p2 - 1; }
                    if (p3 > 0) { p3 = p3 - 1; }
                    poke(FB + dst + x4, (p0 << 12) | (p1 << 8) | (p2 << 4) | p3);
                    x4 = x4 + 1;
                }
                y = y + 1;
                dst = dst + 40;
            }
            Demo.sceneTick(5, t);
            t = t + 1;
        }
        Demo.holdScene(5, 2);
        Demo.sting(1911, 4545, 4);
    }

    fn sceneFinale() {
        poke(0xFF30, 0);
        Demo.clearText();
        Demo.drawFrame("FINAL STATUS", "SCENE 7/7  WHOLE SYSTEM TOUR COMPLETE", 14);
        Demo.printAt(3, 7, 15, "TEXT MODE ............. OK");
        Demo.printAt(3, 9, 15, "PIXEL MODE ............ OK");
        Demo.printAt(3, 11, 15, "HEAP / ARRAYS ......... OK");
        Demo.printAt(3, 13, 15, "ALU / BRANCH / LOOPS .. OK");
        Demo.printAt(3, 15, 15, "CALLS / METHODS ....... OK");
        Demo.printAt(3, 18, 11, "THANKS FOR WATCHING THE NEXA-16 MACHINE FLEX.");
        Demo.printAt(3, 20, 10, "SEVEN SCENES. TWO DISPLAY MODES. ONE SMALL MACHINE.");

        var t: int = 0;
        while (t < 24) {
            var i: int = 0;
            while (i < 76) {
                var col: int = ((i + t) & 7) + 8;
                Demo.putCell(2 + i, 24, col, 219);
                Demo.putCell(2 + i, 25, col, 178);
                Demo.putCell(2 + i, 26, col, 176);
                i = i + 1;
            }
            Demo.sceneTick(6, t);
            t = t + 1;
        }
        Demo.holdScene(6, 10);
        Demo.stopMusic();
    }
}

fn main() {
    Demo.init();
    Demo.sceneBoot();
    Demo.sceneRaster();
    Demo.sceneScopeText();
    Demo.sceneStarfield();
    Demo.sceneMemoryGrid();
    Demo.sceneFire();
    Demo.sceneFinale();
    halt();
}
`;

// ============================================================
// NexaOS - DOS-inspired OS simulation (compact)
// ============================================================

var nexaOsDemo = `// NexaOS - A DOS-inspired OS simulation

class OS {
    static FB: int;
    static row: int;
    static col: int;
    static clr: int;
    static buf: Array;
    static blen: int;
    static on: int;
    static ticks: int;
    static seed: int;

    // ---- Core text output ----

    fn pc(ch: int) {
        if (ch == 10) {
            col = 0;
            row = row + 1;
            if (row > 29) { OS.scroll(); row = 29; }
            return;
        }
        if (ch == 8) {
            if (col > 0) { col = col - 1; poke(FB + row * 80 + col, 0); }
            return;
        }
        poke(FB + row * 80 + col, (clr << 8) | ch);
        col = col + 1;
        if (col > 79) {
            col = 0; row = row + 1;
            if (row > 29) { OS.scroll(); row = 29; }
        }
    }

    fn scroll() {
        var i: int = 0;
        while (i < 2320) {
            poke(FB + i, peek(FB + 80 + i));
            i = i + 1;
        }
        i = 0;
        while (i < 80) { poke(FB + 2320 + i, 0); i = i + 1; }
    }

    fn ps(s: String) {
        var i: int = 0;
        while (i < s.length()) { OS.pc(s.charAt(i)); i = i + 1; }
    }

    fn ln() { OS.pc(10); }

    fn pn(n: int) {
        if (n < 0) { OS.pc(45); n = 0 - n; }
        if (n > 9999) { OS.pc(((n / 10000) % 10) + 48); }
        if (n > 999) { OS.pc(((n / 1000) % 10) + 48); }
        if (n > 99) { OS.pc(((n / 100) % 10) + 48); }
        if (n > 9) { OS.pc(((n / 10) % 10) + 48); }
        OS.pc((n % 10) + 48);
    }

    fn cls() {
        var i: int = 0;
        while (i < 2400) { poke(FB + i, 0); i = i + 1; }
        row = 0; col = 0;
    }

    // ---- Keyboard ----

    fn rk() -> int {
        while (peek(65280) == 0) { }
        return peek(65281);
    }

    fn readLine() {
        blen = 0;
        while (true) {
            var ch: int = OS.rk();
            if (ch == 10) { OS.ln(); return; }
            if (ch == 8) {
                if (blen > 0) { blen = blen - 1; OS.pc(8); }
            } else {
                if (blen < 60) {
                    buf[blen] = ch;
                    blen = blen + 1;
                    OS.pc(ch);
                }
            }
        }
    }

    // ---- String matching ----

    fn up(c: int) -> int {
        if ((c > 96) & (c < 123)) { return c - 32; }
        return c;
    }

    fn eq(s: String) -> bool {
        if (blen != s.length()) { return false; }
        var i: int = 0;
        while (i < blen) {
            if (OS.up(buf[i]) != OS.up(s.charAt(i))) { return false; }
            i = i + 1;
        }
        return true;
    }

    fn sw(s: String) -> bool {
        var sl: int = s.length();
        var i: int = 0;
        if (blen < sl) { return false; }
        while (i < sl) {
            if (OS.up(buf[i]) != OS.up(s.charAt(i))) { return false; }
            i = i + 1;
        }
        return true;
    }

    fn argeq(off: int, s: String) -> bool {
        var sl: int = s.length();
        var i: int = 0;
        if ((blen - off) != sl) { return false; }
        while (i < sl) {
            if (OS.up(buf[off + i]) != OS.up(s.charAt(i))) { return false; }
            i = i + 1;
        }
        return true;
    }

    fn pargs(off: int) {
        var i: int = off;
        while (i < blen) { OS.pc(buf[i]); i = i + 1; }
    }

    // ---- Random ----

    fn rng() -> int {
        seed = seed ^ (seed << 7);
        seed = seed & 32767;
        seed = seed ^ (seed >> 5);
        seed = seed & 32767;
        seed = seed ^ (seed << 3);
        seed = seed & 32767;
        if (seed == 0) { seed = 1; }
        return seed;
    }

    // ---- Boot ----

    fn boot() {
        FB = 0xEC00;
        poke(0xFF30, 0);
        clr = 7; seed = 31337; ticks = 0;
        buf = Array.new(64); blen = 0; on = 1;
        OS.cls();
        clr = 15;
        OS.ps("NexaOS v1.0 [Nexa-16 CPU]"); OS.ln();
        clr = 8;
        OS.ps("64K RAM. Type HELP for commands."); OS.ln();
        clr = 7;
        OS.ln();
    }

    // ---- Commands ----

    fn cHelp() {
        clr = 15; OS.ps("Commands:"); OS.ln(); clr = 7;
        OS.ps(" HELP CLS VER DIR ECHO"); OS.ln();
        OS.ps(" MEM TIME COLOR EXIT"); OS.ln();
        OS.ps(" TYPE <file>  RUN <prog>"); OS.ln();
    }

    fn cVer() {
        clr = 15;
        OS.ps("NexaOS 1.0 - Nexa-16"); OS.ln();
        clr = 7;
    }

    fn cDir() {
        clr = 15; OS.ps(" C:\\NEXAOS"); OS.ln(); clr = 7;
        OS.ps(" README  TXT  512"); OS.ln();
        OS.ps(" HELLO   EXE  128"); OS.ln();
        OS.ps(" MATRIX  EXE  256"); OS.ln();
        OS.ps(" CONFIG  SYS   64"); OS.ln();
        clr = 8;
        OS.ps("  4 file(s) 63488 free"); OS.ln();
        clr = 7;
    }

    fn cType() {
        if (blen < 6) { OS.ps("Usage: TYPE <file>"); OS.ln(); return; }
        if (OS.argeq(5, "README.TXT")) {
            OS.ps("Welcome to NexaOS!"); OS.ln();
            OS.ps("Runs on Nexa-16 CPU."); OS.ln();
            OS.ps("Try: RUN HELLO, RUN MATRIX"); OS.ln();
        } else {
            if (OS.argeq(5, "CONFIG.SYS")) {
                clr = 8;
                OS.ps("cpu=nexa"); OS.ln();
                OS.ps("mem=65536"); OS.ln();
                clr = 7;
            } else {
                OS.ps("File not found: ");
                OS.pargs(5); OS.ln();
            }
        }
    }

    fn cMem() {
        OS.ps("Total: 65536 words"); OS.ln();
        OS.ps("Free:  ~59000 words"); OS.ln();
    }

    fn cTime() {
        OS.ps("Uptime: "); OS.pn(ticks); OS.ps(" cmds"); OS.ln();
    }

    fn cColor() {
        if (blen < 7) {
            OS.ps("COLOR <0-15>  Now: "); OS.pn(clr); OS.ln();
            return;
        }
        var c: int = buf[6] - 48;
        if ((blen > 7) & (c == 1)) { c = 10 + (buf[7] - 48); }
        if ((c < 0) | (c > 15)) { OS.ps("Bad color"); OS.ln(); return; }
        clr = c;
    }

    fn cEcho() {
        if (blen < 6) { OS.ln(); return; }
        OS.pargs(5); OS.ln();
    }

    fn cRun() {
        if (blen < 5) { OS.ps("Usage: RUN <prog>"); OS.ln(); return; }
        if (OS.argeq(4, "HELLO")) { OS.runHello(); }
        else {
            if (OS.argeq(4, "MATRIX")) { OS.runMatrix(); }
            else { OS.ps("Not found: "); OS.pargs(4); OS.ln(); }
        }
    }

    // ---- Programs ----

    fn runHello() {
        clr = 14;
        OS.ps("** Hello from NexaOS! **"); OS.ln();
        clr = 7;
    }

    fn runMatrix() {
        OS.cls();
        seed = 42;
        var heads: Array = Array.new(80);
        var len: Array = Array.new(80);
        var i: int = 0;
        while (i < 80) {
            heads[i] = 0 - (OS.rng() % 30);
            len[i] = (OS.rng() % 6) + 3;
            i = i + 1;
        }
        var t: int = 0;
        while (t < 120) {
            i = 0;
            while (i < 80) {
                var h: int = heads[i];
                if ((h > -1) & (h < 30)) {
                    var ch: int = (OS.rng() % 75) + 48;
                    poke(FB + h * 80 + i, (10 << 8) | ch);
                }
                if (((h - 1) > -1) & ((h - 1) < 30)) {
                    var old: int = peek(FB + (h - 1) * 80 + i);
                    poke(FB + (h - 1) * 80 + i, (2 << 8) | (old & 255));
                }
                var tail: int = h - len[i];
                if ((tail > -1) & (tail < 30)) {
                    poke(FB + tail * 80 + i, 0);
                }
                heads[i] = h + 1;
                if (tail > 30) {
                    heads[i] = 0 - (OS.rng() % 15);
                    len[i] = (OS.rng() % 6) + 3;
                }
                i = i + 1;
            }
            t = t + 1;
        }
        heads.dispose();
        len.dispose();
        OS.cls();
        clr = 7;
        OS.ps("Matrix done."); OS.ln();
    }

    // ---- Main loop ----

    fn prompt() {
        clr = 10;
        OS.ps("C:\\>");
        clr = 7;
    }

    fn dispatch() {
        if (blen == 0) { return; }
        if (OS.eq("HELP")) { OS.cHelp(); }
        else { if (OS.eq("VER")) { OS.cVer(); }
        else { if (OS.eq("CLS")) { OS.cls(); }
        else { if (OS.eq("DIR")) { OS.cDir(); }
        else { if (OS.eq("MEM")) { OS.cMem(); }
        else { if (OS.eq("TIME")) { OS.cTime(); }
        else { if (OS.eq("EXIT")) {
            clr = 15; OS.ps("Shutting down..."); OS.ln();
            on = 0;
        }
        else { if (OS.sw("ECHO ")) { OS.cEcho(); }
        else { if (OS.sw("TYPE ")) { OS.cType(); }
        else { if (OS.sw("COLOR ")) { OS.cColor(); }
        else { if (OS.sw("RUN ")) { OS.cRun(); }
        else {
            OS.ps("Bad command: ");
            OS.pargs(0); OS.ln();
        }}}}}}}}}}}
    }

    fn run() {
        OS.boot();
        while (on == 1) {
            OS.prompt();
            OS.readLine();
            OS.dispatch();
            ticks = ticks + 1;
        }
    }
}

fn main() {
    OS.run();
    halt();
}
`;

