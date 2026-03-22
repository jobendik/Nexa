; ============================================================
; boot.asm — Nexa-16 FPGA boot-program
; Fasit: emu-worker.js, memory.js, devices.js
;
; KORREKTE ADRESSER:
;   Framebuffer tekst-modus: 0xEC00 (80×30 tegn)
;   Stack:   0xE000 (vokser ned mot 0xD000)
;   I/O:     0xFF00+
;
; INSTRUKSJONSSETT (fasit assembler.js):
;   LDI dst, imm10   — sign-ext 10-bit immediate, NO FLAGS
;   LDU dst, imm6    — sett øvre 6 bit, bevar nedre 10, NO FLAGS
;   ADD/SUB/AND/OR   — 2 reg, oppdaterer N og Z
;   LOAD dst, [A+off8]   — les fra minne
;   STORE src, [A+off8]  — skriv til minne
;   PUSH/POP reg     — stakk-operasjoner
;   CALL/RET         — subrutin-kall
;   HALT             — stopp CPU
;
; For å laste FB-adressen 0xEC00:
;   LDI A, 0       ; A = 0x0000
;   LDU A, 59      ; A = (0 & 0x3FF) | (59 << 10)
;                  ; = 0 | (0x3B << 10) = 0xEC00 ✓
; ============================================================

.ORG 0

; ─── Initialisering ─────────────────────────────────────────
start:
    LDI  SP, 0
    LDU  SP, 56        ; SP = 0xE000 (stakk-topp)

; ─── Last framebuffer-adresse (0xEC00) ──────────────────────
    LDI  A, 0
    LDU  A, 59         ; A = 0xEC00 (KORREKT FB-adresse!)

; ─── Last tekstpeker i B ────────────────────────────────────
    LDI  B, melding    ; B = adresse til streng
    ; NB: LDI kan bare adressere ±511
    ; Siden melding er nær toppen av koden, fungerer dette

; ─── Kopier streng til skjermen ─────────────────────────────
kopi:
    PUSH A             ; lagre skjermadresse
    MOV  A, B          ; A = tekstpeker
    LOAD D, [A+0]      ; D = neste tegn
    AND  D, D          ; sett flagg (LOAD setter ikke flagg!)
    POP  A             ; gjenopprett skjermadresse
    BRZ  ferdig        ; null? ferdig

    STORE D, [A+0]     ; skriv tegn til skjerm

    PUSH D
    LDI  D, 1
    ADD  A, D          ; A++ (neste skjermcelle)
    ADD  B, D          ; B++ (neste tegn i streng)
    POP  D
    BRA  kopi

ferdig:
    HALT

; ─── Data ────────────────────────────────────────────────────
melding: .STRING "NEXA-16 PA FPGA!"
