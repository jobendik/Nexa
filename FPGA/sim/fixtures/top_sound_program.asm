; Minimal top-level sound integration program.
; Configures one triangle voice and one noise voice, then halts.

    LDI SP, 0
    LDU SP, 56

    LDI A, 0x340
    LDU A, 0x3F

    LDI D, 1000
    LDU D, 0
    STORE D, [A]

    LDI D, 0x198
    STORE D, [A+1]

    LDI D, 128
    STORE D, [A+6]

    LDI D, 0x1C8
    STORE D, [A+7]

    HALT