// pdf-parse ships no types. We import its inner module: the package's index.js runs a debug
// self-test (reading a sample PDF from disk) when it isn't required from another CommonJS module.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfResult {
    numpages: number;
    text: string;
  }
  function pdfParse(data: Buffer): Promise<PdfResult>;
  export default pdfParse;
}
