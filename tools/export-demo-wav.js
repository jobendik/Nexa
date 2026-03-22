const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    input: 'demos/SimpleMelody.txt',
    output: 'tmp/simple-melody.wav',
    cycles: 120_000_000,
    cpuHz: 25_000_000,
    sampleRate: 48_000,
    tailMs: 500
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') {
      options.input = argv[++i];
    } else if (arg === '--output') {
      options.output = argv[++i];
    } else if (arg === '--cycles') {
      options.cycles = Number(argv[++i]);
    } else if (arg === '--cpu-hz') {
      options.cpuHz = Number(argv[++i]);
    } else if (arg === '--sample-rate') {
      options.sampleRate = Number(argv[++i]);
    } else if (arg === '--tail-ms') {
      options.tailMs = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: node tools/export-demo-wav.js [options]',
        '',
        'Options:',
        '  --input <path>        Nexa demo source to compile',
        '  --output <path>       WAV file to write',
        '  --cycles <count>      Max emulated cycles to run',
        '  --cpu-hz <hz>         Assumed CPU clock for cycle->time conversion',
        '  --sample-rate <hz>    WAV sample rate',
        '  --tail-ms <ms>        Audio tail appended after last event'
      ].join('\n'));
      process.exit(0);
    } else {
      fail('Unknown argument: ' + arg);
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

eval(fs.readFileSync('js/compiler/nexa-compiler.js', 'utf8'));
eval(fs.readFileSync('js/compiler/vm-translator.js', 'utf8'));
eval(fs.readFileSync('js/data/stdlib.js', 'utf8'));

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== 'symbol' ? key + '' : key, value);
eval(fs.readFileSync('js/compiler/assembler.js', 'utf8'));

const workerSrc = fs.readFileSync('js/emulator/emu-worker.js', 'utf8');
const markerIdx = workerSrc.indexOf('var cpu, memory');
if (markerIdx < 0) fail('Cannot find emulator class marker in js/emulator/emu-worker.js');
eval(workerSrc.slice(0, markerIdx));

function compileJackFile(inputPath) {
  const source = fs.readFileSync(inputPath, 'utf8');
  const ast = new Parser(source).parse();
  const vm = new CodeGenerator().generate(ast, 'Main');
  const fullVM = STDLIB_VM + '\n' + vm;
  const vmt = new VMTranslator();
  const boot = vmt.bootstrap();
  const vmr = vmt.translate(fullVM, 'Main');
  if (vmr.errors.length) fail('VM translation failed: ' + vmr.errors.join('; '));
  const asmr = new Assembler().assemble(boot + '\n' + vmr.assembly);
  if (asmr.errors.length) fail('Assembly failed: ' + asmr.errors.slice(0, 10).join('; '));
  return asmr.code;
}

function createMachine() {
  const memory = new Memory();
  const cpu = new CPU(memory);
  const display = new DisplayController();
  const keyboard = new Keyboard();
  const system = new SystemControl();
  const timer = new Timer();
  const uart = new UART();
  const disk = new DiskController();

  const sound = {
    regs: [0, 0, 0, 0, 0, 0, 0, 0],
    events: [],
    read(offset) {
      return (offset >= 0 && offset < 8) ? this.regs[offset] : 0;
    },
    write(offset, value) {
      if (offset < 0 || offset >= 8) return;
      const masked = value & 0xFFFF;
      this.regs[offset] = masked;
      this.events.push({ cycle: cpu.cycleCount, offset, value: masked });
    },
    hasPendingInterrupt() {
      return false;
    }
  };

  memory.registerDevice(0xFF00, keyboard);
  memory.registerDevice(0xFF10, timer);
  memory.registerDevice(0xFF20, uart);
  memory.registerDevice(0xFF30, display);
  memory.registerDevice(0xFF40, sound);
  memory.registerDevice(0xFF50, disk);
  memory.registerDevice(0xFFF0, system);

  display.setModeChangeCallback(function() {});
  disk.setDMA(
    function(addr) { return memory.read(addr); },
    function(addr, value) { memory.write(addr, value); }
  );
  uart.setOutputCallback(function() {});

  return { memory, cpu, keyboard, timer, system, disk, sound };
}

function runProgram(code, maxCycles) {
  const machine = createMachine();
  machine.memory.loadProgram(code);
  let cycles = 0;
  while (cycles < maxCycles && !machine.cpu.halted) {
    machine.cpu.step();
    if (machine.timer.tick && machine.timer.tick()) machine.system.setInterrupt(0);
    if (machine.keyboard.hasPendingInterrupt()) machine.system.setInterrupt(1);
    if (machine.disk.hasPendingInterrupt && machine.disk.hasPendingInterrupt()) machine.system.setInterrupt(4);
    cycles++;
  }
  return machine;
}

