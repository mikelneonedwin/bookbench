import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function generateCover() {
  const doc = await PDFDocument.create();
  // Standard A4: 595.28 x 841.89
  const page = doc.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const height = page.getHeight();

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Outer border
  page.drawRectangle({
    x: 25,
    y: 25,
    width: width - 50,
    height: height - 50,
    borderWidth: 2,
    borderColor: rgb(0.15, 0.2, 0.3),
  });

  // Inner decorative border
  page.drawRectangle({
    x: 30,
    y: 30,
    width: width - 60,
    height: height - 60,
    borderWidth: 0.75,
    borderColor: rgb(0.3, 0.4, 0.5),
  });

  // Top header banner background
  page.drawRectangle({
    x: 35,
    y: height - 120,
    width: width - 70,
    height: 80,
    color: rgb(0.93, 0.95, 0.98),
  });

  // Header texts
  const uniTitle = "FACULTY OF PHYSICAL SCIENCES";
  const uniWidth = fontBold.widthOfTextAtSize(uniTitle, 16);
  page.drawText(uniTitle, {
    x: (width - uniWidth) / 2,
    y: height - 70,
    size: 16,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.25),
  });

  const deptTitle = "DEPARTMENT OF COMPUTER SCIENCE";
  const deptWidth = fontBold.widthOfTextAtSize(deptTitle, 13);
  page.drawText(deptTitle, {
    x: (width - deptWidth) / 2,
    y: height - 90,
    size: 13,
    font: fontBold,
    color: rgb(0.2, 0.3, 0.45),
  });

  const sessionText = "2025/2026 ACADEMIC SESSION";
  const sessionWidth = fontRegular.widthOfTextAtSize(sessionText, 10);
  page.drawText(sessionText, {
    x: (width - sessionWidth) / 2,
    y: height - 108,
    size: 10,
    font: fontRegular,
    color: rgb(0.4, 0.45, 0.5),
  });

  // Course Title Block
  const courseCode = "CSC 201";
  const courseCodeWidth = fontBold.widthOfTextAtSize(courseCode, 28);
  page.drawText(courseCode, {
    x: (width - courseCodeWidth) / 2,
    y: height - 200,
    size: 28,
    font: fontBold,
    color: rgb(0.12, 0.22, 0.4),
  });

  const courseTitle = "DATA STRUCTURES & ALGORITHMS";
  const courseTitleWidth = fontBold.widthOfTextAtSize(courseTitle, 18);
  page.drawText(courseTitle, {
    x: (width - courseTitleWidth) / 2,
    y: height - 230,
    size: 18,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.2),
  });

  const manualType = "PRACTICAL LAB MANUAL & COURSE WORKBOOK";
  const manualTypeWidth = fontBold.widthOfTextAtSize(manualType, 12);
  page.drawText(manualType, {
    x: (width - manualTypeWidth) / 2,
    y: height - 252,
    size: 12,
    font: fontBold,
    color: rgb(0.35, 0.4, 0.45),
  });

  // Divider Line
  page.drawLine({
    start: { x: 70, y: height - 275 },
    end: { x: width - 70, y: height - 275 },
    thickness: 1,
    color: rgb(0.75, 0.8, 0.85),
  });

  // Instructions section
  page.drawText("IMPORTANT STUDENT NOTICE & INSTRUCTIONS", {
    x: 50,
    y: height - 320,
    size: 11,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });

  const instructions = [
    "1. This laboratory manual is uniquely assigned and serialized to an enrolled student.",
    "2. Scan the verification QR code at the bottom of this page to claim ownership in Modools.",
    "3. Do not detach or deface the QR code or registration number stamp.",
    "4. Present this manual at all designated practical sessions and assessments.",
    "5. Return this completed workbook to your instructor at the conclusion of the semester.",
  ];

  let currentY = height - 345;
  for (const line of instructions) {
    page.drawText(line, {
      x: 55,
      y: currentY,
      size: 9.5,
      font: fontRegular,
      color: rgb(0.25, 0.25, 0.3),
    });
    currentY -= 20;
  }

  // Student details container box
  page.drawRectangle({
    x: 50,
    y: height - 570,
    width: width - 100,
    height: 100,
    borderWidth: 1,
    borderColor: rgb(0.8, 0.85, 0.9),
    color: rgb(0.98, 0.99, 1.0),
  });

  page.drawText("STUDENT VERIFICATION PROFILE", {
    x: 65,
    y: height - 490,
    size: 10,
    font: fontBold,
    color: rgb(0.2, 0.3, 0.5),
  });

  page.drawText("Full Name: ____________________________________________________", {
    x: 65,
    y: height - 515,
    size: 9.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.45),
  });

  page.drawText("Department: ________________________  Level / Group: _____________", {
    x: 65,
    y: height - 540,
    size: 9.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.45),
  });

  page.drawText("Submission Date: ___________________  Instructor Signature: ________", {
    x: 65,
    y: height - 565,
    size: 9.5,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.45),
  });

  // Footer notes & placeholder area indication
  page.drawText("Official Security Stamp & Verification Seal Area Below", {
    x: 50,
    y: 190,
    size: 8.5,
    font: fontOblique,
    color: rgb(0.55, 0.6, 0.65),
  });

  page.drawLine({
    start: { x: 50, y: 180 },
    end: { x: width - 50, y: 180 },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.9),
  });

  // Bottom copyright note
  const footerText = "Generated by Modools Academic Platform — All Rights Reserved";
  const footerWidth = fontRegular.widthOfTextAtSize(footerText, 8);
  page.drawText(footerText, {
    x: (width - footerWidth) / 2,
    y: 38,
    size: 8,
    font: fontRegular,
    color: rgb(0.5, 0.55, 0.6),
  });

  const pdfBytes = await doc.save();
  const assetsDir = join(import.meta.dir, "..", "assets");
  await mkdir(assetsDir, { recursive: true });
  const targetPath = join(assetsDir, "cover-template.pdf");
  await writeFile(targetPath, pdfBytes);
  console.info(`✅ Generated static cover template: ${targetPath} (${pdfBytes.length} bytes)`);
}

generateCover().catch((err) => {
  console.error("Failed to generate cover:", err);
  process.exit(1);
});
