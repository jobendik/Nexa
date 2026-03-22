# Nexa-16 CPU — FPGA-implementasjon

Komplett SystemVerilog-implementasjon av Nexa-16-prosessoren for FPGA.
Fasit for all oppførsel: JavaScript-emulatoren (`cpu.js`, `memory.js`, `devices.js`, `app.js`).

## Prosjektstruktur

```
hack-plus-fpga/
├── src/
│   ├── nexa_pkg.sv      Pakke: alle typer, konstanter og opkoder
│   ├── nexa_alu.sv      Kombinasjonell ALU
│   ├── nexa_ram.sv      Dual-port Block RAM (64K × 16-bit)
│   ├── nexa_uart.sv     8N1 UART sender/mottaker
│   ├── nexa_io.sv       Minne-kartlagt I/O
│   ├── nexa_cpu.sv      CPU-kjerne (FSM, decode, execute)
│   └── nexa_top.sv      Toppmodul (kobler alt sammen)
├── sim/
│   ├── *.sv                 Håndskrevne testbenker
│   ├── fixtures/            Kildedata for testbenker (.asm/.mem)
│   └── *.out/*.vcd/*.log    Genererte simuleringsartefakter (skal kunne slettes)
├── constraints/
│   └── nexys_a7.xdc         Nexys A7-100T pin-constraints
├── mem/
│   ├── boot.asm             Eldre bring-up bootprogram
│   ├── boot.mem             Eldre forhåndsassemblert bootprogram
│   ├── nexaos_boot.mem     Kompilert NexaOS boot-image for FPGA-standardoppsett
│   ├── nexaos_system_disk.mem Preloadet systemdisk med programmer/spill
│   ├── hallo.asm            Eksempelprogram: skriver til FB + UART
│   └── test.mem             Testprogram (genereres av assembler)
├── nexa_asm.py          Python-assembler
└── Makefile                 Bygge-automatisering
```

## Arkitektur

### CPU-tilstander (FSM)
```
          ┌──────────────────────────────────────────┐
          │                                          │
    ┌─────▼──────┐    ┌──────────────┐    ┌─────────▼─────────┐
    │   FETCH    │───▶│   EXECUTE    │───▶│     MEMWAIT       │
    │            │    │              │    │ (LOAD/POP/RET)    │
    │ imem_addr  │    │ Dekod + utfør│    │                   │
    │ = PC       │    │ instruksjon  │    │ dmem_rdata klar   │
    │ PC <= PC+1 │    │              │    │ → skriv til reg   │
    └────────────┘    └──────┬───────┘    └───────────────────┘
                             │                MEMIO
                             ▼            (I/O LOAD)
                        ┌─────────┐
                        │  HALT   │
                        └─────────┘
```

### Pipeline-timing
```
Syklus:    0         1         2         3         4
State: [FETCH  ] [EXECUTE] [FETCH  ] [EXECUTE] [FETCH  ]
PC:        5         6         6         7         7
Instr: ---------- mem[5] ---------- mem[6] ----------
```
Resultat: **2 sykluser per instruksjon** (de fleste).
LOAD/POP/RET tar **3 sykluser** pga. ekstra BRAM-latency.

### Minnekart

Fasit: `memory.js` + `app.js` fra Nexa-16-emulatoren.

```
0x0000–0xEBFF   RAM — generell (60 416 ord: kode, data, heap)
0xEC00–0xF55F   FRAMEBUFFER tekst-modus (del av RAM, IKKE MMIO)
                  80 kolonner × 30 rader = 2 400 ord
                  Hvert ord: [15:12]=BG-farge [11:8]=FG-farge [7:0]=ASCII
0xEC00–0xFEBF   FRAMEBUFFER piksel-modus (del av RAM)
                  40 ord × 120 rader = 4 800 ord
                  Hvert ord: 4 piksler × 4-bit palett-indeks
0xFEC0–0xFEFF   Display-reservert gap
0xFF00–0xFFFF   Minne-kartlagt I/O (MMIO)
```

> **VIKTIG:** Framebuffer starter på `0xEC00`, **ikke** `0x4000`.
> Adressen `0x4000` tilhører eldre Nand2Tetris Hack-maskinen og er feil for Nexa-16.

### I/O-enheter (MMIO 0xFF00–0xFFFF)

