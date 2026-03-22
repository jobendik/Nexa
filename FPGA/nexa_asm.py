#!/usr/bin/env python3
"""
nexa_asm.py — Nexa ASM
Konverterer Nexa ASM-kode til .mem-filer (hex-format for $readmemh).

Bruk:
    python3 nexa_asm.py program.asm -o program.mem
    python3 nexa_asm.py program.asm          (output: program.mem)
    python3 nexa_asm.py program.asm --list   (vis listing)
    python3 nexa_asm.py program.asm --binary (vis binær encoding)
"""

import re, sys, argparse
from pathlib import Path

REGS    = {'A': 0, 'D': 1, 'B': 2, 'SP': 3}
CREGS   = {'STATUS': 0, 'EPC': 1, 'CAUSE': 2, 'BASE': 3, 'LIMIT': 4, 'KSP': 5}
BR_CONDS= {'BRN':4,'BRZ':2,'BRP':1,'BRNZ':6,'BRNP':5,'BRZP':3,'BRA':7,'BRNZP':7,'BR':7}
ALU2    = {'NOT':0,'SHL':1,'ASR':2,'MOV':3,'XOR':4}

def u16(v):  return v & 0xFFFF
def s16(v):
    v = u16(v)
    return v - 0x10000 if v >= 0x8000 else v

def parse_int(s, syms, lineno, pass_num):
    s = s.strip()
    try:
        if s.startswith('0x') or s.startswith('0X'): return int(s,16)
        if s.startswith('0b') or s.startswith('0B'): return int(s[2:], 2)
        if re.match(r'^-?\d+$', s):                  return int(s)
        if s in syms:                                 return syms[s]
        # Forward-referanse i pass 1 → returner 0, løses i pass 2
        if pass_num == 1:                             return 0
        raise ValueError(f"Linje {lineno}: Ukjent symbol: '{s}'")
    except ValueError:
        raise

def parse_reg(s):  return REGS.get(s.strip().upper())
def parse_creg(s): return CREGS.get(s.strip().upper())

def strip_comment(line):
    in_str = False
    result = ''
    i = 0
    while i < len(line):
        c = line[i]
        if in_str:
            result += c
            if c == '"': in_str = False
        elif c == '"':
            in_str = True; result += c
        elif c == ';' or (c == '/' and i+1 < len(line) and line[i+1] == '/'):
            break
        else:
            result += c
        i += 1
    return result.strip()

def tokenize(text):
    # Behold [A+off] som én token ved å ikke dele på + inne i brackets
    # Splitt på komma og mellomrom, men ikke inne i []
    text = re.sub(r'\s*,\s*', ' ', text)   # komma → mellomrom
    return text.split()

def parse_mem_ref(args_str, syms, lineno, pass_num):
    """Parser [A+off8] eller [A] og returnerer offset som int."""
    m = re.search(r'\[A\s*\+\s*(-?(?:0x[0-9a-fA-F]+|\d+|[A-Za-z_.$][\w.]+))\]', args_str)
    if m: return parse_int(m.group(1), syms, lineno, pass_num)
    m = re.search(r'\[A\s*-\s*(\d+)\]', args_str)
    if m: return -int(m.group(1))
    # Bare [A] — offset=0
    if '[A]' in args_str or '[A+0]' in args_str: return 0
    # Prøv siste argument som offset
    return 0


