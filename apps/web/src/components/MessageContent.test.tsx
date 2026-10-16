import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MessageContent from "./MessageContent";

describe("RP message display", () => {
  it("shows assistant thoughts and actions inside the character bubble", () => {
    const html = renderToStaticMarkup(<MessageContent content={"@キャルル:\n*カップを置く*\n\n*（もう少し話していたい）*\n\nもう一杯、飲む？"} />);
    expect(html).toContain('class="k-bubble k-bubble--character"');
    expect(html).toContain('class="k-msg__name">キャルル</span>');
    expect(html).toContain('<em class="md-action">（もう少し話していたい）</em>');
    expect(html).toContain('カップを置く');
    expect(html).not.toContain('class="k-narration"');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('@キャルル:');
  });

  it("creates one narrator block only for an explicit marker", () => {
    const html = renderToStaticMarkup(<MessageContent content={"@アキ: *手を振る*\n@: *雨が降る*\n@アキ: *（帰りたいな）*"} />);
    expect(html.match(/class="k-narration"/g)).toHaveLength(1);
    expect(html.match(/class="k-bubble k-bubble--character"/g)).toHaveLength(2);
    expect(html).toContain('（帰りたいな）');
    expect(html).not.toContain('@:');
  });
});
