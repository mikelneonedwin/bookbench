import { PDFDocument, PDFEmbeddedPage, PDFFont, PDFPage } from "pdf-lib";
import QRCode from "qrcode";

export interface StampedPageOptions {
  targetDoc: PDFDocument;
  embeddedCover: PDFEmbeddedPage;
  font: PDFFont;
  qrX: number;
  qrY: number;
  serialNumber: string;
  qrUrl: string;
  regNumber?: string | null;
}

export async function createStampedCoverPage(options: StampedPageOptions): Promise<PDFPage> {
  const { targetDoc, embeddedCover, font, qrX, qrY, serialNumber, qrUrl, regNumber } = options;

  // Generate unique QR code for this specific student/cover
  const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 100, margin: 1 });
  const qrImage = await targetDoc.embedPng(qrBuffer);

  // Add new page referencing the shared Form XObject background
  const page = targetDoc.addPage([595.28, 841.89]);
  page.drawPage(embeddedCover, {
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89,
  });

  // Top-right serial number
  const serialWidth = font.widthOfTextAtSize(serialNumber, 10);
  page.drawText(serialNumber, {
    x: page.getWidth() - serialWidth - 20,
    y: page.getHeight() - 20,
    size: 10,
    font,
  });

  // QR code (100 x 100 points)
  page.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: 100,
    height: 100,
  });

  // Registration number above QR code
  if (regNumber) {
    page.drawText(regNumber, {
      x: qrX,
      y: qrY + 106,
      size: 10,
      font,
    });
  }

  return page;
}
