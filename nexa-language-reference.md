# Nexa Language Reference

Nexa is a class-based, statically typed language that compiles to Nexa VM and then to Nexa ASM for the Nexa-16 ISA. It is inspired by Jack from Nand2Tetris but adds modern features: `for`/`loop`, `break`/`continue`, enums, structs, bitwise/shift operators, short-circuit logic, and built-in hardware access functions.

---

## Program Structure

The default toolchain boots `Main.main`. In practice, the usual entry point spelling is a top-level `fn main()`, but `class Main { fn main() { ... } }` also resolves correctly when compiled as module `Main`. A program consists of top-level declarations: functions, classes, structs, enums, constants, `static` variables, and `import` declarations.

```
// Top-level function (entry point)
fn main() {
    Output.printString("Hello, Nexa!");
    Output.println();
    halt();
}
```

## Types

| Type    | Description                             |
|---------|-----------------------------------------|
| `int`   | 16-bit signed integer (-32768 to 32767) |
| `char`  | 16-bit character (ASCII)                |
| `bool`  | Boolean (`true` = -1/all bits set, `false` = 0) |
| `void`  | No return value                         |
| *Class* | Any class/struct name (e.g. `Counter`, `String`) — passed as a 16-bit pointer |

All values are 16-bit words. There are no floats, no 32-bit integers, and no references/pointers beyond raw addresses (which are just `int`).

## Literals

```
42              // decimal integer
0xFF30          // hexadecimal integer
0b10101010      // binary integer
'A'             // character literal (value 65)
'\n'            // escape: newline
'\xHH'          // hex escape in char/string
"Hello"         // string literal → creates String object
true            // boolean true (-1, all bits set)
false           // boolean false (0)
null            // null pointer (0)
```

**String literals** are compiled into `String.new(len)` followed by `String.appendChar()` calls for each character. They are heap-allocated objects, not raw pointers.

**Escape sequences** (in strings and char literals): `\n` `\t` `\r` `\\` `\"` `\'` `\0` `\xHH`

## Variables

```
var x: int = 42;
var name: String = "Alice";
var flag: bool = true;
var c: Counter = Counter.new(5);
```

Variables declared with `var` are local to the enclosing function/method. You must specify the type after the colon. Initialization is optional.

### Constants

```
const MAX: int = 100;
```

Named `const` declarations are compile-time integer aliases. The compiler reliably collects and inlines direct integer literals and unary-negative integer literals such as `-7` as named constants. Separately, the compiler also folds pure constant expressions at use sites (arithmetic, bitwise, comparison, and logical expressions), even when they are not collected as named `const` values. Constants can appear at the top level, inside classes, or inside function bodies.

## Operators

### Binary operators (by precedence, lowest to highest)

| Prec | Operators           | Description             |
|------|---------------------|-------------------------|
| 2    | `\|\|`              | Logical OR (short-circuit) |
| 3    | `&&`                | Logical AND (short-circuit) |
| 4    | `\|`                | Bitwise OR              |
| 5    | `^`                 | Bitwise XOR             |
| 6    | `&`                 | Bitwise AND             |
| 7    | `==`  `!=`          | Equality                |
| 8    | `<`  `>`  `<=`  `>=` | Comparison             |
| 9    | `<<`  `>>`          | Bit shift left/right    |
| 10   | `+`  `-`            | Addition, subtraction   |
| 11   | `*`  `/`  `%`       | Multiply, divide, modulo |

**Important:** `*`, `/`, `%`, `^`, `<<`, `>>` normally compile as function calls to `Math.multiply`, `Math.divide`, `Math.modulo`, `Math.xor`, `Math.shiftLeft`, `Math.shiftRight` respectively. The compiler now folds pure constant expressions and strength-reduces simple cases like multiply or left-shift by powers of two, but general cases are still slower than `+`, `-`, `&`, `|`.

### Unary operators

| Operator | Description        |
|----------|--------------------|
| `-`      | Arithmetic negation |
| `~`      | Bitwise NOT         |
| `!`      | Logical NOT (returns `true` if operand is 0, else `false`) |

