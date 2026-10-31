type Frame={value:any;state:'keyOrEnd'|'key'|'colon'|'valueOrEnd'|'value'|'comma';key?:string;keep:boolean;index:number;messages:boolean};
export type MessageWindow={start?:number;limit:number};

/** Frame containers incrementally; validate discarded values without retaining them. */
// shortcut: metadata and retained scalar values stay whole; stream them before arbitrary-scalar capacity acceptance.
export class JsonStream {
  private decoder=new TextDecoder('utf-8',{fatal:true});
  private stack:Frame[]=[];
  private root:any;
  private hasRoot=false;
  private closed=false;
  private mode:''|'string'|'bare'='';
  private pieces:string[]=[];
  private escaped=false;
  private tokenKeep=true;
  private tokenState='';
  private unicode=0;
  private literal='';
  private literalIndex=0;
  private messageCount:number|undefined;
  private duplicateMessageIds=false;
  private window?:MessageWindow;
  private ids?:readonly number[];
  private onMessage?:(value:unknown,index:number)=>void;
  private outboxIndex?:number;
  private omitChangePayloads=false;
  // Callers must validate all parts and complete finish() successfully before accepting callback output.
  constructor(window?:MessageWindow|{ids:readonly number[]}|{onMessage:(value:unknown,index:number)=>void}|{omitChangePayloads:true}|{outboxChange:{index:number;onMessage:(value:unknown,index:number)=>void}}) {
    if(window&&'outboxChange' in window){
      const change=window.outboxChange;
      if(!change||!Number.isSafeInteger(change.index)||change.index<0)throw Error('Invalid outbox change index');
      if(typeof change.onMessage!=='function')throw Error('Invalid message callback');
      this.outboxIndex=change.index;this.onMessage=change.onMessage;
    }else if(window&&'omitChangePayloads' in window){
      if(window.omitChangePayloads!==true)throw Error('Invalid changes projection');this.omitChangePayloads=true;
    }else if(window&&'onMessage' in window){
      const onMessage=window.onMessage;
      if(typeof onMessage!=='function')throw Error('Invalid message callback');
      this.onMessage=onMessage;
    }else if(window&&'ids' in window){
      if(!Array.isArray(window.ids)||window.ids.length<1||window.ids.length>2)throw Error('Invalid message IDs');
      const ids=[...window.ids];
      if(ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)throw Error('Invalid message IDs');
      this.ids=ids;
    }else{
      if(window&&(!Number.isSafeInteger(window.limit)||window.limit<0||window.start!==undefined&&(!Number.isSafeInteger(window.start)||window.start<0)))throw Error('Invalid message window');
      this.window=window&&{...window};
    }
  }
  get totalMessages(){return this.messageCount;}
  private invalid():never {throw Error('Invalid streamed JSON');}

