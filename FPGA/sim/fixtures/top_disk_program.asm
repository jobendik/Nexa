; Top-level disk integration program.
; Reads sector 3 into RAM[0x0200], edits the first two words,
; writes the buffer back to sector 4, stores SYSCTRL pending to RAM[0x0210], then halts.

    LDI SP, 0
    LDU SP, 56

    LDI A, 0x350
    LDU A, 0x3F

    LDI D, 3
    STORE D, [A+1]
    LDI D, 0x200
    LDU D, 0
    STORE D, [A+2]
    LDI D, 1
    STORE D, [A]

wait_read:
    LOAD D, [A+3]
    LDI B, 1
    AND D, B
    BRNP wait_read

    LDI A, 0x200
    LDU A, 0
    LDI D, 0x042
    STORE D, [A]
    LDI D, 0x077
    STORE D, [A+1]

    LDI A, 0x350
    LDU A, 0x3F
    LDI D, 4
    STORE D, [A+1]
    LDI D, 0x200
    LDU D, 0
    STORE D, [A+2]
    LDI D, 2
    STORE D, [A]

wait_write:
    LOAD D, [A+3]
    LDI B, 1
    AND D, B
    BRNP wait_write

    LDI A, 0x3F0
    LDU A, 0x3F
    LOAD D, [A]
    LDI A, 0x210
    LDU A, 0
    STORE D, [A]

    HALT