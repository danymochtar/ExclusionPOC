import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No PDF file provided. Upload as multipart field 'file'." },
        { status: 400 }
      );
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: `Expected a PDF, got ${file.type}.` },
        { status: 400 }
      );
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF is too large (max 10 MB)." },
        { status: 413 }
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No selectable text found in the PDF (is it a scan?)." },
        { status: 422 }
      );
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("extract failed", err);
    return NextResponse.json(
      { error: "Failed to extract text from the PDF." },
      { status: 500 }
    );
  }
}
