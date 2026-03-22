; ============================================================
; hallo.asm — Testprogram for Nexa-16 FPGA-simulering
; Fasit: memory.js (minnekart), devices.js (I/O-adresser)
;
; KORREKTE ADRESSER (fra Nexa-16-emulatorens memory.js):
;   Framebuffer tekst-modus: 0xEC00  (80×30 tegn, IKKE 0x4000!)
;   Stack-topp:              0xE000  (vokser nedover)
;   UART TX data:            0xFF21
;   UART TX status:          0xFF20
;   Tastatur status:         0xFF00
;   Tastatur data:           0xFF01
;
; For å laste FB-adressen 0xEC00:
;   0xEC00 = 0b1110_1100_0000_0000
;   bits[15:10] = 0b111011 = 59 → LDU A, 59
;   bits[9:0]   = 0b00_0000_0000 = 0 → LDI A, 0
;   LDI A, 0 ; LDU A, 59 → A = 0xEC00 ✓
; ============================================================
.ORG 0

.EQU UART_TXST  0xFF20    ; TX status (bit0=1: klar til å sende)
.EQU UART_TXD   0xFF21    ; TX data (skriv = send byte)
.EQU FB_COL     80        ; Antall kolonner i tekst-modus (fasit: app.js)
.EQU FB_ROW     30        ; Antall rader i tekst-modus

start:
    LDI  SP, 0
    LDU  SP, 56            ; SP = 0xE000

    ; ─── Skriv tekst til framebuffer (0xEC00) ───────────────
    ; Fasit: FB starter alltid på 0xEC00, IKKE 0x4000
    ; LDI A, 0 + LDU A, 59: A = (0 & 0x3FF) | (59 << 10) = 0xEC00 ✓
    LDI  A, 0
    LDU  A, 59             ; A = 0xEC00 (korrekt framebuffer-adresse)

    LDI  B, tekst          ; B = peker til kildetekst

kopi_loop:
    PUSH A                 ; lagre skjermadresse
    MOV  A, B              ; A = tekstpeker
    LOAD D, [A+0]          ; D = neste tegn
    AND  D, D              ; oppdater flagg (LOAD setter ikke flagg!)
    POP  A                 ; gjenopprett skjermadresse
    BRZ  kopi_ferdig       ; null-terminering → ferdig

    STORE D, [A+0]         ; skriv tegn til skjerm (framebuffer ved 0xEC00)

    PUSH D
    LDI  D, 1
    ADD  A, D              ; A++ (neste skjermcelle)
    ADD  B, D              ; B++ (neste tegn i kildetekst)
    POP  D
    BRA  kopi_loop

kopi_ferdig:

    ; ─── Send tekst via UART ────────────────────────────────
    ; UART TX status: 0xFF20, TX data: 0xFF21
    LDI  B, tekst          ; B = peker til kildetekst

uart_loop:
    MOV  A, B
    LOAD D, [A+0]          ; D = neste tegn
    AND  D, D
    BRZ  uart_ferdig       ; null-terminering → ferdig

    ; Vent til UART klar (bit0 = 1)
uart_wait:
    LDI  A, 0
    LDU  A, 255            ; A = 0xFF00
    LOAD A, [A+0x20]       ; les 0xFF20 = UART_TXST
    AND  A, A
    BRZ  uart_wait         ; ikke klar: prøv igjen

    ; Send tegnet
    LDI  A, 0
    LDU  A, 255            ; A = 0xFF00
    STORE D, [A+0x21]      ; skriv til 0xFF21 = UART_TXD

    LDI  A, 1
    ADD  B, A              ; B++ (neste tegn)
    BRA  uart_loop

uart_ferdig:
    HALT

; ─── Data ───────────────────────────────────────────────────
tekst: .STRING "NEXA-16 PA FPGA!\r\nVersjon 1.0\r\n"
