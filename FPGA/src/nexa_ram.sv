// ============================================================
// nexa_ram.sv  —  64K × 16-bit Dual-Port Block RAM
//
// To separate porter:
//   Port A (imem): Kun-lese, brukt til instruksjonshenting.
//   Port B (dmem): Lese/skriv, brukt til dataaksess (LOAD/STORE).
//
// Synkron les: presentér adresse → data tilgjengelig NESTE klokkesyklus.
// Synkron skriv: data skrives ved posedge clk.
//
// Initialisering: Valgfri .mem-fil i $readmemh-format.
//   Format: én hex-verdi per linje (ingen adresseprefikser nødvendig)
//   Eksempel: "0000\n2800\n1410\n..."
//
// BRAM-inferens: Dette mønsteret syntetiseres til Block RAM i
//   Xilinx (Vivado) og Intel (Quartus) automatisk.
// ============================================================
`timescale 1ns/1ps

module nexa_ram #(
  parameter        INIT_FILE  = "",      // Valgfri hex-initfil
  parameter int    ADDR_WIDTH = 16,      // 16-bit adresse = 64K ord
  parameter int    DATA_WIDTH = 16       // 16-bit databredde
)(
  input  logic                   clk,

  // ── Port A — Instruksjonshenting (read-only) ──────────────
  input  logic [ADDR_WIDTH-1:0]  a_addr,   // Instruksjonsadresse (PC)
  output logic [DATA_WIDTH-1:0]  a_rdata,  // Instruksjonsord (IR)

  // ── Port B — Dataaksess (read/write) ─────────────────────
  input  logic [ADDR_WIDTH-1:0]  b_addr,   // Dataadresse
  input  logic [DATA_WIDTH-1:0]  b_wdata,  // Skrivedata (for STORE)
  input  logic                   b_we,     // Skriveaktivering
  output logic [DATA_WIDTH-1:0]  b_rdata   // Lesedata (for LOAD)
);

  // ── Minne-array ───────────────────────────────────────────
  // 65536 ord × 16 bit = 128 KB
  logic [DATA_WIDTH-1:0] mem [0:(1<<ADDR_WIDTH)-1];

`ifdef SIMULATION
  task automatic load_init_file;
    integer fd;
    integer scan_result;
    integer next_addr;
    integer line_addr;
    logic [DATA_WIDTH-1:0] line_word;
    reg [8*256-1:0] line_buf;
    begin
      fd = $fopen(INIT_FILE, "r");
      if (fd == 0) begin
        $error("nexa_ram: could not open init file %s", INIT_FILE);
      end else begin
        next_addr = 0;
        while (!$feof(fd)) begin
          line_buf = '0;
          void'($fgets(line_buf, fd));

          scan_result = $sscanf(line_buf, "@%h", line_addr);
          if (scan_result == 1) begin
            next_addr = line_addr;
          end else begin
            scan_result = $sscanf(line_buf, "%h", line_word);
            if (scan_result == 1) begin
              if (next_addr >= 0 && next_addr < (1<<ADDR_WIDTH)) begin
                mem[next_addr] = line_word;
                next_addr = next_addr + 1;
              end else begin
                $error("nexa_ram: init address 0x%0h out of range for %s", next_addr, INIT_FILE);
              end
            end
          end
        end
        $fclose(fd);
      end
    end
  endtask
`endif

  // ── Initialisering ────────────────────────────────────────
  initial begin
    // Nullstill alt
    for (int i = 0; i < (1<<ADDR_WIDTH); i++)
      mem[i] = '0;
    // Last inn program om fil er gitt
    if (INIT_FILE != "") begin
`ifdef SIMULATION
      load_init_file();
`else
      $readmemh(INIT_FILE, mem);
`endif
    end
  end

  // ── Port A: Synkron les (instruksjon) ─────────────────────
  // Adresse presenteres → data tilgjengelig neste syklus
  always_ff @(posedge clk) begin
    a_rdata <= mem[a_addr];
  end

  // ── Port B: Synkron les + skriv (data) ───────────────────
  // Skrivemodus: Write-First (ny data er synlig på b_rdata)
  // For Xilinx: dette infers Block RAM i True Dual Port-modus
  always_ff @(posedge clk) begin
    if (b_we) begin
      mem[b_addr] <= b_wdata;
      b_rdata     <= b_wdata;   // Write-first semantikk
    end else begin
      b_rdata <= mem[b_addr];
    end
  end

endmodule : nexa_ram