Fasit: `devices.js` + `emu-worker.js`.

```
0xFF00   KBD_STATUS  — Tastatur status (bit0=1: tast klar, lese-bare)
0xFF01   KBD_DATA    — Tastatur data   (les = hent tast, tømmer status)
0xFF10   TIMER_CTRL  — Timer kontroll  (bit0=1: aktiver)
0xFF11   TIMER_INTV  — Timer intervall (skriv nullstiller teller)
0xFF12   TIMER_CNT   — Timer teller    (lese-bare)
0xFF13   TIMER_MS_LO — Monoton klokke, low 16 bits (millisekunder)
0xFF14   TIMER_MS_HI — Monoton klokke, high 16 bits (millisekunder)
0xFF20   UART_TXST   — UART TX status  (bit0=1: klar til å sende)
0xFF21   UART_TXD    — UART TX data    (skriv = send byte)
0xFF22   UART_RXST   — UART RX status  (bit0=1: byte klar)
0xFF23   UART_RXD    — UART RX data    (les = hent byte, tømmer status)
0xFF30   DISP_MODE   — Display-modus   (0=tekst, 1=piksel)
0xFF31   DISP_CURSOR — Markørposisjon
0xFF40   SOUND_*     — 3 tone + 1 noise (MMIO-registre 0xFF40–0xFF47)
0xFF50   DISK_CMD    — Disk-kommando   (1=les sektor, 2=skriv sektor)
0xFF51   DISK_SECT   — Disk-sektor
0xFF52   DISK_ADDR   — Minneadresse
0xFF53   DISK_STAT   — Disk-status
0xFFF0   SYSCTRL_PEND — IRQ pending   (skriv: pending &= ~value)
0xFFF1   SYSCTRL_MASK — IRQ maske
```

Merk: FPGA-RTL-en implementerer nå den utvidede timer-registerflaten `0xFF10–0xFF14` som Nexa-timing-APIene forventer, VGA-utgangen renderer na framebufferet via en lokal shadow-kopi av `0xEC00–0xFEBF` med samme tekst/piksel-skalering som JS-frontend, PS/2-inngangen dekoder vanlige set-2 make/break-scancoder til ASCII for `0xFF00–0xFF01` med skift/caps-lock-stotte, og `0xFF40–0xFF47` driver nå en intern 4-kanals lydgenerator (3 tone + 1 noise) med square/triangle/saw/noise-mikser og sigma-delta PWM-kjerne. I toppdesignet preloads shadow-bufferet nå fra den faktisk initialiserte BRAM-en under reset-release, og holdes deretter oppdatert av CPU-skrivinger til framebufferområdet. Lyd-PWM-en er forelopig bare tilgjengelig internt i RTL/simulering; fysisk pin-binding til PMOD/RGB-LED/speaker er ikke satt opp ennå. Diskregisterne `0xFF50–0xFF53` driver nå en intern 256-sektors, BRAM-bakket disk med 128 ord per sektor og ekte RAM-DMA for lesing/skriving; den er nullinitialisert ved reset eller kan forhåndslastes fra en valgfri `DISK_FILE`-hexfil for ferdig formatterte bilder i simulering/syntese. Toppnivået har nå også en FPGA-side exec-loader som overvåker NexaOS sitt exec-magic (`0xEEFE/0xEEFF`), laster valgte sektorer fra disk til RAM[0], oppdaterer heap break og restarter CPU-en slik `RUN filnavn` faktisk fungerer på hardware uten host-hjelp.

### Forhåndslastet diskbilde

Top-level-parameteren `DISK_FILE` kan settes til en `$readmemh`-kompatibel fil for å initialisere diskinnholdet. Filen kan være sparsom og bruke `@adresse`-linjer, på samme måte som programminnet.

Eksempel:

```tcl
set_property generic {PROGRAM_FILE=mem/boot.mem DISK_FILE=mem/nexaos_blank_disk.mem} [current_fileset]
```

Repoet inneholder et sparsomt, formattert NexaOS-bilde i `mem/nexaos_blank_disk.mem` med gyldig superblokk, reserverte FAT-sektorer og tom katalog.

