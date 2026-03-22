; Minimal top-level pixel-mode integration program.
; 1) Set display controller to pixel mode.
; 2) Write four packed pixels (0x1234) to the first framebuffer word.
; 3) Halt so the testbench can sample the rendered output.

    LDI SP, 0
    LDU SP, 56

    LDI A, 0x330
    LDU A, 0x3F
    LDI D, 1
    STORE D, [A]

    LDI A, 0
    LDU A, 0x3B
    LDI D, 0x234
    LDU D, 0x04
    STORE D, [A]

    HALT