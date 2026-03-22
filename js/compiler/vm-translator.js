// Nexa VM Translator and Standard Library
// --- VMTranslator ---
var VMTranslator = class {
  constructor() { this.output=[]; this.errors=[]; this.currentFunction=''; this.labelCount=0; this._fileName='Main'; this.staticAlloc=new Map(); this.nextStaticAddr=16; this.helperBlocks=[]; this.arrayBoundsHelperLabel=''; }
  get fileName(){return this._fileName;} set fileName(v){this._fileName=v;}
  get currentClassPrefix() {
    if(!this.currentFunction) return this._fileName;
    const dot = this.currentFunction.indexOf('.');
    return dot >= 0 ? this.currentFunction.substring(0, dot) : this._fileName;
  }
  resolveStaticAddr(idx) {
    const prefix = this.currentClassPrefix;
    const key = `${prefix}::${idx}`;
    if(!this.staticAlloc.has(key)) {
      this.staticAlloc.set(key, this.nextStaticAddr);
      this.nextStaticAddr++;
    }
    return this.staticAlloc.get(key);
  }
  translate(source, fileName='Main', options={}) {
    this.output=[]; this.errors=[]; this.currentFunction=''; this.labelCount=0; this.fileName=fileName;
    this.staticAlloc=new Map(); this.nextStaticAddr=16;
    this.helperBlocks=[]; this.arrayBoundsHelperLabel='';
    const prunedSource=this.pruneUnreachableFunctions(source, options);
    const lines=prunedSource.split('\n').map((l,i)=>({num:i+1,text:l.replace(/\/\/.*$/,'').trim()}));
    for(const line of lines) { if(line.text==='') continue; const cmd=this.parseLine(line.text,line.num); if(cmd) this.translateCommand(cmd,line.num); }
    if(this.helperBlocks.length) this.output.push(...this.helperBlocks);
    return { success:this.errors.length===0, assembly:this.output.join('\n'), errors:[...this.errors] };
  }
  pruneUnreachableFunctions(source, options={}) {
    if(options && options.pruneUnreachable === false) return source;
    const rawLines=source.split('\n');
    const blocks=[];
    let current=null;
    for(const line of rawLines) {
      const trimmed=line.replace(/\/\/.*$/,'').trim();
      if(trimmed.startsWith('function ')) {
        const parts=trimmed.split(/\s+/);
        current={ name: parts[1], lines:[line], calls:new Set() };
        blocks.push(current);
        continue;
      }
      if(current) current.lines.push(line);
    }
    if(!blocks.length) return source;
    const blockMap=new Map(blocks.map((block)=>[block.name, block]));
    for(const block of blocks) {
      for(const line of block.lines) {
        const trimmed=line.replace(/\/\/.*$/,'').trim();
        if(trimmed.startsWith('call ')) {
          const parts=trimmed.split(/\s+/);
          if(parts[1]) block.calls.add(parts[1]);
        }
      }
    }
    const roots=[];
    const requestedRoots = Array.isArray(options && options.reachabilityRoots) ? options.reachabilityRoots : null;
    if(requestedRoots && requestedRoots.length) {
      for(const root of requestedRoots) {
        if(blockMap.has(root) && !roots.includes(root)) roots.push(root);
      }
    }
    if(!roots.length) {
      if(blockMap.has('Main.main')) roots.push('Main.main');
      else roots.push(blocks[0].name);
    }
    const reachable=new Set();
    const stack=[...roots];
    while(stack.length) {
      const name=stack.pop();
      if(reachable.has(name) || !blockMap.has(name)) continue;
      reachable.add(name);
      for(const callee of blockMap.get(name).calls) stack.push(callee);
    }
    return blocks.filter((block)=>reachable.has(block.name)).map((block)=>block.lines.join('\n')).join('\n');
  }
  bootstrap() {
    return ['; === VM Bootstrap ===','    LDA SP, 0xEBF0','',`    LDI A, 1`,'    LDA D, 0xEBF0','    STORE D, [A+0]',`    LDI A, 2`,'    STORE D, [A+0]','','    LDA D, _BOOT_HALT','    PUSH D','    LDA D, 0xEBF0','    PUSH D','    PUSH D','    LDI D, 0','    PUSH D','    PUSH D','','    MOV D, SP','    PUSH B','    LDI B, 4','    ADD D, B',`    LDI A, 2`,'    STORE D, [A+0]','    POP B','','    MOV D, SP',`    LDI A, 1`,'    STORE D, [A+0]','','    LDA A, Main.main','    JMP','_BOOT_HALT:','    HALT',''].join('\n');
  }
  parseLine(text,ln) {
    const p=text.split(/\s+/); const cmd=p[0];
    const arith=['add','sub','neg','eq','gt','lt','and','or','not'];
    if(arith.includes(cmd)) return {type:'arithmetic',op:cmd};
    if(cmd==='push'||cmd==='pop') {
      if(p.length<3){this.addError(ln,`${cmd} needs segment and index`);return null;}
      const idx=parseInt(p[2]);
      if(isNaN(idx)){this.addError(ln,`Invalid index '${p[2]}' for ${cmd}`);return null;}
      return {type:cmd,segment:p[1],index:idx};
    }
    if(cmd==='label') return {type:'label',name:p[1]}; if(cmd==='goto') return {type:'goto',name:p[1]}; if(cmd==='if-goto') return {type:'if-goto',name:p[1]};
    if(cmd==='function') {
      const nL=parseInt(p[2]);
      if(isNaN(nL)){this.addError(ln,`Invalid nLocals '${p[2]}' for function`);return null;}
      return {type:'function',name:p[1],nLocals:nL};
    }
    if(cmd==='call') {
      const nA=parseInt(p[2]);
      if(isNaN(nA)){this.addError(ln,`Invalid nArgs '${p[2]}' for call`);return null;}
      return {type:'call',name:p[1],nArgs:nA};
    }
    if(cmd==='return') return {type:'return'};
    if(cmd==='halt') return {type:'halt'};
    if(cmd==='syscall') {
      const nA=parseInt(p[1]);
      if(isNaN(nA)){this.addError(ln,`Invalid nArgs '${p[1]}' for syscall`);return null;}
      return {type:'syscall',nArgs:nA};
    }
    this.addError(ln,`Unknown VM command: '${cmd}'`); return null;
  }
  translateCommand(cmd,ln) {
    this.emit(`; --- VM: ${this.cmdStr(cmd)} ---`);
    switch(cmd.type) {
      case 'arithmetic': this.trArith(cmd.op); break; case 'push': this.trPush(cmd.segment,cmd.index,ln); break; case 'pop': this.trPop(cmd.segment,cmd.index,ln); break;
      case 'label': this.emit(`${this.ql(cmd.name)}:`); break; case 'goto': this.emit(`    LDA A, ${this.ql(cmd.name)}`); this.emit('    JMP'); break;
      case 'if-goto': this.emit('    POP D'); this.emit('    PUSH A'); this.emit('    MOV A, D'); this.emit('    POP A'); this.emit('    BRZ 3'); this.emit(`    LDA A, ${this.ql(cmd.name)}`); this.emit('    JMP'); break;
      case 'function': this.currentFunction=cmd.name; this.emit(`${cmd.name}:`); if(cmd.nLocals>0){this.emit('    LDI D, 0');for(let i=0;i<cmd.nLocals;i++)this.emit('    PUSH D');} break;
      case 'call':
        if (cmd.name === 'Array.get' && cmd.nArgs === 2) this.trArrayGet();
        else if (cmd.name === 'Array.set' && cmd.nArgs === 3) this.trArraySet();
        else this.trCall(cmd.name,cmd.nArgs);
        break;
      case 'return': this.trReturn(); break; case 'halt': this.emit('    HALT'); break;
      case 'syscall': {
        // Pop syscall number (first arg) into D, leave remaining args on stack
        // so the kernel handler can access them via the user stack
        const nSysArgs = cmd.nArgs || 0;
        if(nSysArgs > 0) {
          // All args are on stack: arg_N-1 ... arg_1 arg_0(syscall#) <- top
          // Pop syscall number (arg0) into D
          this.emit('    POP D');
          this.emit('    MOV A, D');
          this.emit('    TRAP 0');
          // Clean up remaining arguments from stack after kernel returns
          for(let i = 1; i < nSysArgs; i++) {
            this.emit('    POP A');
          }
          this.emit('    PUSH D');
        } else {
          this.emit('    LDI D, 0');
          this.emit('    MOV A, D');
          this.emit('    TRAP 0');
          this.emit('    PUSH D');
        }
        break;
      }
    }
  }
  trArith(op) {
    switch(op) {
      case 'add': this.emit('    POP D'); this.emit('    POP A'); this.emit('    ADD D, A'); this.emit('    PUSH D'); break;
      case 'sub': this.emit('    POP D'); this.emit('    POP A'); this.emit('    PUSH B'); this.emit('    MOV B, D'); this.emit('    MOV D, A'); this.emit('    SUB D, B'); this.emit('    POP B'); this.emit('    PUSH D'); break;
      case 'neg': this.emit('    POP D'); this.emit('    NOT D'); this.emit('    PUSH B'); this.emit('    LDI B, 1'); this.emit('    ADD D, B'); this.emit('    POP B'); this.emit('    PUSH D'); break;
      case 'eq': this.trCmp('BRZ'); break; case 'gt': this.trCmp('BRN'); break; case 'lt': this.trCmp('BRP'); break;
      case 'and': this.emit('    POP D'); this.emit('    POP A'); this.emit('    AND D, A'); this.emit('    PUSH D'); break;
      case 'or': this.emit('    POP D'); this.emit('    POP A'); this.emit('    OR D, A'); this.emit('    PUSH D'); break;
      case 'not': this.emit('    POP D'); this.emit('    NOT D'); this.emit('    PUSH D'); break;
    }
  }
  trCmp(br) {
    const tl=this.ul('CMP_T'), el=this.ul('CMP_E');
    if (br === 'BRZ') {
      this.emit('    POP D'); this.emit('    POP A'); this.emit('    SUB A, D');
      this.emit(`    BRZ ${tl}`); this.emit('    LDI D, 0'); this.emit(`    BRA ${el}`); this.emit(`${tl}:`); this.emit('    LDI D, -1'); this.emit(`${el}:`); this.emit('    PUSH D');
      return;
    }
    // gt or lt — overflow-safe: detect differing signs via XOR
    const dl=this.ul('CMP_D');
    const cb=br==='BRN'?'BRP':'BRN';
    this.emit('    POP D'); this.emit('    POP A');
    this.emit('    PUSH B'); this.emit('    MOV B, A'); this.emit('    XOR B, D');
    this.emit(`    BRN ${dl}`);
    // Same-sign path: subtraction is safe
    this.emit('    SUB A, D'); this.emit('    POP B');
    this.emit(`    ${cb} ${tl}`); this.emit('    LDI D, 0'); this.emit(`    BRA ${el}`);
    // Different-signs path: result depends on sign of x (in A)
    this.emit(`${dl}:`); this.emit('    LDI D, 0'); this.emit('    ADD A, D'); this.emit('    POP B');
    if (br === 'BRN') {
      // gt: x >= 0 means true (fall through to tl), x < 0 means false
      this.emit(`    BRN ${el}`);
    } else {
      // lt: x < 0 means true, x >= 0 means false
      this.emit(`    BRN ${tl}`); this.emit(`    BRA ${el}`);
    }
    this.emit(`${tl}:`); this.emit('    LDI D, -1'); this.emit(`${el}:`); this.emit('    PUSH D');
  }
  trPush(seg,idx,ln) {
    switch(seg) {
      case 'constant': this.emitLoadD(idx); this.emit('    PUSH D'); break;
      case 'local': this.loadSP('local'); this.emit(`    LOAD D, [A-${idx+1}]`); this.emit('    PUSH D'); break;
      case 'argument': this.loadSP('argument'); if(idx===0) this.emit('    LOAD D, [A+0]'); else this.emit(`    LOAD D, [A-${idx}]`); this.emit('    PUSH D'); break;
      case 'this': case 'that': this.loadSP(seg); this.emit(`    LOAD D, [A+${idx}]`); this.emit('    PUSH D'); break;
      case 'temp': this.emitLoadA(5+idx); this.emit('    LOAD D, [A+0]'); this.emit('    PUSH D'); break;
      case 'pointer': this.emitLoadA(idx===0?3:4); this.emit('    LOAD D, [A+0]'); this.emit('    PUSH D'); break;
      case 'static': { const sa=this.resolveStaticAddr(idx); this.emitLoadA(sa); this.emit('    LOAD D, [A+0]'); this.emit('    PUSH D'); break; }
      default: this.addError(ln,`Unknown segment '${seg}'`);
    }
  }
  trPop(seg,idx,ln) {
    switch(seg) {
      case 'local': this.emit('    POP B'); this.loadSP('local'); this.emit(`    STORE B, [A-${idx+1}]`); break;
      case 'argument': this.emit('    POP B'); this.loadSP('argument'); if(idx===0) this.emit('    STORE B, [A+0]'); else this.emit(`    STORE B, [A-${idx}]`); break;
      case 'this': case 'that': this.emit('    POP B'); this.loadSP(seg); this.emit(`    STORE B, [A+${idx}]`); break;
      case 'temp': this.emit('    POP D'); this.emitLoadA(5+idx); this.emit('    STORE D, [A+0]'); break;
      case 'pointer': this.emit('    POP D'); this.emitLoadA(idx===0?3:4); this.emit('    STORE D, [A+0]'); break;
      case 'static': { const sa=this.resolveStaticAddr(idx); this.emit('    POP D'); this.emitLoadA(sa); this.emit('    STORE D, [A+0]'); break; }
      default: this.addError(ln,`Cannot pop to '${seg}'`);
    }
  }
  emitLoadA(v) { if(typeof v==='number'&&v>=-512&&v<=511) this.emit(`    LDI A, ${v}`); else this.emit(`    LDA A, ${v}`); }
  emitLoadD(v) { if(typeof v==='number'&&v>=-512&&v<=511) this.emit(`    LDI D, ${v}`); else this.emit(`    LDA D, ${v}`); }
  loadSP(seg) { const m={local:1,argument:2,this:3,that:4}; this.emitLoadA(m[seg]); this.emit('    LOAD A, [A+0]'); }
  trCall(name,nArgs) {
    const rl=this.ul('RET');
    this.emit(`    LDA D, ${rl}`); this.emit('    PUSH D');
    this.pushFA(1); this.pushFA(2); this.pushFA(3); this.pushFA(4);
    this.emit('    MOV D, SP'); this.emit('    PUSH B'); this.emit(`    LDI B, ${nArgs+4}`); this.emit('    ADD D, B'); this.emitLoadA(2); this.emit('    STORE D, [A+0]'); this.emit('    POP B');
    this.emit('    MOV D, SP'); this.emitLoadA(1); this.emit('    STORE D, [A+0]');
    this.emit(`    LDA A, ${name}`); this.emit('    JMP'); this.emit(`${rl}:`);
  }
  trArrayGet() {
    const ok=this.ul('ARRGET_OK');
    const failLocal=this.ul('ARRGET_FAIL');
    const fail=this.ensureArrayBoundsHelper();
    this.emit('    POP D');
    this.emit('    POP A');
    this.emit('    MOV B, D');
    this.emit(`    BRN ${failLocal}`);
    this.emit('    LOAD D, [A-1]');
    this.emit('    SUB D, B');
    this.emit(`    BRP ${ok}`);
    this.emit(`${failLocal}:`);
    this.emit(`    LDA A, ${fail}`);
    this.emit('    JMP');
    this.emit(`${ok}:`);
    this.emit('    ADD A, B');
    this.emit('    LOAD D, [A+0]');
    this.emit('    PUSH D');
  }
  trArraySet() {
    const ok=this.ul('ARRSET_OK');
    const failLocal=this.ul('ARRSET_FAIL');
    const fail=this.ensureArrayBoundsHelper();
    this.emit('    POP D');
    this.emitLoadA(5);
    this.emit('    STORE D, [A+0]');
    this.emit('    POP D');
    this.emit('    POP B');
    this.emitLoadA(6);
    this.emit('    STORE B, [A+0]');
    this.emit('    MOV B, D');
    this.emit(`    BRN ${failLocal}`);
    this.emitLoadA(6);
    this.emit('    LOAD A, [A+0]');
    this.emit('    LOAD D, [A-1]');
    this.emit('    SUB D, B');
    this.emit(`    BRP ${ok}`);
    this.emit(`${failLocal}:`);
    this.emit(`    LDA A, ${fail}`);
    this.emit('    JMP');
    this.emit(`${ok}:`);
    this.emitLoadA(6);
    this.emit('    LOAD A, [A+0]');
    this.emit('    ADD A, B');
    this.emit('    MOV D, A');
    this.emitLoadA(6);
    this.emit('    STORE D, [A+0]');
    this.emitLoadA(5);
    this.emit('    LOAD D, [A+0]');
    this.emitLoadA(6);
    this.emit('    LOAD A, [A+0]');
    this.emit('    STORE D, [A+0]');
    this.emit('    LDI D, 0');
    this.emit('    PUSH D');
  }
  ensureArrayBoundsHelper() {
    if(this.arrayBoundsHelperLabel) return this.arrayBoundsHelperLabel;
    const label='__ARRAY_BOUNDS_ERR206';
    const retLabel=`${label}$ret`;
    this.arrayBoundsHelperLabel=label;
    this.helperBlocks.push(
      `${label}:`,
      '    LDI D, 206',
      '    PUSH D',
      `    LDA D, ${retLabel}`,
      '    PUSH D',
      '    LDI A, 1',
      '    LOAD D, [A+0]',
      '    PUSH D',
      '    LDI A, 2',
      '    LOAD D, [A+0]',
      '    PUSH D',
      '    LDI A, 3',
      '    LOAD D, [A+0]',
      '    PUSH D',
      '    LDI A, 4',
      '    LOAD D, [A+0]',
      '    PUSH D',
      '    MOV D, SP',
      '    PUSH B',
      '    LDI B, 5',
      '    ADD D, B',
      '    LDI A, 2',
      '    STORE D, [A+0]',
      '    POP B',
      '    MOV D, SP',
      '    LDI A, 1',
      '    STORE D, [A+0]',
      '    LDA A, Sys.error',
      '    JMP',
      `${retLabel}:`,
      `    LDA A, ${retLabel}`,
      '    JMP'
    );
    return label;
  }
  trReturn() {
    this.emitLoadA(1); this.emit('    LOAD D, [A+0]'); this.emitLoadA(14); this.emit('    STORE D, [A+0]');
    this.emit('    MOV A, D'); this.emit('    LOAD D, [A+4]'); this.emitLoadA(13); this.emit('    STORE D, [A+0]');
    this.emit('    POP D'); this.emitLoadA(2); this.emit('    LOAD A, [A+0]'); this.emit('    STORE D, [A+0]');
    this.emitLoadA(2); this.emit('    LOAD D, [A+0]'); this.emit('    MOV SP, D');
    this.restoreFrame(0,4); this.restoreFrame(1,3); this.restoreFrame(2,2); this.restoreFrame(3,1);
    this.emitLoadA(13); this.emit('    LOAD A, [A+0]'); this.emit('    JMP');
  }
  pushFA(addr) { this.emitLoadA(addr); this.emit('    LOAD D, [A+0]'); this.emit('    PUSH D'); }
  restoreFrame(off,dest) { this.emitLoadA(14); this.emit('    LOAD A, [A+0]'); this.emit(`    LOAD D, [A+${off}]`); this.emitLoadA(dest); this.emit('    STORE D, [A+0]'); }
  ql(name) { return this.currentFunction?`${this.currentFunction}$${name}`:name; }
  ul(prefix) { return `_VM_${prefix}_${this.labelCount++}`; }
  emit(line) { this.output.push(line); }
  addError(ln,msg) { this.errors.push(`VM line ${ln}: ${msg}`); }
  cmdStr(c) { switch(c.type){case'arithmetic':return c.op;case'push':case'pop':return `${c.type} ${c.segment} ${c.index}`;case'label':case'goto':case'if-goto':return `${c.type} ${c.name}`;case'function':return `function ${c.name} ${c.nLocals}`;case'call':return `call ${c.name} ${c.nArgs}`;case'return':return 'return';case'halt':return 'halt';case'syscall':return `syscall ${c.nArgs}`;} }
}
