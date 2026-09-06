import { describe, expect, it } from "vitest";
import { SSEDecoder } from "./sse";

describe("SSE framing", () => {
  it("handles every CRLF and Japanese byte boundary", () => {
    const bytes = new TextEncoder().encode(': ping\r\n\r\nevent: token\r\ndata: {"token":"日本😀"}\r\n\r\nevent: done\r\ndata: {"full":"日本😀"}\r\n\r\n');
    for (let cut = 1; cut < bytes.length; cut++) {
      const utf8 = new TextDecoder();
      const parser = new SSEDecoder();
      const events = [...parser.feed(utf8.decode(bytes.slice(0, cut), { stream: true })),
        ...parser.feed(utf8.decode(bytes.slice(cut)), true)];
      expect(events.map(x => x.event)).toEqual(["token", "done"]);
      expect(JSON.parse(events[0].data).token).toBe("日本😀");
    }
  });
  it("handles multiline data and final frame", () => {
    expect(new SSEDecoder().feed('event: reset\ndata: {\ndata: "full":""}', true))
      .toEqual([{ event: "reset", data: '{\n"full":""}' }]);
  });
});
