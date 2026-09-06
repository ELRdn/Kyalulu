/** Incremental SSE framing, independent of HTTP chunk/UTF-8 boundaries. */
export class SSEDecoder {
  private buffer = "";
  feed(chunk: string, eof = false): { event: string; data: string }[] {
    this.buffer += chunk;
    const events: { event: string; data: string }[] = [];
    const emit = (block: string) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) events.push({ event, data: data.join("\n") });
    };
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      emit(this.buffer.slice(0, match.index));
      this.buffer = this.buffer.slice(match.index + match[0].length);
    }
    if (eof && this.buffer) { emit(this.buffer); this.buffer = ""; }
    return events;
  }
}