class Assembler:
    def __init__(self):
        self.symbols = {}
        self.output  = {}    # addr → u16
        self.listing = []    # (addr, word, src_line)
        self.errors  = []

    def err(self, lineno, msg):
        self.errors.append(f"  Linje {lineno}: {msg}")

    def assemble(self, source):
        lines = source.splitlines()
        self._run(lines, 1)
        if self.errors: return {}
        self.output.clear()
        self.listing.clear()
        self._run(lines, 2)
        return self.output

    def _run(self, lines, pnum):
        addr = 0
        for lno, raw in enumerate(lines, 1):
            text = strip_comment(raw)
            if not text: continue

            # Label?
            lm = re.match(r'^([A-Za-z_.$][A-Za-z0-9_.$]*):\s*(.*)', text)
            if lm:
                label, text = lm.group(1), lm.group(2).strip()
                if pnum == 1:
                    if label in self.symbols:
                        self.err(lno, f"Duplikat label: '{label}'")
                    else:
                        self.symbols[label] = addr
                if not text: continue

            toks = tokenize(text)
            if not toks: continue
            mnem = toks[0].upper()
            rest_args = toks[1:]
            rest_str  = ' '.join(rest_args)

            try:
                addr = self._line(mnem, rest_args, rest_str, addr, lno, pnum, raw.strip())
            except ValueError as e:
                self.err(lno, str(e)); addr += 1
            except Exception as e:
                self.err(lno, f"Intern feil: {e}"); addr += 1

    def _line(self, mn, args, rest, addr, lno, p, raw):
        S = self.symbols

        def imm(s): return parse_int(s, S, lno, p)
        def reg(s):
            r = parse_reg(s)
            if r is None: raise ValueError(f"Ukjent register: '{s}'")
            return r
        def creg(s):
            r = parse_creg(s)
            if r is None: raise ValueError(f"Ukjent kontroll-register: '{s}'")
            return r

        def E(w):
            nonlocal addr
            if p == 2:
                self.output[addr] = u16(w)
                self.listing.append((addr, u16(w), raw))
            addr += 1

        # ── Direktiver ───────────────────────────────────────
        if mn == '.ORG':  return imm(args[0])
        if mn == '.EQU':
            if p == 1: S[args[0]] = imm(args[1])
            return addr
        if mn == '.WORD':
            for a in args: E(imm(a))
            return addr
        if mn == '.STRING':
            m = re.match(r'"((?:[^"\\]|\\.)*)"', rest)
            if not m: raise ValueError("Ugyldig .STRING — mangler anførselstegn")
            esc = {'n':'\n','t':'\t','r':'\r','0':'\0','\\':'\\','"':'"'}
            s, i = m.group(1), 0
            while i < len(s):
                if s[i]=='\\' and i+1<len(s):
                    E(ord(esc.get(s[i+1], s[i+1]))); i+=2
                else:
                    E(ord(s[i])); i+=1
            E(0); return addr  # null-terminator

        # ── Instruksjoner ────────────────────────────────────
        if mn == 'LDI':
            d = reg(args[0]); v = imm(args[1])
            E((0<<12)|(d<<10)|(u16(v)&0x3FF)); return addr

        if mn == 'LDU':
            d = reg(args[0]); v = imm(args[1])
            E((1<<12)|(d<<10)|(v&0x3F)); return addr

        if mn in ('ADD','SUB','AND','OR'):
            ops={'ADD':2,'SUB':3,'AND':4,'OR':5}
            d = reg(args[0]); s = reg(args[1])
            E((ops[mn]<<12)|(d<<10)|(s<<8)); return addr

        if mn in ('NOT','SHL','ASR'):
            d = reg(args[0])
            E((6<<12)|(d<<10)|(ALU2[mn]<<7)); return addr

        if mn in ('MOV','XOR'):
            d = reg(args[0]); s = reg(args[1])
            E((6<<12)|(d<<10)|(ALU2[mn]<<7)|(s<<5)); return addr

        if mn == 'LOAD':
            d = reg(args[0])
            off = parse_mem_ref(rest, S, lno, p)
            E((7<<12)|(d<<10)|(u16(off)&0xFF)); return addr

        if mn == 'STORE':
            s = reg(args[0])
            off = parse_mem_ref(rest, S, lno, p)
            E((8<<12)|(s<<10)|(u16(off)&0xFF)); return addr

        if mn in BR_CONDS or mn == 'NOP':
            if mn == 'NOP':
                E(9<<12); return addr
            nzp = BR_CONDS[mn]
            target = imm(args[0]) if args else addr
            # Offset = target - (addr+1) — addr er NÅVÆRENDE (før E)
            # I pass 1 er target=0 for ukjente symboler → offset=0 OK
            off = (target - (addr+1)) if p==2 else 0
            E((9<<12)|(nzp<<9)|(u16(off)&0x1FF)); return addr

        if mn == 'JMP':  E(10<<12); return addr
        if mn == 'CALL': E(11<<12); return addr

        if mn == 'PUSH':
            s = reg(args[0])
            E((12<<12)|(0<<11)|(s<<9)); return addr

        if mn == 'POP':
            d = reg(args[0])
            E((12<<12)|(1<<11)|(d<<9)); return addr

        if mn == 'TRAP':
            n = imm(args[0]) if args else 0
            E((13<<12)|(n&0xFFF)); return addr

        if mn == 'IRET':  E((14<<12)|(0<<8)); return addr
        if mn == 'HALT':  E((14<<12)|(3<<8)); return addr
        if mn == 'RET':   E(15<<12); return addr

        if mn == 'RDCTL':
            d = reg(args[0]); cr = creg(args[1])
            E((14<<12)|(1<<8)|(d<<6)|(cr<<3)); return addr

        if mn == 'WRCTL':
            cr = creg(args[0]); s = reg(args[1])
            E((14<<12)|(2<<8)|(s<<6)|(cr<<3)); return addr

        raise ValueError(f"Ukjent mnemonic: '{mn}'")