function createToneSample(state, sampleRate) {
  if (!state.enabled || state.period <= 0 || state.volume <= 0) return 0;
  const freq = Math.max(20, Math.min(20000, 1000000 / state.period));
  state.phase += freq / sampleRate;
  state.phase -= Math.floor(state.phase);
  const phase = state.phase;
  if (state.waveform === 1) {
    return 1 - 4 * Math.abs(phase - 0.5);
  }
  if (state.waveform === 2 || state.waveform === 3) {
    return phase * 2 - 1;
  }
  return phase < 0.5 ? 1 : -1;
}

function createNoiseSample(state, sampleRate) {
  if (!state.enabled || state.period <= 0 || state.volume <= 0) return 0;
  const baseFreq = Math.max(60, Math.min(12000, 1000000 / Math.max(1, state.period)));
  state.noiseCounter -= 1;
  if (state.noiseCounter <= 0) {
    const divisor = [1.0, 1.7, 2.8, 4.2][state.waveform & 3];
    state.noiseCounter = Math.max(1, Math.floor(sampleRate / (baseFreq / divisor)));
    state.noiseSeed = (state.noiseSeed * 1664525 + 1013904223) >>> 0;
    state.noiseValue = ((state.noiseSeed >>> 30) & 1) ? 1 : -1;
  }
  return state.noiseValue;
}

function renderWav(events, outputPath, sampleRate, cpuHz, tailMs) {
  if (!events.length) fail('No sound MMIO writes were captured.');

  const panTable = [-0.75, -0.25, 0.25, 0.75];
  const totalDuration = (events[events.length - 1].cycle / cpuHz) + (tailMs / 1000);
  const totalSamples = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const states = [0, 1, 2, 3].map(function(index) {
    return {
      kind: index === 3 ? 'noise' : 'tone',
      period: 0,
      enabled: false,
      waveform: 0,
      volume: 0,
      phase: 0,
      noiseSeed: 0x1234abcd ^ (index * 0x10203),
      noiseCounter: 1,
      noiseValue: 0
    };
  });

  let eventIndex = 0;
  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex++) {
    const cycleAtSample = Math.floor((sampleIndex * cpuHz) / sampleRate);
    while (eventIndex < events.length && events[eventIndex].cycle <= cycleAtSample) {
      const event = events[eventIndex++];
      const channelIndex = (event.offset >> 1) & 3;
      const reg = event.offset & 1;
      const state = states[channelIndex];
      if (reg === 0) {
        state.period = event.value;
      } else {
        state.enabled = !!(event.value & 8);
        state.waveform = (event.value >> 8) & 3;
        state.volume = (event.value >> 4) & 15;
      }
    }

    let mixLeft = 0;
    let mixRight = 0;
    for (let channelIndex = 0; channelIndex < states.length; channelIndex++) {
      const state = states[channelIndex];
      let raw = 0;
      if (state.kind === 'tone') {
        raw = createToneSample(state, sampleRate);
      } else {
        raw = createNoiseSample(state, sampleRate);
      }
      if (raw === 0) continue;
      const level = (state.volume / 15) * (state.kind === 'noise' ? 0.12 : 0.18);
      const pan = panTable[channelIndex];
      const leftGain = (1 - pan) * 0.5;
      const rightGain = (1 + pan) * 0.5;
      mixLeft += raw * level * leftGain;
      mixRight += raw * level * rightGain;
    }
    left[sampleIndex] = Math.max(-1, Math.min(1, Math.tanh(mixLeft * 1.6)));
    right[sampleIndex] = Math.max(-1, Math.min(1, Math.tanh(mixRight * 1.6)));
  }

  writeWav(outputPath, left, right, sampleRate);
}

function writeWav(outputPath, left, right, sampleRate) {
  const frames = left.length;
  const channels = 2;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), offset);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), offset + 2);
    offset += 4;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

const inputPath = path.resolve(options.input);
const outputPath = path.resolve(options.output);
const code = compileJackFile(inputPath);
const machine = runProgram(code, options.cycles);

renderWav(machine.sound.events, outputPath, options.sampleRate, options.cpuHz, options.tailMs);

console.log('Input:   ' + inputPath);
console.log('Output:  ' + outputPath);
console.log('Cycles:  ' + machine.cpu.cycleCount);
console.log('Events:  ' + machine.sound.events.length);
console.log('CPU Hz:  ' + options.cpuHz);
console.log('WAV OK');