### Short-circuit evaluation

`&&` and `||` use short-circuit evaluation: the right operand is only evaluated if needed.

## Control Flow

### if / else

```
if (x > 10) {
    Output.printString("big");
} else if (x > 5) {
    Output.printString("medium");
} else {
    Output.printString("small");
}
```

Braces are **required**. Parentheses around the condition are **required**.

### while loop

```
while (i < 10) {
    Output.printInt(i);
    i = i + 1;
}
```

### for loop

```
for (var i: int = 0; i < 10; i = i + 1) {
    Output.printInt(i);
    Output.printChar(32);
}
```

Note: there is no `++` or `+=` operator. Use `i = i + 1`.

### Infinite loop

```
loop {
    // runs forever until break or halt()
    var key: int = Keyboard.readChar();
    if (key == 27) {
        break;
    }
}
```

### break / continue

`break` exits the innermost `while`, `for`, or `loop`. `continue` jumps to the next iteration.

### unsafe blocks

```
unsafe {
    // code here
}
```

`unsafe` blocks are syntactically supported. They compile identically to a regular block — the keyword is reserved for future use (e.g., allowing raw pointer operations without safety checks).

### return

```
return value;   // return a value
return;         // return void (from void functions)
```

## Functions

Top-level functions are declared with `fn`. They are static (no `this`).

```
fn add(a: int, b: int) -> int {
    return a + b;
}

fn greet() {
    Output.printString("Hi!");
}
```

- If no `-> ReturnType` is specified, the return type is `void`.
- `void` functions implicitly return 0.
- In the default toolchain, execution starts at `Main.main`.
- `import ClassName;` can be used as a declaration statement (currently a no-op, reserved for future module support).

The compiler rejects `return value;` inside `void` subroutines. Non-void subroutines that can fall through without returning a value still compile, but now produce a warning.

## Diagnostics

The compiler supports three warning modes through `CodeGenerator({ warningLevel })`:

| `warningLevel` | Behavior |
|----------------|----------|
| `all` | Emit all compiler warnings. This is the default. |
| `compatibility` | Emit only legacy-compatibility warnings. |
| `none` | Suppress compiler warnings. |

Current warnings include:

- legacy compatibility lowering such as `clearScreen()` to `Screen.clearScreen()`
- possible non-void fallthrough
- ignored non-void call results
- `Screen.clearScreen()` inside loops
- unreachable statements after `return` or `halt()`

The compiler also enforces stricter call contracts:

- builtins and known stdlib calls now report arity mismatches with the resolved callee name
- instance methods must be called on an instance
- static functions and constructors must be called through their class name
- instance fields cannot be accessed through a class name

## Classes

```
class Counter {
    field count: int;
    field step: int;
    static totalCounters: int;

    new(initialStep: int) {
        this.count = 0;
        this.step = initialStep;
        Counter.totalCounters = Counter.totalCounters + 1;
    }

    method increment() {
        this.count = this.count + this.step;
    }

    method getValue() -> int {
        return this.count;
    }

    fn getTotal() -> int {
        return Counter.totalCounters;
    }
}
```

### Field kinds

| Keyword  | Description |
|----------|-------------|
| `field`  | Instance variable — each object gets its own copy, accessed via `this.fieldName` |
| `static` | Class-level variable — shared across all instances, accessed via `ClassName.varName` |

Class-qualified static reads and writes such as `Counter.totalCounters = Counter.totalCounters + 1;` are supported both inside and outside the declaring class.

Fields can optionally be prefixed with `pub` (e.g., `pub field x: int;`). This marks the field as public. Currently parsed by the compiler for future access-control use.

### Subroutine kinds

| Keyword  | Description |
|----------|-------------|
| `new`    | Constructor — allocates enough memory for the fields, with a minimum of 1 word even for empty objects, and returns `this` automatically. Called as `ClassName.new(args)` |
| `method` | Instance method — receives the object as implicit first argument. Called as `obj.methodName(args)` |
| `fn`     | Static function — no `this`. Called as `ClassName.functionName(args)` |

