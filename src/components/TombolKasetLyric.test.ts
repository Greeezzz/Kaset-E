import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TombolKasetLyric } from "./TombolKasetLyric";
import { T } from "../lib/strings";

/** Render statis: cukup untuk memastikan label, tooltip, dan ARIA ada. */
function render(props: Parameters<typeof TombolKasetLyric>[0] = {}) {
  return renderToStaticMarkup(createElement(TombolKasetLyric, props));
}

describe("TombolKasetLyric", () => {
  it("merender tombol dengan label dan tooltip bahasa Indonesia", () => {
    const html = render();

    expect(html).toContain(`>${T.kasetlyricTombol}<`);
    expect(html).toContain(`title="${T.kasetlyricTip}"`);
    expect(html).toContain(`aria-label="${T.kasetlyricTip}"`);
    expect(html).toContain('type="button"');
  });

  it("memakai gaya tombol Kaset, bukan gaya baru", () => {
    expect(render()).toContain('class="k-btn k-btn-quiet"');
    expect(render({ variant: "utama" })).toContain('class="k-btn k-btn-accent"');
  });

  it("setinggi tombol lirik lain (28 px), bukan 44 px", () => {
    expect(render()).toContain("height:28px");
    expect(render()).toContain("font-size:10px");
  });
});
