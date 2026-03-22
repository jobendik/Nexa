const fs = require('fs');
eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

// Test minimal program
function testSize(name, src) {
  const p = new Parser(src);
  const a = p.parse();
  const c = new CodeGenerator();
  const vm = c.generate(a, 'Main');
  const full = STDLIB_VM + '\n' + vm;
  const vmt = new VMTranslator();
  const b = vmt.bootstrap();
  const r = vmt.translate(full, 'Main');
  if (!r.success) { console.log(name, 'FAIL:', r.errors); return; }
  const fa = b + '\n' + r.assembly;
  const ar = new Assembler().assemble(fa);
  if (!ar.success) { console.log(name, 'ASM FAIL'); return; }
  const vmOps = vm.split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).length;
  console.log(`${name}: ${vmOps} VM ops -> ${ar.code.length} machine words (${ar.code.length <= 61424 ? 'FITS' : 'OVERFLOW by ' + (ar.code.length - 61424)})`);
}

testSize('Empty main', `fn main() { loop { } }`);

testSize('Hello world', `fn main() { Output.printString("Hello"); loop { } }`);

testSize('10 printChar', `fn main() {
  Output.printChar(72); Output.printChar(101); Output.printChar(108);
  Output.printChar(108); Output.printChar(111); Output.printChar(32);
  Output.printChar(87); Output.printChar(111); Output.printChar(114);
  Output.printChar(108);
  loop { }
}`);

testSize('Poke hello', `fn main() {
  poke(0xEC00, 0x0F48); poke(0xEC01, 0x0F65); poke(0xEC02, 0x0F6C);
  poke(0xEC03, 0x0F6C); poke(0xEC04, 0x0F6F);
  loop { }
}`);

// Count how many chars of printString fit
for (let n = 100; n <= 1000; n += 100) {
  const chars = 'A'.repeat(n);
  testSize(`printString(${n} chars)`, `fn main() { Output.printString("${chars}"); loop { } }`);
}

// Test with multiple short strings
testSize('10x printString(5)', `fn main() {
  Output.printString("Hello");
  Output.printString("World");
  Output.printString("HackD");
  Output.printString("OS v2");
  Output.printString(".1 CP");
  Output.printString("U 16b");
  Output.printString("it 64");
  Output.printString("K RAM");
  Output.printString("32K D");
  Output.printString("isk !"); 
  loop { }
}`);
