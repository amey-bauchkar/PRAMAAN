export type Ctx = CanvasRenderingContext2D;

/** Rounded rectangle path. */
export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Draws text wrapped to a width and returns the y of the line after the last one. */
export function wrapText(c: Ctx, text: string, x: number, y: number, maxW: number, lh: number): number {
  let line = '';
  let yy = y;
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxW && line) { c.fillText(line, x, yy); line = word; yy += lh; } else line = test;
  }
  if (line) { c.fillText(line, x, yy); yy += lh; }
  return yy;
}

/** The site font as the browser resolved it, loaded and ready for canvas drawing. */
export async function siteFont(): Promise<string> {
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  try {
    await Promise.all([300, 400, 500].map(w => document.fonts.load(`${w} 40px ${font}`)));
    await document.fonts.ready;
  } catch { /* draw with whatever font is available */ }
  return font;
}
