type Frame={value:any;state:'keyOrEnd'|'key'|'colon'|'valueOrEnd'|'value'|'comma';key?:string};

/** Frame containers incrementally; platform JSON.parse validates each scalar. */
// shortcut: decoded trees and scalar tokens stay whole; segment storage before 1 GB acceptance.
export class JsonStream {
  private decoder=new TextDecoder('utf-8',{fatal:true});
  private stack:Frame[]=[];
  private root:any;
  private hasRoot=false;
  private closed=false;
  private mode:''|'string'|'bare'='';
  private pieces:string[]=[];
  private escaped=false;
  private invalid():never {throw Error('Invalid streamed JSON');}

  feed(bytes:Uint8Array) {
    if(this.closed)this.invalid();
    try{this.text(this.decoder.decode(bytes,{stream:true}));}catch(error){this.closed=true;throw error;}
  }
  finish():any {
    if(this.closed)this.invalid();this.closed=true;this.text(this.decoder.decode());
    if(this.mode==='bare')this.scalar();
    if(this.mode||this.stack.length||!this.hasRoot)this.invalid();
    return this.root;
  }
  private value(value:any) {
    const frame=this.stack.at(-1);
    if(!frame){if(this.hasRoot)this.invalid();this.root=value;this.hasRoot=true;return;}
    if(frame.state!=='value'&&frame.state!=='valueOrEnd')this.invalid();
    if(Array.isArray(frame.value))frame.value.push(value);
    // JSON.parse treats __proto__ as an own data property, never a prototype setter.
    else Object.defineProperty(frame.value,frame.key!,{value,enumerable:true,writable:true,configurable:true});
    frame.state='comma';
  }
  private scalar() {
    const value=JSON.parse(this.pieces.join(''));this.pieces=[];this.mode='';
    const frame=this.stack.at(-1);
    if(frame&&(frame.state==='key'||frame.state==='keyOrEnd')){
      if(typeof value!=='string')this.invalid();frame.key=value;frame.state='colon';
    }else this.value(value);
  }
  private punctuation(char:string) {
    const frame=this.stack.at(-1);
    if(char==='{'||char==='['){
      if(this.stack.length>=64)this.invalid();
      const value=char==='{'?{}:[];this.value(value);
      this.stack.push({value,state:char==='{'?'keyOrEnd':'valueOrEnd'});return;
    }
    if(char==='}'||char===']'){
      if(!frame||Array.isArray(frame.value)!==(char===']')||!['comma',char==='}'?'keyOrEnd':'valueOrEnd'].includes(frame.state))this.invalid();
      this.stack.pop();return;
    }
    if(char===':'&&frame?.state==='colon'){frame.state='value';return;}
    if(char===','&&frame?.state==='comma'){frame.state=Array.isArray(frame.value)?'value':'key';return;}
    this.invalid();
  }
  private text(text:string) {
    let offset=0;
    while(offset<text.length){
      if(this.mode==='string'){
        if(this.escaped){this.pieces.push(text[offset++]);this.escaped=false;continue;}
        const boundary=/["\\]/g;boundary.lastIndex=offset;const match=boundary.exec(text);
        if(!match){this.pieces.push(text.slice(offset));return;}
        this.pieces.push(text.slice(offset,match.index+1));offset=match.index+1;
        if(match[0]==='\\')this.escaped=true;else this.scalar();
      }else if(this.mode==='bare'){
        const boundary=/[ \t\r\n{}\[\],:"]/g;boundary.lastIndex=offset;const match=boundary.exec(text);
        if(!match){this.pieces.push(text.slice(offset));return;}
        this.pieces.push(text.slice(offset,match.index));offset=match.index;this.scalar();
      }else{
        const char=text[offset++];
        if(/[ \t\r\n]/.test(char))continue;
        if('{}[],:'.includes(char))this.punctuation(char);
        else if(char==='"'){this.mode='string';this.pieces=['"'];}
        else{this.mode='bare';this.pieces=[char];}
      }
    }
  }
}
