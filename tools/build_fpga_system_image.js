const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function loadScript(relPath) {
  const abs = path.join(root, relPath);
  global.eval(fs.readFileSync(abs, 'utf8'));
}

loadScript('js/compiler/nexa-compiler.js');
loadScript('js/compiler/vm-translator.js');
loadScript('js/data/stdlib.js');
loadScript('js/compiler/assembler.js');

function compileNexaSource(source, moduleName = 'Main') {
  const parser = new Parser(source);
  const ast = parser.parse();
  const codegen = new CodeGenerator();
  const vmCode = codegen.generate(ast, moduleName);
  const fullVm = STDLIB_VM + '\n' + vmCode;
  const translator = new VMTranslator();
  const bootstrap = translator.bootstrap();
  const vmResult = translator.translate(fullVm, moduleName);
  if (!vmResult.success) {
    throw new Error(`VM translation failed: ${vmResult.errors.join('\n')}`);
  }
  const asmResult = new Assembler().assemble(bootstrap + '\n' + vmResult.assembly);
  if (!asmResult.success) {
    throw new Error(`Assembly failed: ${asmResult.errors.join('\n')}`);
  }
  return asmResult.code;
}

function writeSequentialMem(absPath, words) {
  const lines = words.map((word) => word.toString(16).padStart(4, '0').toUpperCase());
  fs.writeFileSync(absPath, lines.join('\n') + '\n');
}

function writeSparseMem(absPath, words) {
  const lines = [];
  let addr = 0;
  while (addr < words.length) {
    while (addr < words.length && words[addr] === 0) addr++;
    if (addr >= words.length) break;
    lines.push(`@${addr.toString(16).padStart(4, '0').toUpperCase()}`);
    while (addr < words.length && words[addr] !== 0) {
      lines.push(words[addr].toString(16).padStart(4, '0').toUpperCase());
      addr++;
    }
  }
  fs.writeFileSync(absPath, lines.join('\n') + '\n');
}

function writeBootMem(absPath, codeWords) {
  const HEAP_BREAK_ADDR = 60401;
  const imageWords = new Uint16Array(HEAP_BREAK_ADDR + 1);
  imageWords.set(codeWords, 0);
  imageWords[HEAP_BREAK_ADDR] = codeWords.length;
  writeSparseMem(absPath, Array.from(imageWords));
}

function formatDisk(words) {
  words[0] = 0x4844;
  words[1] = 2;
  words[2] = 256;
  words[3] = 1;
  words[4] = 2;
  words[5] = 3;
  words[6] = 2;
  words[7] = 5;
  words[8] = 251;
  words[9] = 72;
  words[10] = 65;
  words[11] = 67;
  words[12] = 75;
  words[13] = 68;
  words[14] = 79;
  words[15] = 83;

  const FAT_OFF = 128;
  words[FAT_OFF + 0] = 0xFFFE;
  words[FAT_OFF + 1] = 0xFFFE;
  words[FAT_OFF + 2] = 0xFFFE;
  words[FAT_OFF + 3] = 0xFFFE;
  words[FAT_OFF + 4] = 0xFFFE;
}

function pad83(name, ext) {
  const upperName = name.toUpperCase().slice(0, 8).padEnd(8, ' ');
  const upperExt = ext.toUpperCase().slice(0, 3).padEnd(3, ' ');
  return {
    name: Array.from(upperName).map((ch) => ch.charCodeAt(0)),
    ext: Array.from(upperExt).map((ch) => ch.charCodeAt(0))
  };
}

function uploadFileToDisk(words, fileData, baseName, ext) {
  const FAT_OFF = 128;
  const DIR_OFF = 3 * 128;
  const { name, ext: extChars } = pad83(baseName, ext);

  let dirIdx = -1;
  for (let i = 0; i < 16; i++) {
    if ((words[DIR_OFF + i * 16 + 11] & 1) === 0) {
      dirIdx = i;
      break;
    }
  }
  if (dirIdx < 0) throw new Error('Directory full');

  const sectorsNeeded = Math.ceil(fileData.length / 128);
  let firstSec = -1;
  let prevSec = -1;
  for (let s = 0; s < sectorsNeeded; s++) {
    let freeSec = -1;
    for (let k = 5; k < 256; k++) {
      if (words[FAT_OFF + k] === 0) {
        freeSec = k;
        break;
      }
    }
    if (freeSec < 0) throw new Error(`Disk full while storing ${baseName}.${ext}`);
    words[FAT_OFF + freeSec] = 0xFFFF;
    if (prevSec >= 0) words[FAT_OFF + prevSec] = freeSec;
    if (firstSec < 0) firstSec = freeSec;
    prevSec = freeSec;

    const diskOffset = freeSec * 128;
    const fileOffset = s * 128;
    for (let w = 0; w < 128; w++) {
      words[diskOffset + w] = (fileOffset + w < fileData.length) ? fileData[fileOffset + w] : 0;
    }
  }

  const dirOffset = DIR_OFF + dirIdx * 16;
  for (let i = 0; i < 8; i++) words[dirOffset + i] = name[i];
  for (let i = 0; i < 3; i++) words[dirOffset + 8 + i] = extChars[i];
  words[dirOffset + 11] = 1;
  words[dirOffset + 12] = firstSec;
  words[dirOffset + 13] = fileData.length;
}

function main() {
  const outDir = path.join(root, 'FPGA', 'mem');

  const nexaosSrc = fs.readFileSync(path.join(root, 'OS', 'nexaos.nx'), 'utf8');
  const helloSrc = fs.readFileSync(path.join(root, 'demos', 'HelloDisk.txt'), 'utf8');
  const breakoutSrc = fs.readFileSync(path.join(root, 'demos', 'Breakout.txt'), 'utf8');

  const bootCode = compileNexaSource(nexaosSrc, 'Main');
  const helloCode = compileNexaSource(helloSrc, 'Main');
  const breakoutCode = compileNexaSource(breakoutSrc, 'Main');

  if (bootCode.length > 0xEBF0) {
    throw new Error(`NexaOS boot image too large: ${bootCode.length} words (max 60400)`);
  }

  const diskWords = new Uint16Array(256 * 128);
  formatDisk(diskWords);
  uploadFileToDisk(diskWords, helloCode, 'HELLO', 'NXE');
  uploadFileToDisk(diskWords, breakoutCode, 'BREAKOUT', 'NXE');

  writeBootMem(path.join(outDir, 'nexaos_boot.mem'), Array.from(bootCode));
  writeSparseMem(path.join(outDir, 'nexaos_system_disk.mem'), Array.from(diskWords));

  console.log(`NexaOS boot image: ${bootCode.length} words -> FPGA/mem/nexaos_boot.mem`);
  console.log(`HELLO.NXE: ${helloCode.length} words`);
  console.log(`BREAKOUT.NXE: ${breakoutCode.length} words`);
  console.log('System disk image -> FPGA/mem/nexaos_system_disk.mem');
}

main();