declare module 'pdf-parse/lib/pdf-parse.js' {
  const pdf: (data: Buffer, options?: { max?: number }) => Promise<{ text: string; numpages: number }>;
  export default pdf;
}