### Usage

```
var c: Counter = Counter.new(5);  // calls constructor
c.increment();                     // calls method (passes c as this)
var v: int = c.getValue();         // method returning a value
var t: int = Counter.getTotal();   // static function call
```

### How methods work internally

When you call `c.increment()`, the compiler pushes `c` onto the stack as the first argument, then calls `Counter.increment`. Inside the method, `this` refers to that object. Field access like `this.count` compiles to indexed access into the object's memory block.

### Chained field access and method calls

The compiler supports chained field access and method calls on nested objects:

```
class Game {
    field player: Player;

    method run() {
        this.player.ball.dispose();         // chained method call
        var x: int = this.player.ball.getX(); // chained field + method
        this.player.ball.x = 99;            // chained field assignment
    }
}
```

The compiler resolves the type at each level of the chain to emit correct VM code. This works to any depth, as long as each intermediate field's type is a class or struct with a known field layout.

## Structs

Structs are like lightweight classes. The compiler auto-generates `new()` and `dispose()` methods.

```
struct Point {
    x: int;
    y: int;
}

fn main() {
    var p: Point = Point.new(10, 20);
    Output.printInt(p.x);       // field access
    Output.printChar(44);       // comma
    Output.printInt(p.y);
    p.dispose();                // free memory
    halt();
}
```

- `Point.new(x, y)` allocates enough words for the struct fields, with a minimum of 1 word for empty structs, then stores x at offset 0 and y at offset 1.
- Fields are accessed by name: `p.x`, `p.y`.
- `p.dispose()` frees the memory.
- Structs cannot have methods (beyond the auto-generated ones). Use classes if you need methods.

## Enums

Enums define named integer constants with auto-incrementing values.

```
enum Color {
    BLACK,       // 0
    RED,         // 1
    GREEN,       // 2
    BLUE = 10,   // 10
    YELLOW       // 11
}

fn main() {
    var c: int = Color.RED;    // c = 1
    if (c == Color.GREEN) {
        Output.printString("green!");
    }
    halt();
}
```

- Enum values are compile-time integer constants (zero cost).
- Values auto-increment from 0, or from a custom `= value`.

## Arrays

Arrays are created using `Array.new(size)` and accessed with `[]` syntax.

```
fn main() {
    var arr: Array = Array.new(10);
    var i: int = 0;
    while (i < 10) {
        arr[i] = i * i;
        i = i + 1;
    }

    // Print them
    i = 0;
    while (i < 10) {
        Output.printInt(arr[i]);
        Output.printChar(32);
        i = i + 1;
    }
    arr.dispose();
    halt();
}
```

- Arrays are untyped (each element is a 16-bit word).
- `arr[i]` and `arr[i] = value` lower to indexed array helpers, which perform pointer arithmetic plus bounds checks; out-of-bounds access traps with `Sys.error(206)`.
- `Array.new(size)` expects a positive size. `Array.new(0)` ultimately traps with `Sys.error(202)` because the allocator rejects zero-sized allocations.
- You must manually `dispose()` arrays when done.

## Built-in Functions

These are special functions handled directly by the compiler:

| Function | Description |
|----------|-------------|
| `peek(addr)` | Read the 16-bit value at memory address `addr`. Returns `int`. |
| `poke(addr, value)` | Write `value` to memory address `addr`. |
| `halt()` | Stop the CPU (infinite loop). Call this at the end of `main()`. |
| `syscall(n, ...)` | Invoke system trap `n` with optional arguments. Advanced/OS use. |

### poke/peek for hardware access

```
poke(0xFF30, 1);           // switch to pixel mode
poke(0xFF30, 0);           // switch to text mode
var key: int = peek(0xFF00); // read keyboard status
```

## Standard Library

