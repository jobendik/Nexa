const fs=require('fs');
eval(fs.readFileSync('js/compiler/nexa-compiler.js','utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js','utf8'));
eval(fs.readFileSync('js/data/stdlib.js','utf8'));
const p=new Parser(fs.readFileSync('OS/nexaos.nx','utf8'));
const ast=p.parse();
const cg=new CodeGenerator();
const vm=cg.generate(ast,'Main');
const stdlibLines = STDLIB_VM.split('\n').filter(l=>l.trim() && !l.trim().startsWith('//'));
const userLines = vm.split('\n').filter(l=>l.trim() && !l.trim().startsWith('//'));
console.log('STDLIB VM lines:', stdlibLines.length);
console.log('User VM lines:', userLines.length);
console.log('Total VM lines:', stdlibLines.length + userLines.length);

// Count string literals in user VM code
let stringNew = 0;
let appendChar = 0;
userLines.forEach(l => {
  if (l.includes('call String.new')) stringNew++;
  if (l.includes('call String.appendChar')) appendChar++;
});
console.log('String.new calls:', stringNew);
console.log('String.appendChar calls:', appendChar);

// Check assembly size
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

const fullVM = STDLIB_VM + '\n' + vm;
const vmt = new VMTranslator();
const boot = vmt.bootstrap();
const vmr = vmt.translate(fullVM, 'Main');
const fullAsm = boot + '\n' + vmr.assembly;
const asmr = new Assembler().assemble(fullAsm);
console.log('Assembly lines:', fullAsm.split('\n').length);
console.log('Machine code words:', asmr.code.length);
console.log('Code fits in 64K?', asmr.code.length <= 0xEBF0);
console.log('Max code size for fit:', 0xEBF0, '(61424)');
console.log('Oversize by:', asmr.code.length - 0xEBF0, 'words');
