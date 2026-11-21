// PDF / Word / Markdown → plain text (owner: Person C, C3). README §2.1.
// The text is stored on the project and read once by the plan prompt.
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export type SpecKind = "pdf" | "word" | "markdown";

export class SpecError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

/** Works out the file type from its extension, then its MIME type. */
export function specKindOf(filename: string, mimetype = ""): SpecKind | undefined {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mimetype === "application/pdf") return "pdf";
  if (ext === "docx" || mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "word";
  if (["md", "markdown", "txt"].includes(ext) || mimetype.startsWith("text/")) return "markdown";
  return undefined;
}

/** Collapses the extra blank lines and trailing spaces extraction tends to leave behind. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractSpecText(file: { buffer: Buffer; originalname: string; mimetype?: string }): Promise<string> {
  const kind = specKindOf(file.originalname, file.mimetype);
  if (!kind) {
    throw new SpecError(
      file.originalname.toLowerCase().endsWith(".doc")
        ? "Old .doc files aren't supported. Save it as .docx or PDF and try again."
        : "Upload the spec as a PDF, Word (.docx) or Markdown file.",
      415,
    );
  }

  let text: string;
  try {
    if (kind === "pdf") text = (await pdfParse(file.buffer)).text;
    else if (kind === "word") text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
    else text = file.buffer.toString("utf8").replace(/^﻿/, "");
  } catch {
    throw new SpecError(`Couldn't read that ${kind === "word" ? "Word" : kind === "pdf" ? "PDF" : "text"} file. Is it damaged or password-protected?`);
  }

  const clean = tidy(text);
  if (!clean) {
    throw new SpecError(
      kind === "pdf"
        ? "No text found in that PDF. It may be a scanned image: export it with selectable text, or upload a Word or Markdown version."
        : "That file is empty.",
    );
  }
  return clean;
}
