// ============================================================
// STDLIB_VM — Nexa standard library in VM code
// Provides: Math, Memory, String, Array, Output, Screen,
//           Keyboard, Sys functions
// ============================================================

var STDLIB_VM = `
function Math.multiply 3
push constant 0
pop local 0
push argument 0
pop local 1
push constant 1
pop local 2
label Math.multiply$loop
push local 2
push constant 0
eq
if-goto Math.multiply$done
push argument 1
push local 2
and
push constant 0
eq
if-goto Math.multiply$skip
push local 0
push local 1
add
pop local 0
label Math.multiply$skip
push local 1
push local 1
add
pop local 1
push local 2
push local 2
add
pop local 2
goto Math.multiply$loop
label Math.multiply$done
push local 0
return
function Math.divide 4
push argument 1
push constant 0
eq
if-goto Math.divide$divzero
push constant 0
pop local 0
push constant 0
pop local 3
push argument 0
pop local 1
push argument 1
pop local 2
push local 1
push constant 0
lt
not
if-goto Math.divide$apos
push constant 0
push local 1
sub
pop local 1
push local 3
not
pop local 3
label Math.divide$apos
push local 2
push constant 0
lt
not
if-goto Math.divide$bpos
push constant 0
push local 2
sub
pop local 2
push local 3
not
pop local 3
label Math.divide$bpos
push constant 0
pop static 246
push local 1
push local 2
call Math._divU 2
pop local 0
push local 3
push constant 0
eq
if-goto Math.divide$ret
push constant 0
push local 0
sub
pop local 0
label Math.divide$ret
push local 0
return
label Math.divide$divzero
push constant 0
return
function Math._divU 1
push argument 1
push argument 0
gt
if-goto Math._divU$base
push argument 1
push constant 0
lt
if-goto Math._divU$base
push argument 0
push argument 1
push argument 1
add
call Math._divU 2
pop local 0
push argument 0
push static 246
sub
push argument 1
lt
if-goto Math._divU$even
push static 246
push argument 1
add
pop static 246
push local 0
push local 0
add
push constant 1
add
return
label Math._divU$even
push local 0
push local 0
add
return
label Math._divU$base
push constant 0
pop static 246
push constant 0
return
function Math.modulo 2
push argument 1
push constant 0
eq
if-goto Math.modulo$divzero
push argument 0
push argument 1
call Math.divide 2
pop local 0
push local 0
push argument 1
call Math.multiply 2
pop local 1
push argument 0
push local 1
sub
return
label Math.modulo$divzero
push constant 0
return
function Math.xor 0
push argument 0
push argument 1
or
push argument 0
push argument 1
and
not
and
return
function Math.shiftLeft 1
push argument 0
pop local 0
label Math.shiftLeft$loop
push argument 1
push constant 0
gt
not
if-goto Math.shiftLeft$done
push local 0
push local 0
add
pop local 0
push argument 1
push constant 1
sub
pop argument 1
goto Math.shiftLeft$loop
label Math.shiftLeft$done
push local 0
return
function Math.shiftRight 2
push constant 1
pop local 0
push argument 1
pop local 1
label Math.shiftRight$pow
push local 1
push constant 0
gt
not
if-goto Math.shiftRight$divide
push local 0
push local 0
add
pop local 0
push local 1
push constant 1
sub
pop local 1
goto Math.shiftRight$pow
label Math.shiftRight$divide
push argument 0
push local 0
call Math.divide 2
return
function Math.min 0
push argument 0
push argument 1
lt
if-goto Math.min$a
push argument 1
return
label Math.min$a
push argument 0
return
function Math.max 0
push argument 0
push argument 1
gt
if-goto Math.max$a
push argument 1
return
label Math.max$a
push argument 0
return
function Math.abs 0
push argument 0
push constant 0
lt
not
if-goto Math.abs$pos
push constant 0
push argument 0
sub
return
label Math.abs$pos
push argument 0
return
function Memory.peek 0
push argument 0
pop pointer 1
push that 0
return
function Memory.poke 0
push argument 0
pop pointer 1
push argument 1
pop that 0
push constant 0
return
function Memory.alloc 7
push argument 0
push constant 1
lt
if-goto Memory.alloc$invalid
push constant 0
pop local 2
push constant 60404
pop pointer 1
push that 0
pop local 3
label Memory.alloc$freeLoop
push local 3
push constant 0
eq
if-goto Memory.alloc$bump
push local 3
pop pointer 1
push that 0
pop local 4
push local 4
push argument 0
lt
if-goto Memory.alloc$nextFree
push local 4
push argument 0
sub
pop local 5
push local 5
push constant 2
lt
if-goto Memory.alloc$consumeWhole
push local 3
push argument 0
add
push constant 1
add
pop local 6
push local 5
push constant 1
sub
pop local 5
push local 6
pop pointer 1
push local 5
pop that 0
push local 3
push constant 1
add
pop pointer 1
push that 0
pop local 1
push local 6
push constant 1
add
pop pointer 1
push local 1
pop that 0
push local 2
push constant 0
eq
if-goto Memory.alloc$replaceHeadSplit
push local 2
push constant 1
add
pop pointer 1
push local 6
pop that 0
goto Memory.alloc$markAllocated
label Memory.alloc$replaceHeadSplit
push constant 60404
pop pointer 1
push local 6
pop that 0
label Memory.alloc$markAllocated
push local 3
pop pointer 1
push argument 0
pop that 0
goto Memory.alloc$foundFree
label Memory.alloc$consumeWhole
push local 3
push constant 1
add
pop pointer 1
push that 0
pop local 1
push local 2
push constant 0
eq
if-goto Memory.alloc$removeHead
push local 2
push constant 1
add
pop pointer 1
push local 1
pop that 0
goto Memory.alloc$foundFree
label Memory.alloc$removeHead
push constant 60404
pop pointer 1
push local 1
pop that 0
label Memory.alloc$foundFree
push local 3
push constant 1
add
return
label Memory.alloc$nextFree
push local 3
pop local 2
push local 3
push constant 1
add
pop pointer 1
push that 0
pop local 3
goto Memory.alloc$freeLoop
label Memory.alloc$bump
push constant 60401
pop pointer 1
push that 0
pop local 1
push local 1
push constant 0
eq
not
if-goto Memory.alloc$ready
push constant 8192
pop local 1
label Memory.alloc$ready
push local 1
push argument 0
add
push constant 1
add
pop local 3
push local 3
push constant 0
lt
if-goto Memory.alloc$checkHigh
goto Memory.alloc$spaceOk
label Memory.alloc$checkHigh
push local 3
push constant 60400
gt
if-goto Memory.alloc$oom
label Memory.alloc$spaceOk
push local 1
pop local 0
push local 0
pop pointer 1
push argument 0
pop that 0
push local 1
push argument 0
add
push constant 1
add
pop local 1
push constant 60401
pop pointer 1
push local 1
pop that 0
push local 0
push constant 1
add
return
label Memory.alloc$invalid
push constant 202
call Sys.error 1
push constant 0
return
label Memory.alloc$oom
push constant 203
call Sys.error 1
push constant 0
return
function Memory.deAlloc 8
push argument 0
push constant 0
lt
if-goto Memory.deAlloc$ptrNeg
push argument 0
push constant 8193
lt
if-goto Memory.deAlloc$invalid
goto Memory.deAlloc$ptrMinOk
label Memory.deAlloc$ptrNeg
push constant 0
pop local 3
label Memory.deAlloc$ptrMinOk
push constant 60401
pop pointer 1
push that 0
pop local 3
push argument 0
push constant 0
lt
if-goto Memory.deAlloc$ptrBelowHeapNeg
push local 3
push constant 0
lt
if-goto Memory.deAlloc$ptrBelowHeapOk
push argument 0
push local 3
lt
if-goto Memory.deAlloc$ptrBelowHeapOk
goto Memory.deAlloc$invalid
label Memory.deAlloc$ptrBelowHeapNeg
push local 3
push constant 0
lt
if-goto Memory.deAlloc$ptrBelowHeapCheckSigned
goto Memory.deAlloc$invalid
label Memory.deAlloc$ptrBelowHeapCheckSigned
push argument 0
push local 3
lt
if-goto Memory.deAlloc$ptrBelowHeapOk
goto Memory.deAlloc$invalid
label Memory.deAlloc$ptrBelowHeapOk
push argument 0
push constant 1
sub
pop local 0
push local 0
pop pointer 1
push that 0
pop local 1
push local 1
push constant 1
lt
if-goto Memory.deAlloc$invalid
push argument 0
push local 1
add
pop local 2
push local 2
push constant 0
lt
if-goto Memory.deAlloc$endNeg
push local 3
push constant 0
lt
if-goto Memory.deAlloc$endOk
push local 2
push local 3
gt
if-goto Memory.deAlloc$invalid
goto Memory.deAlloc$endOk
label Memory.deAlloc$endNeg
push local 3
push constant 0
lt
if-goto Memory.deAlloc$checkSignedEnd
goto Memory.deAlloc$invalid
label Memory.deAlloc$checkSignedEnd
push local 2
push local 3
gt
if-goto Memory.deAlloc$invalid
label Memory.deAlloc$endOk
push constant 0
pop local 7
push constant 60404
pop pointer 1
push that 0
pop local 4
label Memory.deAlloc$mergePrevLoop
push local 4
push constant 0
eq
if-goto Memory.deAlloc$mergePrevDone
push local 4
pop pointer 1
push that 0
pop local 6
push local 4
push local 6
add
push constant 1
add
push local 0
eq
if-goto Memory.deAlloc$mergePrevHit
push local 4
push constant 1
add
pop pointer 1
push that 0
pop local 4
goto Memory.deAlloc$mergePrevLoop
label Memory.deAlloc$mergePrevHit
push local 4
pop pointer 1
push local 6
push local 1
add
push constant 1
add
pop that 0
push local 4
pop local 0
push local 6
push local 1
add
push constant 1
add
pop local 1
push local 0
push local 1
add
push constant 1
add
pop local 2
push constant 1
pop local 7
label Memory.deAlloc$mergePrevDone
label Memory.deAlloc$mergeNextRestart
push constant 0
pop local 5
push constant 60404
pop pointer 1
push that 0
pop local 4
label Memory.deAlloc$mergeNextLoop
push local 4
push constant 0
eq
if-goto Memory.deAlloc$mergeNextDone
push local 2
push local 4
eq
if-goto Memory.deAlloc$mergeNextHit
push local 4
pop local 5
push local 4
push constant 1
add
pop pointer 1
push that 0
pop local 4
goto Memory.deAlloc$mergeNextLoop
label Memory.deAlloc$mergeNextHit
push local 4
pop pointer 1
push that 0
pop local 6
push local 1
push local 6
add
push constant 1
add
pop local 1
push local 2
push local 6
add
push constant 1
add
pop local 2
push local 4
push constant 1
add
pop pointer 1
push that 0
pop local 6
push local 5
push constant 0
eq
if-goto Memory.deAlloc$mergeNextRemoveHead
push local 5
push constant 1
add
pop pointer 1
push local 6
pop that 0
goto Memory.deAlloc$mergeNextRestart
label Memory.deAlloc$mergeNextRemoveHead
push constant 60404
pop pointer 1
push local 6
pop that 0
goto Memory.deAlloc$mergeNextRestart
label Memory.deAlloc$mergeNextDone
push local 7
if-goto Memory.deAlloc$writeMerged
push constant 60404
pop pointer 1
push that 0
pop local 6
push local 0
pop pointer 1
push local 1
pop that 0
push local 0
push constant 1
add
pop pointer 1
push local 6
pop that 0
push constant 60404
pop pointer 1
push local 0
pop that 0
goto Memory.deAlloc$done
label Memory.deAlloc$writeMerged
push local 0
pop pointer 1
push local 1
pop that 0
label Memory.deAlloc$done
push constant 0
return
label Memory.deAlloc$invalid
push constant 204
call Sys.error 1
push constant 0
return
function String.new 1
push argument 0
push constant 0
lt
if-goto String.new$invalid
push argument 0
push constant 2
add
call Memory.alloc 1
pop local 0
push local 0
pop pointer 1
push argument 0
pop that 0
push local 0
push constant 1
add
pop pointer 1
push constant 0
pop that 0
push local 0
return
label String.new$invalid
push constant 202
call Sys.error 1
push constant 0
return
function String.dispose 0
push argument 0
call Memory.deAlloc 1
pop temp 0
push constant 0
return
function String.length 0
push argument 0
push constant 1
add
pop pointer 1
push that 0
return
function String.charAt 1
push argument 0
push constant 0
eq
if-goto String.charAt$invalid
push argument 1
push constant 0
lt
if-goto String.charAt$invalid
push argument 0
push constant 1
add
pop pointer 1
push that 0
pop local 0
push argument 1
push local 0
lt
if-goto String.charAt$ok
label String.charAt$invalid
push constant 205
call Sys.error 1
push constant 0
return
label String.charAt$ok
push argument 0
push constant 2
add
push argument 1
add
pop pointer 1
push that 0
return
function String.appendChar 2
push argument 0
push constant 1
add
pop pointer 1
push that 0
pop local 0
push argument 0
pop pointer 1
push that 0
pop local 1
push local 0
push local 1
lt
not
if-goto String.appendChar$done
push argument 0
push constant 2
add
push local 0
add
pop pointer 1
push argument 1
pop that 0
push local 0
push constant 1
add
pop local 0
push argument 0
push constant 1
add
pop pointer 1
push local 0
pop that 0
label String.appendChar$done
push argument 0
return
function Array.new 1
push argument 0
push constant 0
lt
if-goto Array.new$invalid
push argument 0
call Memory.alloc 1
return
label Array.new$invalid
push constant 202
call Sys.error 1
push constant 0
return
function Array.dispose 0
push argument 0
call Memory.deAlloc 1
pop temp 0
push constant 0
return
function Output.printChar 2
push constant 60402
pop pointer 1
push that 0
pop local 0
push constant 60416
push local 0
add
pop local 1
push local 1
pop pointer 1
push constant 3840
push argument 0
or
pop that 0
push local 0
push constant 1
add
pop local 0
push local 0
push constant 2400
lt
if-goto Output.printChar$ok
push constant 0
pop local 0
label Output.printChar$ok
push constant 60402
pop pointer 1
push local 0
pop that 0
push constant 0
return
function Output.printString 2
push constant 0
pop local 0
push argument 0
call String.length 1
pop local 1
label Output.printString$loop
push local 0
push local 1
lt
not
if-goto Output.printString$done
push argument 0
push local 0
call String.charAt 2
call Output.printChar 1
pop temp 0
push local 0
push constant 1
add
pop local 0
goto Output.printString$loop
label Output.printString$done
push constant 0
return
function Output.printInt 4
push argument 0
push constant 0
lt
not
if-goto Output.printInt$pos
push constant 45
call Output.printChar 1
pop temp 0
push constant 0
push argument 0
sub
pop local 0
goto Output.printInt$start
label Output.printInt$pos
push argument 0
pop local 0
label Output.printInt$start
push constant 10000
pop local 2
label Output.printInt$skipzero
push local 2
push constant 1
gt
not
if-goto Output.printInt$print
push local 0
push local 2
lt
not
if-goto Output.printInt$print
push local 2
push constant 10
call Math.divide 2
pop local 2
goto Output.printInt$skipzero
label Output.printInt$print
label Output.printInt$digitloop
push local 2
push constant 0
gt
not
if-goto Output.printInt$done
push local 0
push local 2
call Math.divide 2
pop local 3
push local 3
push constant 48
add
call Output.printChar 1
pop temp 0
push local 3
push local 2
call Math.multiply 2
pop temp 0
push local 0
push temp 0
sub
pop local 0
push local 2
push constant 10
call Math.divide 2
pop local 2
goto Output.printInt$digitloop
label Output.printInt$done
push constant 0
return
function Output.println 2
push constant 60402
pop pointer 1
push that 0
pop local 0
push local 0
push constant 80
call Math.modulo 2
pop local 1
push local 0
push constant 80
push local 1
sub
add
pop local 0
push local 0
push constant 2400
lt
if-goto Output.println$ok
push constant 0
pop local 0
label Output.println$ok
push constant 60402
pop pointer 1
push local 0
pop that 0
push constant 0
return
function Sys.halt 0
halt
push constant 0
return
function Sys.error 0
push constant 65328
pop pointer 1
push constant 0
pop that 0
push constant 69
call Output.printChar 1
pop temp 0
push constant 82
call Output.printChar 1
pop temp 0
push constant 82
call Output.printChar 1
pop temp 0
push argument 0
call Output.printInt 1
pop temp 0
label Sys.error$halt
goto Sys.error$halt
push constant 0
return
function Time.millis 0
push constant 65299
call Memory.peek 1
return
function Time.ticks 0
call Time.millis 0
return
function Time.elapsedSince 0
call Time.millis 0
push argument 0
sub
return
function Time.sleep 1
push argument 0
push constant 0
gt
if-goto Time.sleep$begin
push constant 0
return
label Time.sleep$begin
call Time.millis 0
pop local 0
label Time.sleep$loop
call Time.millis 0
push local 0
sub
push argument 0
lt
if-goto Time.sleep$loop
push constant 0
return
function FrameClock.init 1
push argument 0
push constant 0
gt
if-goto FrameClock.init$fpsOk
push constant 60
pop argument 0
label FrameClock.init$fpsOk
push constant 1000
push argument 0
call Math.divide 2
pop local 0
push local 0
push constant 0
gt
if-goto FrameClock.init$durOk
push constant 1
pop local 0
label FrameClock.init$durOk
push local 0
pop static 240
push local 0
pop static 242
call Time.millis 0
push local 0
add
pop static 241
push constant 0
return
function FrameClock.waitNextFrame 1
push static 240
push constant 0
gt
if-goto FrameClock.waitNextFrame$ready
push constant 60
call FrameClock.init 1
pop temp 0
label FrameClock.waitNextFrame$ready
call Time.millis 0
pop local 0
push static 241
push local 0
gt
if-goto FrameClock.waitNextFrame$sleep
goto FrameClock.waitNextFrame$advance
label FrameClock.waitNextFrame$sleep
push static 241
push local 0
sub
call Time.sleep 1
pop temp 0
call Time.millis 0
pop local 0
push static 241
push local 0
gt
if-goto FrameClock.waitNextFrame$sleep
label FrameClock.waitNextFrame$advance
push local 0
push static 241
gt
if-goto FrameClock.waitNextFrame$late
push static 240
pop static 242
push static 241
push static 240
add
pop static 241
push constant 0
return
label FrameClock.waitNextFrame$late
push static 240
pop static 242
push local 0
push static 240
add
pop static 241
push constant 0
return
function FrameClock.deltaMillis 0
push static 242
return
function Sys.wait 0
push argument 0
call Time.sleep 1
pop temp 0
push constant 0
return

// Math.sqrt(x) -> floor(sqrt(x)) via binary search
function Math.sqrt 3
push constant 0
pop local 0
push constant 255
pop local 1
label Math.sqrt$loop
push local 0
push local 1
gt
if-goto Math.sqrt$done
push local 0
push local 1
add
push constant 1
add
push constant 1
call Math.shiftRight 2
pop local 2
push local 2
push local 2
call Math.multiply 2
push argument 0
gt
if-goto Math.sqrt$less
push local 2
pop local 0
goto Math.sqrt$loop
label Math.sqrt$less
push local 2
push constant 1
sub
pop local 1
goto Math.sqrt$loop
label Math.sqrt$done
push local 0
return

// Output.moveCursor(row, col)
function Output.moveCursor 0
push argument 0
push constant 80
call Math.multiply 2
push argument 1
add
push constant 60402
pop pointer 1
pop that 0
push constant 0
return

// Output.backSpace()
function Output.backSpace 1
push constant 60402
pop pointer 1
push that 0
pop local 0
push local 0
push constant 0
gt
not
if-goto Output.backSpace$done
push local 0
push constant 1
sub
pop local 0
push constant 60402
pop pointer 1
push local 0
pop that 0
push constant 60416
push local 0
add
pop pointer 1
push constant 0
pop that 0
label Output.backSpace$done
push constant 0
return

// Screen.clearScreen()
function Screen.clearScreen 2
push constant 60416
pop local 0
push constant 65280
pop local 1
label Screen.clearScreen$loop
push local 0
push local 1
lt
not
if-goto Screen.clearScreen$done
push local 0
pop pointer 1
push constant 0
pop that 0
push local 0
push constant 1
add
pop local 0
goto Screen.clearScreen$loop
label Screen.clearScreen$done
push constant 0
return

// Screen.setColor(color)
function Screen.setColor 0
push constant 60403
pop pointer 1
push argument 0
pop that 0
push constant 0
return

// Screen.drawPixel(x, y)
function Screen.drawPixel 5
push argument 1
push constant 40
call Math.multiply 2
push argument 0
push constant 4
call Math.divide 2
add
push constant 60416
add
pop local 0
push argument 0
push constant 3
and
pop local 1
push constant 3
push local 1
sub
push constant 4
call Math.multiply 2
pop local 2
push constant 60403
pop pointer 1
push that 0
pop local 4
push local 4
push local 2
call Math.shiftLeft 2
pop local 4
push constant 15
push local 2
call Math.shiftLeft 2
not
pop local 3
push local 0
pop pointer 1
push that 0
push local 3
and
push local 4
or
pop temp 0
push local 0
pop pointer 1
push temp 0
pop that 0
push constant 0
return

// Screen.drawRectangle(x1, y1, x2, y2)
function Screen.drawRectangle 2
push argument 1
pop local 0
label Screen.drawRectangle$yloop
push local 0
push argument 3
gt
if-goto Screen.drawRectangle$done
push argument 0
pop local 1
label Screen.drawRectangle$xloop
push local 1
push argument 2
gt
if-goto Screen.drawRectangle$xdone
push local 1
push local 0
call Screen.drawPixel 2
pop temp 0
push local 1
push constant 1
add
pop local 1
goto Screen.drawRectangle$xloop
label Screen.drawRectangle$xdone
push local 0
push constant 1
add
pop local 0
goto Screen.drawRectangle$yloop
label Screen.drawRectangle$done
push constant 0
return

// Screen.drawLine(x1, y1, x2, y2) - Bresenham's line algorithm
function Screen.drawLine 6
push argument 2
push argument 0
sub
call Math.abs 1
pop local 0
push argument 3
push argument 1
sub
call Math.abs 1
neg
pop local 1
push argument 0
push argument 2
lt
if-goto Screen.drawLine$sxPos
push constant 1
neg
pop local 2
goto Screen.drawLine$sxDone
label Screen.drawLine$sxPos
push constant 1
pop local 2
label Screen.drawLine$sxDone
push argument 1
push argument 3
lt
if-goto Screen.drawLine$syPos
push constant 1
neg
pop local 3
goto Screen.drawLine$syDone
label Screen.drawLine$syPos
push constant 1
pop local 3
label Screen.drawLine$syDone
push local 0
push local 1
add
pop local 4
label Screen.drawLine$loop
push argument 0
push argument 1
call Screen.drawPixel 2
pop temp 0
push argument 0
push argument 2
eq
push argument 1
push argument 3
eq
and
if-goto Screen.drawLine$done
push local 4
push local 4
add
pop local 5
push local 5
push local 1
lt
if-goto Screen.drawLine$skipX
push local 4
push local 1
add
pop local 4
push argument 0
push local 2
add
pop argument 0
label Screen.drawLine$skipX
push local 5
push local 0
gt
if-goto Screen.drawLine$skipY
push local 4
push local 0
add
pop local 4
push argument 1
push local 3
add
pop argument 1
label Screen.drawLine$skipY
goto Screen.drawLine$loop
label Screen.drawLine$done
push constant 0
return

// Screen.drawCircle(cx, cy, r) - Midpoint circle algorithm
function Screen.drawCircle 3
push constant 0
pop local 0
push argument 2
pop local 1
push constant 1
push argument 2
sub
pop local 2
label Screen.drawCircle$loop
push local 0
push local 1
gt
if-goto Screen.drawCircle$done
push argument 0
push local 0
add
push argument 1
push local 1
add
call Screen.drawPixel 2
pop temp 0
push argument 0
push local 0
sub
push argument 1
push local 1
add
call Screen.drawPixel 2
pop temp 0
push argument 0
push local 0
add
push argument 1
push local 1
sub
call Screen.drawPixel 2
pop temp 0
push argument 0
push local 0
sub
push argument 1
push local 1
sub
call Screen.drawPixel 2
pop temp 0
push argument 0
push local 1
add
push argument 1
push local 0
add
call Screen.drawPixel 2
pop temp 0
push argument 0
push local 1
sub
push argument 1
push local 0
add
call Screen.drawPixel 2
pop temp 0
push argument 0
push local 1
add
push argument 1
push local 0
sub
call Screen.drawPixel 2
pop temp 0
push argument 0
push local 1
sub
push argument 1
push local 0
sub
call Screen.drawPixel 2
pop temp 0
push local 2
push constant 0
gt
if-goto Screen.drawCircle$dPos
push local 2
push local 0
push local 0
add
add
push constant 3
add
pop local 2
goto Screen.drawCircle$incX
label Screen.drawCircle$dPos
push local 2
push local 0
push local 1
sub
push local 0
push local 1
sub
add
add
push constant 5
add
pop local 2
push local 1
push constant 1
sub
pop local 1
label Screen.drawCircle$incX
push local 0
push constant 1
add
pop local 0
goto Screen.drawCircle$loop
label Screen.drawCircle$done
push constant 0
return

// Keyboard.keyPressed() -> current key (0 if none)
function Keyboard.keyPressed 0
push constant 65280
pop pointer 1
push that 0
push constant 0
eq
if-goto Keyboard.keyPressed$none
push constant 65281
pop pointer 1
push that 0
return
label Keyboard.keyPressed$none
push constant 0
return

// Keyboard.readChar() -> char (blocking)
function Keyboard.readChar 0
label Keyboard.readChar$wait
push constant 65280
pop pointer 1
push that 0
push constant 0
eq
if-goto Keyboard.readChar$wait
push constant 65281
pop pointer 1
push that 0
return

// String.eraseLastChar(str)
function String.eraseLastChar 1
push argument 0
push constant 1
add
pop pointer 1
push that 0
pop local 0
push local 0
push constant 0
eq
if-goto String.eraseLastChar$nop
push local 0
push constant 1
sub
pop local 0
push argument 0
push constant 1
add
pop pointer 1
push local 0
pop that 0
label String.eraseLastChar$nop
push constant 0
return

// String.setCharAt(str, index, char)
function String.setCharAt 1
push argument 0
push constant 0
eq
if-goto String.setCharAt$invalid
push argument 1
push constant 0
lt
if-goto String.setCharAt$invalid
push argument 0
push constant 1
add
pop pointer 1
push that 0
pop local 0
push argument 1
push local 0
lt
if-goto String.setCharAt$ok
label String.setCharAt$invalid
push constant 205
call Sys.error 1
push constant 0
return
label String.setCharAt$ok
push argument 0
push constant 2
add
push argument 1
add
pop pointer 1
push argument 2
pop that 0
push constant 0
return

`;
