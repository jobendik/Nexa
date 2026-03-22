const fs = require('fs');
eval(fs.readFileSync('js/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/vm-translator.js', 'utf8'));

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
eval(fs.readFileSync('js/assembler.js', 'utf8'));

const source = fs.readFileSync('nexaos.nx', 'utf8');
const parser = new Parser(source);
const ast = parser.parse();
const codegen = new CodeGenerator();
const vmCode = codegen.generate(ast, 'Main');
const fullVM = STDLIB_VM + '\n' + vmCode;

// Count VM instructions per function
const vmLines = fullVM.split('\n');
let currentFunc = '';
const funcSizes = {};
let totalVMOps = 0;

vmLines.forEach(l => {
  const trimmed = l.replace(/\/\/.*$/, '').trim();
  if (!trimmed) return;
  if (trimmed.startsWith('function ')) {
    currentFunc = trimmed.split(/\s+/)[1];
    funcSizes[currentFunc] = 0;
  } else if (currentFunc) {
    funcSizes[currentFunc]++;
    totalVMOps++;
  }
});

// Sort by size
const sorted = Object.entries(funcSizes).sort((a,b) => b[1] - a[1]);
console.log('Total VM instructions:', totalVMOps);
console.log('\nTop 30 largest functions by VM ops:');
sorted.slice(0, 30).forEach(([name, size]) => {
  console.log(`  ${name}: ${size} VM ops`);
});

console.log('\nBottom 20 smallest functions:');
sorted.slice(-20).forEach(([name, size]) => {
  console.log(`  ${name}: ${size} VM ops`);
});

// Count VM ops for each class
const classSizes = {};
sorted.forEach(([name, size]) => {
  const cls = name.split('.')[0];
  classSizes[cls] = (classSizes[cls] || 0) + size;
});
console.log('\nVM ops by class:');
Object.entries(classSizes).sort((a,b) => b[1] - a[1]).forEach(([cls, size]) => {
  console.log(`  ${cls}: ${size} VM ops`);
});

// Count string literal chars per function from VM code (push constant followed by call String.appendChar)
let inFunc2 = '';
const funcStringChars = {};
vmLines.forEach((l, i) => {
  const trimmed = l.replace(/\/\/.*$/, '').trim();
  if (trimmed.startsWith('function ')) inFunc2 = trimmed.split(/\s+/)[1];
  if (trimmed === 'call String.appendChar 2') {
    funcStringChars[inFunc2] = (funcStringChars[inFunc2] || 0) + 1;
  }
});
console.log('\nFunctions with most string chars:');
Object.entries(funcStringChars).sort((a,b) => b[1] - a[1]).slice(0, 15).forEach(([name, count]) => {
  console.log(`  ${name}: ${count} string chars`);
});