  private messageObject() {
    const frame=this.stack.at(-1);
    // Array parents advance their index before the child frame is pushed.
    return !!frame&&!Array.isArray(frame.value)&&(this.outboxIndex===undefined?this.stack.length===1:
      this.stack.length===3&&Array.isArray(this.stack[0].value)&&this.stack[0].index-1===this.outboxIndex
      &&!Array.isArray(this.stack[1].value)&&this.stack[1].key==='payload');
  }
  private keepValue() {
    const frame=this.stack.at(-1);
    if(this.outboxIndex!==undefined&&this.stack.length===2&&Array.isArray(this.stack[0].value)
      &&this.stack[0].index-1!==this.outboxIndex&&!Array.isArray(frame!.value)&&frame!.key==='payload')return false;
    if(this.omitChangePayloads&&this.stack.length===3&&this.stack[0].key==='changes'
      &&Array.isArray(this.stack[1].value)&&!Array.isArray(frame!.value)&&frame!.key==='payload')return false;
    return !frame||frame.keep&&(!frame.messages||!!this.ids||!!this.onMessage||this.window!.limit>0&&(this.window!.start===undefined
      ||frame.index>=this.window!.start&&frame.index-this.window!.start<this.window!.limit));
  }
  private piece(text:string) {
    if(this.tokenKeep){this.pieces.push(text);return;}
    for(const char of text){
      if(this.mode==='string'){
        if(this.unicode){if(!/[0-9a-f]/i.test(char))this.invalid();if(!--this.unicode)this.tokenState='body';continue;}
        if(this.tokenState==='start'){if(char!=='"')this.invalid();this.tokenState='body';}
        else if(this.tokenState==='body'){
          if(char==='"')this.tokenState='end';else if(char==='\\')this.tokenState='escape';else if(char.charCodeAt(0)<32)this.invalid();
        }else if(this.tokenState==='escape'){
          if(char==='u')this.unicode=4;else if('"\\/bfnrt'.includes(char))this.tokenState='body';else this.invalid();
        }else this.invalid();
      }else{
        const digit=char>='0'&&char<='9',nonzero=digit&&char!=='0';
        if(this.tokenState==='start'){
          this.literal=char==='t'?'true':char==='f'?'false':char==='n'?'null':'';this.literalIndex=1;
          this.tokenState=this.literal?'literal':char==='-'?'minus':char==='0'?'zero':nonzero?'int':'';
        }else if(this.tokenState==='literal'){
          if(char!==this.literal[this.literalIndex++])this.invalid();
        }else if(this.tokenState==='minus')this.tokenState=char==='0'?'zero':nonzero?'int':'';
        else if(this.tokenState==='zero')this.tokenState=char==='.'?'dot':/[eE]/.test(char)?'exp':'';
        else if(this.tokenState==='int')this.tokenState=digit?'int':char==='.'?'dot':/[eE]/.test(char)?'exp':'';
        else if(this.tokenState==='dot')this.tokenState=digit?'frac':'';
        else if(this.tokenState==='frac')this.tokenState=digit?'frac':/[eE]/.test(char)?'exp':'';
        else if(this.tokenState==='exp')this.tokenState=char==='+'||char==='-'?'sign':digit?'digits':'';
        else if(this.tokenState==='sign'||this.tokenState==='digits')this.tokenState=digit?'digits':'';
        else this.invalid();
        if(!this.tokenState)this.invalid();
      }
    }
  }
  private begin(mode:'string'|'bare',char:string) {
    const frame=this.stack.at(-1);
    this.tokenKeep=frame&&(frame.state==='key'||frame.state==='keyOrEnd')?frame.keep:this.keepValue()&&!(frame?.messages&&this.ids);
    this.mode=mode;this.pieces=[];this.tokenState='start';this.unicode=0;this.literal='';this.literalIndex=0;this.piece(char);
  }

