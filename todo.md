# Toolchain Improvement Todo

This checklist captures the actionable implementation work derived from the earlier compiler, assembler, stdlib, and language review.

## Compiler

- [x] Add builtin/stdlib arity diagnostics with precise error messages
- [x] Add stricter static-vs-instance call diagnostics
- [x] Add clearer class-vs-instance field access diagnostics
- [x] Add configurable compiler warning levels
- [x] Warn on ignored non-void call results
- [x] Warn on expensive `Screen.clearScreen()` calls inside loops
- [x] Warn on unreachable code after `return` or `halt()` and stop emitting it

## Assembler

- [x] Add assembler symbol summary output
- [x] Improve unresolved-symbol diagnostics
- [x] Add warnings for branch offsets close to encoding limits

## Stdlib / Language Surface

- [x] Add a standard input abstraction layer
- [x] Add a small sound helper API
- [x] Update the Nexa reference to document the stricter language contract and new stdlib APIs

## Tests

- [x] Add regression tests for the new compiler diagnostics and warning behavior
- [x] Add regression tests for assembler warnings and summaries
- [x] Add regression tests for the new stdlib helper APIs

## Runtime Hardening

- [x] Make divide-by-zero and modulo-by-zero fail safely without runaway recursion
- [x] Add allocator and deallocator validation traps for invalid heap operations
- [x] Fix unsigned high-address handling in `Memory.deAlloc` so late-scene frees do not trip false `ERR204` traps
- [x] Add focused regression coverage for high-address frees and demo/runtime compatibility
- [x] Restore demoscene stability after runtime hardening changes

## Follow-up Audit Items

- [x] Reduce heap fragmentation by teaching `Memory.alloc` / `Memory.deAlloc` to split and coalesce free blocks instead of recycling whole blocks only
- [x] Make VM unreachable-function pruning configurable or multi-entry aware so translator output does not silently drop intentionally retained library entry points
- [x] Replace the hard-coded array bounds trap framebuffer writer with a shared runtime error path or explicitly reserved error-display region
- [x] Add targeted regression coverage for long-running heap churn and multi-entry translation behavior

## Post-Audit Fixes

- [x] Keep empty class and struct constructors valid after allocator hardening by allocating a minimum object payload size
- [x] Fix intrinsic `Sound.*` lowering so nested argument expressions cannot clobber earlier saved arguments via temp segment reuse
- [x] Keep the emulator heap bump pointer above the reserved low-memory area for small programs so freshly allocated objects can still be freed safely
- [x] Replace the synchronous emulator worker bootstrap in the web UI with a non-blocking loader while preserving the XHR and inline fallbacks
- [x] Keep NexaOS exec-magic program launches above the reserved heap base so small launched programs can allocate and free safely
- [x] Make worker disk uploads atomic so disk-full failures do not leak FAT sectors or destroy the previous file contents