# ─── Disassembler ────────────────────────────────────────────
REG_NAMES = ['A','D','B','SP']
CR_NAMES  = ['STATUS','EPC','CAUSE','BASE','LIMIT','KSP']
ALU2_NAMES= ['NOT','SHL','ASR','MOV','XOR']
NZP_NAMES = {0:'NOP',1:'BRP',2:'BRZ',3:'BRZP',4:'BRN',5:'BRNP',6:'BRNZ',7:'BRA'}

def disasm_word(w, pc=0):
    op  = (w>>12)&0xF
    dst = (w>>10)&3
    src = (w>>8) &3
    r   = REG_NAMES
    def se(v,b): v&=(1<<b)-1; return v-(1<<b) if v>=(1<<(b-1)) else v

    if op==0:  return f"LDI  {r[dst]}, {se(w&0x3FF,10)}"
    if op==1:  return f"LDU  {r[dst]}, {w&0x3F}"
    if op==2:  return f"ADD  {r[dst]}, {r[src]}"
    if op==3:  return f"SUB  {r[dst]}, {r[src]}"
    if op==4:  return f"AND  {r[dst]}, {r[src]}"
    if op==5:  return f"OR   {r[dst]}, {r[src]}"
    if op==6:
        sub=(w>>7)&7; s2=(w>>5)&3
        if sub<3:   return f"{ALU2_NAMES[sub]}  {r[dst]}"
        elif sub<5: return f"{ALU2_NAMES[sub]}  {r[dst]}, {r[s2]}"
        return f"ALU2_? {sub}"
    if op==7:  return f"LOAD {r[dst]}, [A+{se(w&0xFF,8)}]"
    if op==8:  return f"STORE {r[dst]}, [A+{se(w&0xFF,8)}]"
    if op==9:
        nzp=(w>>9)&7; off=se(w&0x1FF,9)
        target=pc+1+off
        return f"{NZP_NAMES.get(nzp,'BR?')}  0x{target:04X}  ; off={off:+d}"
    if op==10: return "JMP"
    if op==11: return "CALL"
    if op==12:
        d=(w>>11)&1; rg=(w>>9)&3
        return f"{'POP' if d else 'PUSH'}  {r[rg]}"
    if op==13: return f"TRAP {w&0xFFF}"
    if op==14:
        sub=(w>>8)&0xF
        if sub==0: return "IRET"
        if sub==3: return "HALT"
        if sub==1:
            d=(w>>6)&3; cr=(w>>3)&7
            return f"RDCTL {r[d]}, {CR_NAMES[cr] if cr<6 else '?'}"
        if sub==2:
            s=(w>>6)&3; cr=(w>>3)&7
            return f"WRCTL {CR_NAMES[cr] if cr<6 else '?'}, {r[s]}"
        return f"SYS_{sub}"
    if op==15: return "RET"
    return "???"