The following classes are available without import. Most are linked automatically. `Input.*` and `Sound.*` are compiler intrinsics: they are part of the Nexa surface, but the compiler lowers them directly instead of linking VM helper functions. `Time.*` and `FrameClock.*` are linked runtime timing APIs built on the system timer.

Legacy compatibility: older source files may use bare helper names like `clearScreen()`, `moveCursor(...)`, `printString(...)`, `printInt(...)`, `println()`, `drawPixel(...)`, and similar Output/Screen calls without the class qualifier. The compiler lowers those spellings to the current `Screen.*` and `Output.*` APIs and emits a warning. Old `Keyboard.keyDown(code)` calls are also lowered to `Keyboard.keyPressed() == code` with a warning.

### Output

| Method | Description |
|--------|-------------|
| `Output.printChar(c: int)` | Print one character at the current cursor position (text mode). It writes a cell value of `0x0F00 | c`, i.e. white foreground on black background by default. |
| `Output.printString(s: String)` | Print a string. |
| `Output.printInt(n: int)` | Print an integer (handles negative numbers). |
| `Output.println()` | Move cursor to the start of the next line. |
| `Output.moveCursor(row: int, col: int)` | Set text cursor position (row 0-29, col 0-79). |
| `Output.backSpace()` | Move cursor back one position and clear. |

### Screen (pixel mode)

Before using Screen functions, switch to pixel mode: `poke(0xFF30, 1);`

The pixel display is **160×120 pixels** with **16 CGA colors** (4-bit palette, 0–15).

| Method | Description |
|--------|-------------|
| `Screen.clearScreen()` | Clear the entire screen to black. |
| `Screen.setColor(color: int)` | Set the drawing color (0–15). |
| `Screen.drawPixel(x: int, y: int)` | Draw a single pixel at (x, y). |
| `Screen.drawRectangle(x1: int, y1: int, x2: int, y2: int)` | Draw a filled rectangle. |
| `Screen.drawLine(x1: int, y1: int, x2: int, y2: int)` | Draw a line using Bresenham's algorithm. |
| `Screen.drawCircle(cx: int, cy: int, r: int)` | Draw a circle outline using the midpoint circle algorithm. |

**Color palette (CGA 16-color):**

| Index | Color        | Index | Color         |
|-------|--------------|-------|---------------|
| 0     | Black        | 8     | Dark gray     |
| 1     | Blue         | 9     | Light blue    |
| 2     | Green        | 10    | Light green   |
| 3     | Cyan         | 11    | Light cyan    |
| 4     | Red          | 12    | Light red     |
| 5     | Magenta      | 13    | Light magenta |
| 6     | Brown        | 14    | Yellow        |
| 7     | Light gray   | 15    | White         |

### Keyboard

| Method | Description |
|--------|-------------|
| `Keyboard.keyPressed()` | Returns the ASCII code of the currently pressed key, or 0 if none. Non-blocking. |
| `Keyboard.readChar()` | Blocks until a key is pressed, then returns its ASCII code. |

For non-printing keys, the runtime uses extended key codes in the same return path:

| Key | Code |
|-----|------|
| Left | `130` |
| Up | `131` |
| Right | `132` |
| Down | `133` |
| Home | `134` |
| End | `135` |
| Page Up | `136` |
| Page Down | `137` |
| Insert | `138` |
| Delete | `139` |
| F1..F12 | `141..152` |

Example:

```nexa
var key: int = Keyboard.keyPressed();
if ((key == 130) || (key == 'a') || (key == 'A')) {
    paddle.moveLeft();
}
if ((key == 132) || (key == 'd') || (key == 'D')) {
    paddle.moveRight();
}
```

### Input

`Input` is compiler-lowered convenience syntax, not a linked VM class.

| Method | Description |
|--------|-------------|
| `Input.readKey()` | Alias-friendly input helper that returns the currently pressed ASCII code, or 0 if none. |
| `Input.isKeyDown(code: int) -> bool` | Returns `true` when the currently pressed key matches `code`. |

### Sound

`Sound` is compiler-lowered convenience syntax, not a linked VM class.

