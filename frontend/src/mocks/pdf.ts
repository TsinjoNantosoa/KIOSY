/**
 * Générateur PDF minimal (texte seul, Helvetica, WinAnsi) pour les éditions PDF de démonstration.
 * Évite de placer des fichiers PDF dans /public : le document est produit en mémoire
 * uniquement après contrôle d'accès, puis servi via une URL blob de courte durée.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const LINE_HEIGHT = 16;
const MAX_CHARS = 86;

function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[^\x20-\xFF\n]/g, "?");
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(line: string): string[] {
  if (line.length <= MAX_CHARS) return [line];
  const words = line.split(" ");
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > MAX_CHARS) {
      out.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) out.push(current);
  return out;
}

interface Line {
  text: string;
  heading: boolean;
}

export function buildPdf(title: string, markdown: string, footer: string): Uint8Array {
  const lines: Line[] = [{ text: title, heading: true }, { text: "", heading: false }];
  for (const raw of markdown.split("\n")) {
    const heading = /^#{1,3}\s/.test(raw);
    const clean = raw.replace(/^#{1,3}\s/, "").replace(/\*\*|__|\*/g, "");
    for (const part of wrap(toWinAnsi(clean))) lines.push({ text: part, heading });
  }

  const perPage = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT) - 2;
  const pages: Line[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  // 1: catalog, 2: pages, 3: font regular, 4: font bold ; ensuite paires page/contenu.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  let nextId = 5;
  pages.forEach((pageLines, index) => {
    const pageId = nextId++;
    const contentId = nextId++;
    pageObjectIds.push(pageId);
    let y = PAGE_HEIGHT - MARGIN;
    const ops: string[] = ["BT"];
    for (const line of pageLines) {
      ops.push(`/${line.heading ? "F2" : "F1"} ${line.heading ? 13 : 11} Tf`);
      ops.push(`1 0 0 1 ${MARGIN} ${y} Tm (${escapePdf(line.text)}) Tj`);
      y -= LINE_HEIGHT;
    }
    ops.push("/F1 8 Tf");
    ops.push(`1 0 0 1 ${MARGIN} ${MARGIN - 20} Tm (${escapePdf(toWinAnsi(`${footer} - page ${index + 1}/${pages.length}`))}) Tj`);
    ops.push("ET");
    const stream = ops.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < nextId; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let id = 1; id < nextId; id += 1) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
