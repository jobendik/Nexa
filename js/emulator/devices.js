// ============================================================
// I/O Devices — memory-mapped peripherals for NexaOS
// ============================================================

var SECTOR_SIZE = 128;
var DISK_SECTORS = 256;

// --- DisplayController (base 0xFF30) ---
var DisplayController = class {
  constructor() {
    this.mode = 0;        // 0=text, 1=pixel
    this.cursorPos = 0;   // cursor position in text mode
    this.onModeChange = null;
  }

  read(offset) {
    switch (offset) {
      case 0: return this.mode;
      case 1: return this.cursorPos;
      default: return 0;
    }
  }

  write(offset, value) {
    switch (offset) {
      case 0:
        this.mode = value & 1;
        if (this.onModeChange) this.onModeChange(this.mode);
        break;
      case 1:
        this.cursorPos = value & 0xFFFF;
        break;
    }
  }

  setModeChangeCallback(cb) { this.onModeChange = cb; }
  getMode() { return this.mode; }
  getCursorPos() { return this.cursorPos; }
};

// --- Keyboard (base 0xFF00) ---
var Keyboard = class {
  constructor() {
    this.status = 0;           // bit 0: key available
    this.data = 0;             // ASCII keycode
    this.pendingInterrupt = false;
  }

  read(offset) {
    switch (offset) {
      case 0: return this.status;
      case 1: {
        var val = this.data;
        this.status = 0;
        return val;
      }
      default: return 0;
    }
  }

  write(_offset, _value) {}

  keyDown(ascii) {
    this.data = ascii & 255;
    this.status = 1;
    this.pendingInterrupt = true;
  }

  hasPendingInterrupt() {
    if (this.pendingInterrupt) {
      this.pendingInterrupt = false;
      return true;
    }
    return false;
  }
};

// --- SystemControl (base 0xFFF0) ---
var SystemControl = class {
  constructor() {
    this.pending = 0;   // pending interrupt bitmask
    this.mask = 0;      // interrupt enable mask
  }

  read(offset) {
    switch (offset) {
      case 0: return this.pending;
      case 1: return this.mask;
      default: return 0;
    }
  }

  write(offset, value) {
    switch (offset) {
      case 0: this.pending &= ~(value & 0xFFFF); break;
      case 1: this.mask = value & 0xFFFF; break;
    }
  }

  setInterrupt(bit)   { this.pending |= 1 << bit; }
  clearInterrupt(bit) { this.pending &= ~(1 << bit); }
  hasActiveInterrupt() { return (this.pending & this.mask) !== 0; }
  getPending() { return this.pending; }
  getMask()    { return this.mask; }
};

// --- Timer (base 0xFF10) ---
var Timer = class {
  constructor() {
    this.control = 0;    // bit 0: enabled
    this.interval = 0;   // cycles between interrupts
    this.counter = 0;    // current count
    this.pendingInterrupt = false;
  }

  get enabled() { return !!(this.control & 1); }

  read(offset) {
    switch (offset) {
      case 0: return this.control;
      case 1: return this.interval;
      case 2: return this.counter & 0xFFFF;
      default: return 0;
    }
  }

  write(offset, value) {
    switch (offset) {
      case 0:
        this.control = value & 1;
        if (!this.enabled) this.counter = 0;
        break;
      case 1:
        this.interval = value & 0xFFFF;
        this.counter = 0;
        break;
    }
  }

  tick() {
    if (!this.enabled || this.interval === 0) return false;
    this.counter++;
    if (this.counter >= this.interval) {
      this.counter = 0;
      this.pendingInterrupt = true;
      return true;
    }
    return false;
  }

  hasPendingInterrupt() {
    if (this.pendingInterrupt) {
      this.pendingInterrupt = false;
      return true;
    }
    return false;
  }
};

// --- UART (base 0xFF20) ---
var UART = class {
  constructor() {
    this.txStatus = 1;     // ready to send (always ready in emulator)
    this.rxStatus = 0;     // no data
    this.rxData = 0;       // received byte
    this.pendingTxInterrupt = false;
    this.pendingRxInterrupt = false;
    this.onOutput = null;
  }

  read(offset) {
    switch (offset) {
      case 0: return this.txStatus;
      case 1: return 0;                // TX data is write-only
      case 2: return this.rxStatus;
      case 3: {
        var val = this.rxData;
        this.rxStatus = 0;
        return val;
      }
      default: return 0;
    }
  }

  write(offset, value) {
    switch (offset) {
      case 1:
        if (this.onOutput) this.onOutput(value & 255);
        this.txStatus = 1;
        this.pendingTxInterrupt = true;
        break;
    }
  }

  receive(ascii) {
    this.rxData = ascii & 255;
    this.rxStatus = 1;
    this.pendingRxInterrupt = true;
  }

  setOutputCallback(cb) { this.onOutput = cb; }

  hasPendingRxInterrupt() {
    if (this.pendingRxInterrupt) { this.pendingRxInterrupt = false; return true; }
    return false;
  }

  hasPendingTxInterrupt() {
    if (this.pendingTxInterrupt) { this.pendingTxInterrupt = false; return true; }
    return false;
  }
};

// --- DiskController (base 0xFF50) ---
var DiskController = class {
  constructor() {
    this.command = 0;
    this.sector = 0;
    this.memAddr = 0;
    this.status = 0;        // bit0: busy, bit1: done, bit2: error
    this.pendingInterrupt = false;
    this.storage = new Uint16Array(DISK_SECTORS * SECTOR_SIZE);
    this.dmaRead = null;    // function(addr) → word
    this.dmaWrite = null;   // function(addr, val)
  }

  read(offset) {
    switch (offset) {
      case 0: return this.command;
      case 1: return this.sector;
      case 2: return this.memAddr;
      case 3: return this.status;
      default: return 0;
    }
  }

  write(offset, value) {
    switch (offset) {
      case 0:
        this.command = value & 3;
        if (this.command > 0) this.executeCommand();
        break;
      case 1: this.sector = value & 255; break;
      case 2: this.memAddr = value & 0xFFFF; break;
    }
  }

  setDMA(read, write) {
    this.dmaRead = read;
    this.dmaWrite = write;
  }

  executeCommand() {
    if (this.sector >= DISK_SECTORS) {
      this.status = 4; this.command = 0; return;
    }
    var endAddr = this.memAddr + SECTOR_SIZE - 1;
    if (this.memAddr >= 0xFF00 || endAddr >= 0xFF00) {
      this.status = 4; this.command = 0; return;
    }
    this.status = 1;
    var diskOffset = this.sector * SECTOR_SIZE;
    if (this.command === 1 && this.dmaWrite) {
      for (var i = 0; i < SECTOR_SIZE; i++)
        this.dmaWrite(this.memAddr + i, this.storage[diskOffset + i]);
    } else if (this.command === 2 && this.dmaRead) {
      for (var i = 0; i < SECTOR_SIZE; i++)
        this.storage[diskOffset + i] = this.dmaRead(this.memAddr + i);
    }
    this.status = 2;
    this.command = 0;
    this.pendingInterrupt = true;
  }

  hasPendingInterrupt() {
    if (this.pendingInterrupt) { this.pendingInterrupt = false; return true; }
    return false;
  }
};