  feed(bytes:Uint8Array) {
    if(this.closed)this.invalid();
    try{this.text(this.decoder.decode(bytes,{stream:true}));}catch(error){this.closed=true;throw error;}
  }
  finish():any {
    if(this.closed)this.invalid();this.closed=true;this.text(this.decoder.decode());
    if(this.mode==='bare')this.scalar();
    if(this.mode||this.stack.length||!this.hasRoot)this.invalid();
    if(this.duplicateMessageIds)throw Error('Duplicate message ID');
    return this.root;
  }
  private value(value:any) {
    const frame=this.stack.at(-1);
    if(!frame){if(this.hasRoot)this.invalid();this.root=value;this.hasRoot=true;return;}
    if(frame.state!=='value'&&frame.state!=='valueOrEnd')this.invalid();
    if(this.messageObject()&&frame.key==='messages'){this.messageCount=undefined;this.duplicateMessageIds=false;}
    if(Array.isArray(frame.value)){
      if(this.keepValue()&&!(frame.messages&&(this.ids||this.onMessage))){
        frame.value.push(value);
        if(frame.messages&&this.window!.start===undefined&&frame.value.length>this.window!.limit)frame.value.shift();
      }
      if(!Number.isSafeInteger(++frame.index))this.invalid();
    }
    // JSON.parse treats __proto__ as an own data property, never a prototype setter.
    else if(frame.keep)Object.defineProperty(frame.value,frame.key!,{value,enumerable:true,writable:true,configurable:true});
    frame.state='comma';
  }
  private scalar() {
    if(!this.tokenKeep&&(this.mode==='string'?this.tokenState!=='end'||this.unicode>0:
      !['zero','int','frac','digits'].includes(this.tokenState)&&!(this.tokenState==='literal'&&this.literalIndex===this.literal.length)))this.invalid();
    const value=this.tokenKeep?JSON.parse(this.pieces.join('')):this.mode==='string'?'':undefined;this.pieces=[];this.mode='';
    const frame=this.stack.at(-1);
    if(frame&&(frame.state==='key'||frame.state==='keyOrEnd')){
      if(typeof value!=='string')this.invalid();
      if(this.onMessage&&this.messageObject()&&value==='messages'&&Object.hasOwn(frame.value,'messages'))throw Error('Duplicate root messages key');
      frame.key=value;frame.state='colon';
    }else{
      this.value(!this.tokenKeep&&this.outboxIndex!==undefined?undefined:value);
      if(this.onMessage&&frame?.messages)this.onMessage(value,frame.index-1);
    }
  }
  private punctuation(char:string) {
    const frame=this.stack.at(-1);
    if(char==='{'||char==='['){
      if(this.stack.length>=64)this.invalid();
      const keep=this.keepValue()&&!(frame?.messages&&this.ids&&char==='['),messages=!!(this.window||this.ids||this.onMessage)&&this.messageObject()&&frame!.key==='messages'&&char==='[';
      const value=char==='{'?{}:[];this.value(value);
      this.stack.push({value,state:char==='{'?'keyOrEnd':'valueOrEnd',keep,index:0,messages});return;
    }
    if(char==='}'||char===']'){
      if(!frame||Array.isArray(frame.value)!==(char===']')||!['comma',char==='}'?'keyOrEnd':'valueOrEnd'].includes(frame.state))this.invalid();
      if(frame.messages)this.messageCount=frame.index;
      this.stack.pop();
      const parent=this.stack.at(-1);
      if(this.onMessage&&parent?.messages)this.onMessage(frame.value,parent.index-1);
      // A message's final id is only known after its object closes (duplicate keys use the last value).
      if(this.ids&&parent?.messages&&char==='}'&&Object.hasOwn(frame.value,'id')&&this.ids.includes(frame.value.id)){
        if(parent.value.some((message:any)=>message.id===frame.value.id))this.duplicateMessageIds=true;
        else parent.value.push(frame.value);
      }
      return;
    }
    if(char===':'&&frame?.state==='colon'){frame.state='value';return;}
    if(char===','&&frame?.state==='comma'){frame.state=Array.isArray(frame.value)?'value':'key';return;}
    this.invalid();
  }
  private text(text:string) {
    let offset=0;
    while(offset<text.length){
      if(this.mode==='string'){
        if(this.escaped){this.piece(text[offset++]);this.escaped=false;continue;}
        const boundary=/["\\]/g;boundary.lastIndex=offset;const match=boundary.exec(text);
        if(!match){this.piece(text.slice(offset));return;}
        this.piece(text.slice(offset,match.index+1));offset=match.index+1;
        if(match[0]==='\\')this.escaped=true;else this.scalar();
      }else if(this.mode==='bare'){
        const boundary=/[ \t\r\n{}\[\],:"]/g;boundary.lastIndex=offset;const match=boundary.exec(text);
        if(!match){this.piece(text.slice(offset));return;}
        this.piece(text.slice(offset,match.index));offset=match.index;this.scalar();
      }else{
        const char=text[offset++];
        if(/[ \t\r\n]/.test(char))continue;
        if('{}[],:'.includes(char))this.punctuation(char);
        else if(char==='"')this.begin('string',char);
        else this.begin('bare',char);
      }
    }
  }
}
