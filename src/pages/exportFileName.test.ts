import { describe, expect, it } from "vitest";
import { exportFileName } from "./PatternDetail";

describe("書き出すときのファイル名", () => {
  it("拡張子を補い、使えない文字を置き換える", () => {
    expect(exportFileName({ name: "Cable Cardigan", mimeType: "application/pdf" })).toBe("Cable Cardigan.pdf");
    expect(exportFileName({ name: "日本語訳.pdf", mimeType: "application/pdf" })).toBe("日本語訳.pdf");
    expect(exportFileName({ name: "a/b:c?.PDF", mimeType: "application/pdf" })).toBe("a_b_c_.PDF");
    expect(exportFileName({ name: "chart.jpeg", mimeType: "image/jpeg" })).toBe("chart.jpeg");
    expect(exportFileName({ name: String.raw`back\slash`, mimeType: "image/png" })).toBe("back_slash.png");
    expect(exportFileName({ name: "  ", mimeType: "application/pdf" })).toBe("file.pdf");
  });
});
