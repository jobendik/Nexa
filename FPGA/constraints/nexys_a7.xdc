## ============================================================
## nexys_a7.xdc  —  Nexys A7-100T Constraints  [LEGACY / REFERENCE]
## Nexa-16 FPGA-implementasjon
##
## MERK: Det aktive brettet er nå Basys 3.
## Bruk constraints/basys3.xdc for syntese og bring-up.
## Denne filen er beholdt som referanse for fremtidig Nexys A7-port.
##
## Klokkehastighet: 100 MHz (intern oscillator)
## FPGA: Xilinx Artix-7 XC7A100T-1CSG324C
## ============================================================

## ─── Systemklokke (100 MHz) ─────────────────────────────────
set_property -dict {PACKAGE_PIN E3 IOSTANDARD LVCMOS33} [get_ports clk]
create_clock -add -name sys_clk -period 10.00 -waveform {0 5} [get_ports clk]

## ─── Reset-knapp (CPU_RESETN, aktiv lav på Nexys A7) ────────
## MERK: Nexys A7 har CPU_RESETN som er aktiv-lav.
## Vår design bruker rst_btn som aktiv-høy.
## Inverter: connect CPU_RESETN → NOT → rst_btn i HDL,
## ELLER bruk BTN[0] (aktiv-høy) nedenfor.
## Her bruker vi BTND (ned-knapp) som reset:
set_property -dict {PACKAGE_PIN P17 IOSTANDARD LVCMOS33} [get_ports rst_btn]

## ─── UART ─────────────────────────────────────────────────────
## USB-UART (via FT2232H chip)
set_property -dict {PACKAGE_PIN D4 IOSTANDARD LVCMOS33} [get_ports uart_rx]
set_property -dict {PACKAGE_PIN C4 IOSTANDARD LVCMOS33} [get_ports uart_tx]

## ─── LED-er (16 stykk) ───────────────────────────────────────
set_property -dict {PACKAGE_PIN H17 IOSTANDARD LVCMOS33} [get_ports {leds[0]}]
set_property -dict {PACKAGE_PIN K15 IOSTANDARD LVCMOS33} [get_ports {leds[1]}]
set_property -dict {PACKAGE_PIN J13 IOSTANDARD LVCMOS33} [get_ports {leds[2]}]
set_property -dict {PACKAGE_PIN N14 IOSTANDARD LVCMOS33} [get_ports {leds[3]}]
set_property -dict {PACKAGE_PIN R18 IOSTANDARD LVCMOS33} [get_ports {leds[4]}]
set_property -dict {PACKAGE_PIN V17 IOSTANDARD LVCMOS33} [get_ports {leds[5]}]
set_property -dict {PACKAGE_PIN U17 IOSTANDARD LVCMOS33} [get_ports {leds[6]}]
set_property -dict {PACKAGE_PIN U16 IOSTANDARD LVCMOS33} [get_ports {leds[7]}]
set_property -dict {PACKAGE_PIN V16 IOSTANDARD LVCMOS33} [get_ports {leds[8]}]
set_property -dict {PACKAGE_PIN T15 IOSTANDARD LVCMOS33} [get_ports {leds[9]}]
set_property -dict {PACKAGE_PIN U14 IOSTANDARD LVCMOS33} [get_ports {leds[10]}]
set_property -dict {PACKAGE_PIN T16 IOSTANDARD LVCMOS33} [get_ports {leds[11]}]
set_property -dict {PACKAGE_PIN V15 IOSTANDARD LVCMOS33} [get_ports {leds[12]}]
set_property -dict {PACKAGE_PIN V14 IOSTANDARD LVCMOS33} [get_ports {leds[13]}]
set_property -dict {PACKAGE_PIN V12 IOSTANDARD LVCMOS33} [get_ports {leds[14]}]
set_property -dict {PACKAGE_PIN V11 IOSTANDARD LVCMOS33} [get_ports {leds[15]}]

## ─── 7-segment display anoder (aktiv lav) ───────────────────
set_property -dict {PACKAGE_PIN J17 IOSTANDARD LVCMOS33} [get_ports {an[0]}]
set_property -dict {PACKAGE_PIN J18 IOSTANDARD LVCMOS33} [get_ports {an[1]}]
set_property -dict {PACKAGE_PIN T9  IOSTANDARD LVCMOS33} [get_ports {an[2]}]
set_property -dict {PACKAGE_PIN J14 IOSTANDARD LVCMOS33} [get_ports {an[3]}]
set_property -dict {PACKAGE_PIN P14 IOSTANDARD LVCMOS33} [get_ports {an[4]}]
set_property -dict {PACKAGE_PIN T14 IOSTANDARD LVCMOS33} [get_ports {an[5]}]
set_property -dict {PACKAGE_PIN K2  IOSTANDARD LVCMOS33} [get_ports {an[6]}]
set_property -dict {PACKAGE_PIN U13 IOSTANDARD LVCMOS33} [get_ports {an[7]}]

## ─── 7-segment display katoder (aktiv lav) ──────────────────
## seg[7]=DP, seg[6]=G, seg[5]=F, seg[4]=E, seg[3]=D, seg[2]=C, seg[1]=B, seg[0]=A
set_property -dict {PACKAGE_PIN T10 IOSTANDARD LVCMOS33} [get_ports {seg[0]}]
set_property -dict {PACKAGE_PIN R10 IOSTANDARD LVCMOS33} [get_ports {seg[1]}]
set_property -dict {PACKAGE_PIN K16 IOSTANDARD LVCMOS33} [get_ports {seg[2]}]
set_property -dict {PACKAGE_PIN K13 IOSTANDARD LVCMOS33} [get_ports {seg[3]}]
set_property -dict {PACKAGE_PIN P15 IOSTANDARD LVCMOS33} [get_ports {seg[4]}]
set_property -dict {PACKAGE_PIN T11 IOSTANDARD LVCMOS33} [get_ports {seg[5]}]
set_property -dict {PACKAGE_PIN L18 IOSTANDARD LVCMOS33} [get_ports {seg[6]}]
set_property -dict {PACKAGE_PIN H15 IOSTANDARD LVCMOS33} [get_ports {seg[7]}]

## ─── PS/2 tastatur (valgfritt) ──────────────────────────────
## Nexys A7 har PS/2-port via mini-DIN
set_property -dict {PACKAGE_PIN F4  IOSTANDARD LVCMOS33} [get_ports ps2_clk]
set_property -dict {PACKAGE_PIN B2  IOSTANDARD LVCMOS33} [get_ports ps2_data]

## ─── Timing constraints ──────────────────────────────────────
## Falsk paths for asynkrone grensesnitt
set_false_path -from [get_ports rst_btn]
set_false_path -from [get_ports uart_rx]
set_false_path -to   [get_ports uart_tx]
set_false_path -from [get_ports ps2_clk]
set_false_path -from [get_ports ps2_data]

## ─── BITSTREAM-innstillinger ─────────────────────────────────
set_property BITSTREAM.GENERAL.COMPRESS TRUE  [current_design]
set_property BITSTREAM.CONFIG.CONFIGRATE 33   [current_design]
set_property CONFIG_MODE SPIx4                [current_design]
