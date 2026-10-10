// E2E 用のサンプル PDF を生成する（外部ファイルに依存しない）
export function makePdf(title, pages) {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const catalog = add(""); // 後で埋める
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let i = 1; i <= pages; i++) {
    const text = `BT /F1 36 Tf 72 720 Td (${title} - Page ${i}) Tj ET 0.8 0.5 0.4 rg 72 200 451 ${300 + i * 10} re f`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(
      add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;

  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
