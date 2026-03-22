; Minimal top-level PS/2 integration program.
; Poll the keyboard MMIO surface until a key is available,
; consume it from 0xFF01, store it to RAM[0x0100], then halt.

    LDI SP, 0
    LDU SP, 56

wait_key:
    LDI A, 0x300
    LDU A, 0x3F
    LOAD D, [A]
    OR D, D
    BRZ wait_key

    LOAD D, [A+1]
    LDI A, 0x100
    LDU A, 0
    STORE D, [A]
    HALT