Standardoppsettet for `nexa_top` peker nå i stedet på `mem/nexaos_boot.mem` og `mem/nexaos_system_disk.mem`, slik FPGA-bildet booter rett inn i NexaOS og har en ferdig disk med `HELLO.NXE` og `BREAKOUT.NXE` klar for `RUN`.

## Rydding i repoet

`sim/` inneholder håndskrevne testbenker, mens `sim/fixtures/` inneholder de små kanoniske program-/memory-bildene som testene bruker.
Noen fixture-`*.mem` er genererte assembler-output fra side-ved-side `*.asm`-filer og trenger derfor ikke versionskontroll.
Følgende filer regnes som byggeartefakter og skal normalt ikke commits:

- `sim/*.out`
- `sim/*.vcd`
- `sim/*.log`
- `sim/fixtures/*.mem` når det finnes en tilsvarende `sim/fixtures/*.asm`

Kjør `make clean` for å fjerne genererte simuleringsfiler og vanlige Python-cachefiler.

### Interrupt-biter (SYSCTRL)
```
Bit 0 — Timer
Bit 1 — Tastatur
Bit 2 — UART RX
Bit 3 — UART TX
Bit 4 — Disk
```

### Exception-vektorer
```
0x0000  Reset-handler
0x0004  Interrupt-handler
0x0008  TRAP-handler
0x000C  Fault-handler
```

### Fault-koder
```
16  FETCH     — Henting av instruksjon utenfor grense
17  LOAD      — Lesing utenfor grense
18  STORE     — Skriving utenfor grense
19  STACK     — Stakk utenfor grense
20  PRIVILEGE — SYS-instruksjon fra bruker-modus
21  IO        — I/O-adresse i bruker-modus
```

## Komme i gang

### 1. Avhengigheter

```bash
# Ubuntu/Debian
sudo apt install iverilog gtkwave python3

# Verilator (anbefalt for linting)
sudo apt install verilator

# Vivado: Last ned fra Xilinx/AMD (krever gratis lisens)
# https://www.xilinx.com/products/design-tools/vivado.html
```

### 2. Simulering

```bash
# Bygg og kjør simulering
make sim

# Rask top-level verifikasjon av FPGA-side exec-loader for RUN-flyt
make sim-top-exec-loader

# Assembler testprogram manuelt
python3 nexa_asm.py mem/hallo.asm -o mem/test.mem --list
```

Forventet output fra testbenken:
```
╔══════════════════════════════════════════════════════╗
║  NEXA-16 CPU Verifikasjon  —  Fasit: cpu.js           ║
╚══════════════════════════════════════════════════════╝

── TEST 1: ADD/SUB/AND/OR ──
  OK   OR 0x55|0xAA: A=0x00FF ...
...
╔══════════════════════════════════════════════════════╗
║  Resultat: 43 bestått,  0 feil                       ║
╚══════════════════════════════════════════════════════╝
✓ ALT GRØNT — FPGA-CPU matcher Nexa-16-emulatoren!
```

Forventet UART-output fra `hallo.asm` via simulering:
```
NEXA-16 PA FPGA!
Versjon 1.0
```

### 3. Syntese med Vivado

#### Alternativ A: Vivado GUI
1. Åpne Vivado
2. **Create Project** → RTL Project
3. **Add Sources** → velg alle `.sv`-filer i `src/`
4. **Add Constraints** → velg `constraints/basys3.xdc`
5. Sett **Top Module** til `nexa_top`
6. Legg til memory init: sett `PROGRAM_FILE` parameter til `"mem/boot.mem"`
7. **Run Synthesis** → **Run Implementation** → **Generate Bitstream**
8. **Program Device**

#### Alternativ B: Batch-modus
```bash
make synth
```

#### Alternativ C: Manuell TCL-kommando
```tcl
# I Vivado TCL console:
set_property generic {PROGRAM_FILE=mem/boot.mem} [current_fileset]
```

### 4. Kjøre på brettet

Koble Basys 3 til PC via USB (mikro-B kabel).

```bash
# Åpne serial terminal (Linux)
screen /dev/ttyUSB1 115200

# Windows: Bruk PuTTY
# Baud: 115200, Data: 8, Parity: None, Stop: 1

# Trykk BTNC (reset-knapp, senter) for å starte programmet
```

### 5. Bruke assembleren