| Method | Description |
|--------|-------------|
| `Sound.setVoice(channel: int, period: int, volume: int, waveform: int)` | Configure one hardware voice directly. Channels `0..2` are tone voices and map to `0xFF40..0xFF45`; channel `3` is the noise voice and maps to `0xFF46..0xFF47`. Tone channels interpret `waveform` as `0=square, 1=triangle, 2=sawtooth, 3=sawtooth`; the noise voice interprets it as a noise mode selector. |
| `Sound.playNote(channel: int, period: int, volume: int)` | Play a voice using mode/waveform `0`. On channel `3` this produces the default noise mode. |
| `Sound.stopVoice(channel: int)` | Silence a single channel (`0..3`). |
| `Sound.silence()` | Silence all channels. |

### Time

| Method | Description |
|--------|-------------|
| `Time.millis() -> int` | Return the low 16 bits of the monotonic system millisecond clock derived from the emulator timer. Suitable only for short elapsed-time windows; it is not yet a full-width long-duration API. |
| `Time.ticks() -> int` | Alias for `Time.millis()`. |
| `Time.elapsedSince(start: int) -> int` | Convenience helper that returns `Time.millis() - start`. Intended for short wrap-tolerant elapsed-time checks, not long-duration timing. |
| `Time.sleep(ms: int)` | Poll until approximately `ms` guest milliseconds have elapsed according to the system timer. This depends on timer progression, but not on timer interrupts being enabled. |

### FrameClock

| Method | Description |
|--------|-------------|
| `FrameClock.init(targetFps: int)` | Configure a simple fixed-step frame clock. `60` is the recommended default for demos and games. |
| `FrameClock.waitNextFrame()` | Block until the next scheduled frame boundary derived from the current frame clock configuration. If the caller is already late, the next deadline is rescheduled from the current time rather than trying to catch up multiple frames. |
| `FrameClock.deltaMillis() -> int` | Return the configured target frame duration in milliseconds for the last frame step. This is not a measured actual frame delta. |

See [timing-architecture.md](timing-architecture.md) for the full host-pacing and guest-timer model.

### Math

| Method | Description |
|--------|-------------|
| `Math.multiply(a: int, b: int) -> int` | Multiply (also invoked by `*`). |
| `Math.divide(a: int, b: int) -> int` | Integer division (also invoked by `/`). |
| `Math.modulo(a: int, b: int) -> int` | Modulo (also invoked by `%`). |
| `Math.xor(a: int, b: int) -> int` | Bitwise XOR (also invoked by `^`). |
| `Math.shiftLeft(x: int, n: int) -> int` | Left shift (also invoked by `<<`). |
| `Math.shiftRight(x: int, n: int) -> int` | Right shift (also invoked by `>>`). |
| `Math.sqrt(x: int) -> int` | Integer square root (floor). |
| `Math.min(a: int, b: int) -> int` | Minimum of two values. |
| `Math.max(a: int, b: int) -> int` | Maximum of two values. |
| `Math.abs(x: int) -> int` | Absolute value. |

### String

| Method | Description |
|--------|-------------|
| `String.new(maxLength: int) -> String` | Allocate a new string with capacity `maxLength`. |
| `String.dispose(s: String)` | Free string memory. |
| `String.length(s: String) -> int` | Get current length. |
| `String.charAt(s: String, index: int) -> int` | Get character at index. Out-of-bounds access traps with `Sys.error(205)`. |
| `String.appendChar(s: String, c: int)` | Append a character. In Nexa source, treat this as a void method call; the runtime currently returns the receiver for compatibility, but that return value is not part of the language contract. |
| `String.setCharAt(s: String, index: int, c: int)` | Set character at index. Out-of-bounds access traps with `Sys.error(205)`. |
| `String.eraseLastChar(s: String)` | Remove the last character. |

Note: String methods are typically called as `myString.length()`, `myString.charAt(i)`, etc. The compiler automatically passes the object as the first argument.

### Array

