// Utility functions
var escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var hex = (n, width = 4) => (n & 65535).toString(16).toUpperCase().padStart(width, "0");
var bin16 = (n) => (n & 65535).toString(2).padStart(16, "0");
var parseFlexibleNumber = (s) => {
  if (!s) return null;
  const t = String(s).trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16) & 65535;
  if (/^0b[01]+$/i.test(t)) return parseInt(t.slice(2), 2) & 65535;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10) & 65535;
  return null;
};
var asciiFromKey = (event) => {
  if (event.key.length === 1) return event.key.charCodeAt(0) & 255;
  if (event.key === "Enter") return 10;
  if (event.key === "Backspace") return 8;
  if (event.key === "Tab") return 9;
  if (event.key === "Escape") return 27;
  if (event.key === "ArrowLeft") return 130;
  if (event.key === "ArrowUp") return 131;
  if (event.key === "ArrowRight") return 132;
  if (event.key === "ArrowDown") return 133;
  if (event.key === "Home") return 134;
  if (event.key === "End") return 135;
  if (event.key === "PageUp") return 136;
  if (event.key === "PageDown") return 137;
  if (event.key === "Insert") return 138;
  if (event.key === "Delete") return 139;
  if (event.key === "F1") return 141;
  if (event.key === "F2") return 142;
  if (event.key === "F3") return 143;
  if (event.key === "F4") return 144;
  if (event.key === "F5") return 145;
  if (event.key === "F6") return 146;
  if (event.key === "F7") return 147;
  if (event.key === "F8") return 148;
  if (event.key === "F9") return 149;
  if (event.key === "F10") return 150;
  if (event.key === "F11") return 151;
  if (event.key === "F12") return 152;
  return null;
};