def field_description(w):
    """Returner bilfelt-fargebeskrivelse for listing."""
    op = (w>>12)&0xF
    b  = format(w,'016b')
    # Farger: O=opkode D=dst S=src I=imm R=offset N=nzp X=ubrukt
    if op==0:   mask = 'OOOO'+'DD'+'IIIIIIIIII'
    elif op==1: mask = 'OOOO'+'DD'+'XXXXXX'+'IIIIII'  # imm6 er lav
    elif op in(2,3,4,5): mask='OOOO'+'DD'+'SS'+'X'*8
    elif op==6: mask='OOOO'+'DD'+'III'+'SS'+'X'*5
    elif op==7: mask='OOOO'+'DD'+'XX'+'RRRRRRRR'
    elif op==8: mask='OOOO'+'SS'+'XX'+'RRRRRRRR'
    elif op==9: mask='OOOO'+'NNN'+'RRRRRRRRR'
    elif op==12:mask='OOOO'+'T'+'RR'+'X'*9
    elif op==13:mask='OOOO'+'IIIIIIIIIIII'
    elif op==14:mask='OOOO'+'SSSS'+'DD'+'XXXXXXXNN'  # rough
    else:       mask='OOOO'+'X'*12
    return mask.ljust(16,'X')


# ─── Hoved ───────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(
        description='Nexa ASM tool',
        formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument('input', help='Assembly-kildefil (.asm) eller hex-fil (.mem) for disassembly')
    ap.add_argument('-o','--output', help='Utdatafil')
    ap.add_argument('--list',   action='store_true', help='Vis komplett listing med hex + instruksjon')
    ap.add_argument('--binary', action='store_true', help='Vis binær encoding for hvert ord')
    ap.add_argument('--disasm', action='store_true', help='Disassembler .mem-fil')
    ap.add_argument('--symbols',action='store_true', help='Vis symbolTabell')
    args = ap.parse_args()

    src = Path(args.input)
    if not src.exists():
        print(f"Feil: Finner ikke '{args.input}'"); sys.exit(1)

    # ── Disassembler-modus ──────────────────────────────────
    if args.disasm or src.suffix == '.mem':
        words = []
        for line in src.read_text().splitlines():
            line = strip_comment(line).strip()
            if line and re.match(r'^[0-9a-fA-F]{4}$', line):
                words.append(int(line,16))
        print(f"{'Adr':6} {'Hex':6} {'Binær':18} {'Instruksjon'}")
        print("─"*56)
        for i,w in enumerate(words):
            mn = disasm_word(w, i)
            b  = format(w,'016b')
            # Marker feltene: innsett mellomrom for lesbarhet
            bp = f"{b[0:4]} {b[4:6]} {b[6:8]} {b[8:]}"
            print(f"0x{i:04X}  {w:04X}  {bp}  {mn}")
        return

    # ── Assembler-modus ─────────────────────────────────────
    text = src.read_text(encoding='utf-8')
    asm  = Assembler()
    out  = asm.assemble(text)

    if asm.errors:
        print(f"\nAssembler-feil i '{src.name}':")
        for e in asm.errors: print(e)
        sys.exit(1)

    if not out:
        print("Ingen kode generert."); sys.exit(0)

    max_addr = max(out.keys())
    out_path = Path(args.output) if args.output else src.with_suffix('.mem')

    with open(out_path, 'w') as f:
        f.write(f"// Nexa ASM output — {src.name}\n")
        f.write(f"// {len(out)} ord, maks adresse 0x{max_addr:04X}\n")
        for a in range(max_addr+1):
            f.write(f"{out.get(a,0):04X}\n")

    print(f"✓ Assemblert {len(out)} ord ({len(out)*2} bytes) → {out_path}")

    if args.list:
        print(f"\n{'Adr':6} {'Hex':6} {'Binær':20} {'Instruksjon':<30} {'Kilde'}")
        print("─"*90)
        for a,w,s in asm.listing:
            mn = disasm_word(w, a)
            b  = format(w,'016b')
            bp = f"{b[:4]} {b[4:6]} {b[6:8]} {b[8:]}"
            print(f"0x{a:04X}  {w:04X}  {bp}  {mn:<30}  {s}")

    if args.symbols:
        print(f"\nSymboler ({len(asm.symbols)}):")
        for name,val in sorted(asm.symbols.items(), key=lambda x: x[1]):
            print(f"  0x{val:04X}  {name}")

if __name__ == '__main__':
    main()
