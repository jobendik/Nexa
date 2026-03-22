# Timing Architecture

This note defines the current timing model for Nexa-16 and Nexa.

## 1. Host Pacing

The emulator must not run the guest as fast as the host allows. It runs against wall clock at a fixed emulated CPU rate.

- The worker accrues cycle budget from host wall-clock time.
- The guest is stepped only up to that budget.
- This makes execution deterministic across faster and slower hosts.

The important contract is that pacing is fixed and host-throughput-independent. The current implementation uses a 25 MHz target CPU rate.

## 2. Guest Timer Model

Inside the emulated machine, time is derived from emulated cycles.

- The timer device advances from executed guest cycles, not from browser frame rate.
- Timer MMIO exposes both interval/counter state and a monotonic millisecond clock.
- The monotonic clock is stored internally as a 32-bit value split across `0xFF13` and `0xFF14`.

Important distinction:

- Timer progression requires the timer device to exist and be advanced by the emulator or harness.
- Polling the monotonic millisecond registers does not require timer interrupts to be enabled or delivered.

This is why stripped test harnesses must still register the timer device and advance it, even if they do not otherwise model a full machine.

## 3. Public Nexa Timing API

Nexa code should use the timing APIs instead of instruction-count delay loops.

### `Time`

- `Time.millis()` returns the low 16 bits of the monotonic millisecond clock.
- `Time.ticks()` is currently an alias for `Time.millis()`.
- `Time.elapsedSince(start)` returns `Time.millis() - start`.
- `Time.sleep(ms)` waits until the requested guest milliseconds have elapsed.

### `FrameClock`

- `FrameClock.init(targetFps)` configures a fixed-step frame duration.
- `FrameClock.waitNextFrame()` waits until the next scheduled frame boundary.
- `FrameClock.deltaMillis()` returns the configured target frame duration for the last frame step.

`Sys.wait(ms)` remains available for compatibility and delegates to `Time.sleep(ms)`.

## 4. Current Caveats

The current model is correct enough for demos and games, but it has limits that should stay explicit.

- `Time.millis()` exposes only the low 16 bits of the internal monotonic clock.
- `Time.elapsedSince(start)` is therefore a short-window helper, not a long-duration time API.
- `Time.sleep(ms)` is currently a polling wait on guest time, not an interrupt-driven sleep primitive.
- `FrameClock.deltaMillis()` reports target frame duration, not measured frame duration.
- `FrameClock.waitNextFrame()` does not attempt multi-frame catch-up; when late, it reschedules from `now + frameDuration`.

## 5. Authoring Guidance

Use the timing APIs according to intent.

- Use `FrameClock` for animation, gameplay, scrolling, music steps, and anything that should advance once per frame.
- Use `Time.sleep()` for explicit pauses such as splash delays, typing effects, or end screens.
- Do not author timing around raw loop counts or assumed instruction throughput.
- When building stripped-down runners or tests, always register the timer device and advance it from executed cycles.

## 6. Performance vs Time Source

Two different timing problems must not be confused.

- Time-source bug: guest time was previously unstable because the emulator could run flat-out. This is fixed.
- Performance budget issue: a heavy scene can still miss its intended cadence if it does too much work per frame. That is not a broken clock; it is a workload/headroom problem.

In other words, platform time is now explicit and stable. Missed cadence is now mostly a content-performance issue, not a timing-model issue.