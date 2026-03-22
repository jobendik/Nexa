; Verify that a preloaded disk image can be read immediately after reset.
; Reads sector 0 to RAM[0x0200] and halts.

    LDI SP, 0
    LDU SP, 56

    LDI A, 0x350
    LDU A, 0x3F

    LDI D, 0
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

    HALT