| Method | Description |
|--------|-------------|
| `Array.new(size: int) -> Array` | Allocate an array of `size` words. `size` must be positive at runtime. |
| `Array.dispose(arr: Array)` | Free array memory. |

### Memory

| Method | Description |
|--------|-------------|
| `Memory.alloc(size: int) -> int` | Allocate `size` words from the heap. `size` must be positive; zero or negative sizes trap with `Sys.error(202)`. Returns the base address. |
| `Memory.deAlloc(addr: int)` | Free previously allocated memory. |
| `Memory.peek(addr: int) -> int` | Read memory at address. |
| `Memory.poke(addr: int, value: int)` | Write memory at address. |

### Sys

| Method | Description |
|--------|-------------|
| `Sys.halt()` | Halt the CPU (same as built-in `halt()`). |
| `Sys.wait(ms: int)` | Compatibility wait helper. This delegates to `Time.sleep(ms)` and therefore shares the same polling semantics and timer-progression requirement. |
| `Sys.error(code: int)` | Print "ERR" followed by the error code, then enter an infinite loop. |

## Memory Map

The Nexa-16 CPU has a 64K × 16-bit address space:

| Address Range | Description |
|---------------|-------------|
| `0x0000–0x000F` | Reserved (stack pointers, frame pointers, temp) |
| `0x0010–0x00FF` | Static variables |
| `0x0100–0xEBFF` | General RAM (heap, stack, and runtime bookkeeping). The default VM/bootstrap convention initializes `SP` to `0xEBF0`, so the active stack grows downward below that point. |
| `0xEC00–0xFEBF` | Active framebuffer storage (4800 words). Text mode: 80×30 cells (2400 words). Pixel mode: 40×120 words (160×120 pixels, 4 pixels per word). |
| `0xFEC0–0xFEFF` | Display-reserved gap. Some runtime helpers clear through `0xFEFF`, but pixels/text cells only consume `0xEC00–0xFEBF`. |
| `0xFF00–0xFF01` | Keyboard (status at +0, ASCII data at +1) |
| `0xFF10–0xFF14` | Timer (control at +0, interval at +1, counter at +2, monotonic ms low word at +3, monotonic ms high word at +4) |
| `0xFF20–0xFF23` | UART (TX status at +0, TX data at +1, RX status at +2, RX data at +3) |
| `0xFF30–0xFF31` | Display controller (mode at +0, cursor position at +1) |
| `0xFF40–0xFF47` | Sound (voices 0..2 tone period/control, voice 3 noise rate/control) |
| `0xFF50–0xFF53` | Disk controller (command at +0, sector at +1, mem address at +2, status at +3) |
| `0xFFF0–0xFFF1` | System/interrupt controller (pending at +0, mask at +1) |

**Runtime note:** the linked stdlib uses a few words near the very top of general RAM for bookkeeping such as allocator state, text cursor position, and current draw color. That is why the default stack anchor is `0xEBF0` rather than the absolute top word `0xEBFF`.

### Text mode framebuffer (mode 0)

Each word in the framebuffer at `0xEC00` represents one character cell:
- **High nibble** (bits 12–15): background color (0–15)
- **Next nibble** (bits 8–11): foreground color (0–15)
- **Low byte** (bits 0–7): ASCII character code

Example: `0x0F41` = black background, white foreground, character 'A'.

In Nexa, `Output.printChar()` handles this automatically with white-on-black (0x0F).

### Pixel mode framebuffer (mode 1)

Each word packs **4 pixels**, one nibble (4 bits) each, where each nibble is a color index 0–15. The pixel at the leftmost position in a word group is in the highest nibble.

Resolution: 160×120 pixels. Each row is 40 words (160 pixels / 4 pixels-per-word).

## Comments

```
// Single-line comment

/* Multi-line
   comment */
```

## Complete Examples

### Hello World

```
fn main() {
    Output.printString("Hello, Nexa!");
    Output.println();
    halt();
}
```

### Fibonacci Sequence