```bash
# Assembler eget program
python3 nexa_asm.py mitt_program.asm -o mem/boot.mem --list

# Vis hjelp
python3 nexa_asm.py --help
```

Assembleren forstår alle Nexa-16-instruksjoner:
```asm
; Kommentarer med ; eller //
; Direktiver:
.ORG 0x100          ; Sett startadresse
.WORD 42, 0xFF      ; Rådata
.STRING "Hallo\n"   ; Null-terminert streng
.EQU MAX 100        ; Konstantdefinisjon

; Laste en 16-bit adresse (f.eks. framebuffer 0xEC00):
    LDI  A, 0       ; A = 0x0000
    LDU  A, 59      ; A = 0xEC00  (bits[15:10]=59, bits[9:0]=0)

; Instruksjoner:
main:               ; Label
    LDI  A, 42      ; A = 42
    LDI  SP, 0
    LDU  SP, 56     ; SP = 0xE000
    LDI  A, loop    ; A = adresse til label
    CALL            ; Kall subrutine på A
    HALT

loop:
    ADD  A, D       ; A = A + D
    BRZ  done       ; Hopp til 'done' hvis Z=1
    RET

done:
    NOP
```

## Hardware-ressurser (estimert)

| Ressurs         | Estimert bruk     |
|-----------------|-------------------|
| LUT             | ~2 000–3 000      |
| FF (flip-flops) | ~500–700          |
| BRAM (36K)      | 4 (2 per port × dual) |
| DSP             | 0                 |

En Basys 3 (XC7A35T) har 33 280 LUT, 41 600 FF og 50 BRAM-blokker — mer enn nok for dette designet.

## Tilpasning til andre FPGA-brett

### Nexys A7 (Artix-7, 16 LED og 8-sifret display)
Endre i `nexa_top.sv`:
- `an[3:0]` → `an[7:0]` (8 anoder)
- Bruk `constraints/nexys_a7.xdc` i stedet for `basys3.xdc`

### Intel/Altera FPGA
- Bytt `$readmemh` i `nexa_ram.sv` med `altera_lpm_rom` eller tilsvarende
- `always_ff` og `always_comb` er standard SV — fungerer i Quartus
- Lag ny `.qsf` constraints-fil for pinout

### iCE40 (IceStudio/IceStorm — open source toolchain)
- Bruk Yosys + nextpnr
- BRAM initialiseres annerledes (bruk `$readmemh` som er støttet)
- Reduser klokke til 12 MHz (iCE40HX8K dev board)

## Feilsøking

### CPU starter ikke
- Sjekk at `rst_btn` er koblet riktig (Basys 3: BTNC = aktiv-høy reset, pin U18)
- LED[0] bør lyse med variert mønster (= PC øker)

### Ingen UART-output
- Sjekk baudrate (115200 8N1)
- Sjekk at `uart_tx` pinnen er riktig i `.xdc`
- Bekreft at programmet skriver til UART_TXD (0xFF21)

### Ingenting vises på skjerm
- Framebuffer er RAM fra 0xEC00 (tekst) til 0xFEBF (piksel)
- VGA-rendereren preloader framebuffer-ord fra BRAM ved oppstart og speiler deretter CPU-skrivinger til framebufferområdet
- Sjekk at programmet bruker `LDI A,0; LDU A,59` (→ A=0xEC00)

### Feil program
- Kjør simulering (`make sim`) og inspicer waveform i GTKWave
- Legg til `$display` i testbenken for mer debug-info

### Syntese feiler
- Sjekk at alle `.sv`-filer er lagt til i prosjektet
- `nexa_pkg.sv` må kompileres **før** de andre modulene

## Fremtidige utvidelser

- [x] VGA-display (tekst + piksel, shadow-framebuffer @ 0xEC00–0xFEBF)
- [x] PS/2 tastatur-kontroller (grunnleggende ASCII-dekoding)
- [ ] SD-kort-grensesnitt (mapping til 0xFF50)
- [ ] Interrupt-controller med prioritet
- [ ] Minnebeskyttelse (BASE/LIMIT-sjekk, allerede implementert i CPU)
- [ ] Pipelinert implementasjon (4-stegs: IF/ID/EX/WB)
- [ ] Instruksjons-cache (for raskere klokke)
- [ ] Mul/Div-instruksjoner som ISA-utvidelse