```
fn main() {
    Output.printString("Fibonacci:");
    Output.println();

    var a: int = 0;
    var b: int = 1;
    var i: int = 0;

    while (i < 15) {
        Output.printInt(a);
        Output.printChar(32);

        var temp: int = a + b;
        a = b;
        b = temp;
        i = i + 1;
    }
    halt();
}
```

### Pixel Art

```
fn main() {
    poke(0xFF30, 1);         // pixel mode
    Screen.clearScreen();

    var color: int = 1;
    var y: int = 0;
    while (y < 120) {
        Screen.setColor(color);
        Screen.drawRectangle(0, y, 159, y + 3);
        color = color + 1;
        if (color > 15) {
            color = 1;
        }
        y = y + 4;
    }

    Screen.setColor(15);
    Screen.drawRectangle(42, 30, 118, 90);
    Screen.setColor(0);
    Screen.drawRectangle(48, 35, 112, 85);

    halt();
}
```

### Classes and Objects

```
class Counter {
    field count: int;
    field step: int;

    new(initialStep: int) {
        this.count = 0;
        this.step = initialStep;
    }

    method increment() {
        this.count = this.count + this.step;
    }

    method getValue() -> int {
        return this.count;
    }

    method printValue() {
        Output.printString("Count: ");
        Output.printInt(this.count);
        Output.println();
    }
}

fn main() {
    var c: Counter = Counter.new(3);
    var i: int = 0;
    while (i < 8) {
        c.printValue();
        c.increment();
        i = i + 1;
    }
    Output.printString("Final: ");
    Output.printInt(c.getValue());
    halt();
}
```

### Keyboard Input

```
fn main() {
    Output.printString("Type something (ESC to quit):");
    Output.println();

    loop {
        var key: int = Keyboard.readChar();
        if (key == 27) {
            break;
        }
        Output.printChar(key);
    }

    Output.println();
    Output.printString("Goodbye!");
    halt();
}
```

### Structs and Enums

```
enum Direction {
    UP,
    DOWN,
    LEFT,
    RIGHT
}

struct Vec2 {
    x: int;
    y: int;
}

fn main() {
    var pos: Vec2 = Vec2.new(80, 30);
    var dir: int = Direction.RIGHT;

    Output.printString("Position: ");
    Output.printInt(pos.x);
    Output.printString(", ");
    Output.printInt(pos.y);
    Output.println();

    Output.printString("Direction: ");
    Output.printInt(dir);
    Output.println();

    pos.dispose();
    halt();
}
```

## Key Gotchas

1. **No `++`, `--`, `+=`, `-=` operators.** Use `i = i + 1`.
2. **All values are 16-bit signed integers.** Maximum value is 32767, minimum is -32768, and overflow wraps.
3. **Braces are always required** for `if`, `else`, `while`, `for`, `loop` bodies.
4. **Parentheses required** around `if` and `while` conditions.
5. **`true` is -1** (all bits set, `0xFFFF`), **`false` is 0**. This is important for bitwise operations.
6. **Strings are heap objects**, not arrays of characters. Use `String.new()` / `String.appendChar()` to build them, or use string literals which compile to that automatically.
7. **No garbage collection.** You must manually call `.dispose()` on objects/arrays/strings you allocate, or you will leak memory.
8. **Always end `main()` with `halt()`**, or the CPU will execute garbage memory.
9. **`*`, `/`, `%`, `^`, `<<`, `>>`** are library function calls (slower than `+`, `-`, `&`, `|`).
10. **No `import` is needed** for the runtime APIs. `Math`, `Output`, `Screen`, `Keyboard`, `String`, `Array`, `Memory`, and `Sys` are linked automatically; `Input` and `Sound` are compiler intrinsics.
11. **Variable declarations can appear anywhere** inside a function body (not just at the top).
12. **Field access on other objects** (e.g. `p.x`) requires the compiler to know the object's type. Declare variables with the correct type (e.g., `var p: Point`).
13. **Chained field access** (e.g. `this.player.ball.getX()`) is supported — the compiler resolves types at each level of the chain.
