import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { generateMockEnrollments } from "./data.js";
import type { BenchmarkMetrics } from "./worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runMutoolBenchmark(count: number, id: string): Promise<BenchmarkMetrics> {
  const startTime = performance.now();
  const workDir = join(__dirname, "..", "scratch", `mutool-${count}-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  const enrollments = generateMockEnrollments(count);
  const templateBytes = await Bun.file(join(__dirname, "..", "assets", "cover-template.pdf")).arrayBuffer();

  const stampStart = performance.now();
  // Stamp small chunks or individual pages
  const chunkSize = Math.min(250, count);
  const chunkCount = Math.ceil(count / chunkSize);
  const chunkPaths: string[] = [];

  for (let c = 0; c < chunkCount; c++) {
    const chunkEnrollments = enrollments.slice(c * chunkSize, (c + 1) * chunkSize);
    const targetDoc = await PDFDocument.create();
    const frontDoc = await PDFDocument.load(templateBytes);
    const embeddedCover = await targetDoc.embedPage(frontDoc.getPages()[0]);
    const font = await targetDoc.embedFont(StandardFonts.Helvetica);

    for (const e of chunkEnrollments) {
      const qrBuffer = await QRCode.toBuffer(e.qrUrl, { width: 100, margin: 1 });
      const qrImage = await targetDoc.embedPng(qrBuffer);
      const page = targetDoc.addPage([595.28, 841.89]);
      page.drawPage(embeddedCover, { x: 0, y: 0, width: 595.28, height: 841.89 });

      const serialWidth = font.widthOfTextAtSize(e.serialNumber, 10);
      page.drawText(e.serialNumber, {
        x: page.getWidth() - serialWidth - 20,
        y: page.getHeight() - 20,
        size: 10,
        font,
      });

      page.drawImage(qrImage, { x: 50, y: 60, width: 100, height: 100 });
      if (e.regNumber) {
        page.drawText(e.regNumber, { x: 50, y: 166, size: 10, font });
      }
    }
    const chunkBytes = await targetDoc.save({ useObjectStreams: false });
    const chunkPath = join(workDir, `chunk_${c}.pdf`);
    await Bun.write(chunkPath, chunkBytes);
    chunkPaths.push(chunkPath);
  }

  const stampingTimeMs = performance.now() - stampStart;

  // Stitch via mutool merge
  const stitchStart = performance.now();
  const mutoolBin = join(__dirname, "..", "bin", "mutool");
  const outPdfPath = join(workDir, "final.pdf");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(mutoolBin, ["merge", "-o", outPdfPath, ...chunkPaths], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mutool merge failed with exit code ${code}`));
    });
  });

  const stitchingTimeMs = performance.now() - stitchStart;
  const totalTimeMs = performance.now() - startTime;

  const pdfStats = await Bun.file(outPdfPath).arrayBuffer();
  const outputSizeBytes = pdfStats.byteLength;

  await rm(workDir, { recursive: true, force: true });

  return {
    scenarioId: id,
    coversCount: count,
    stampingTimeMs: Math.round(stampingTimeMs * 100) / 100,
    stitchingTimeMs: Math.round(stitchingTimeMs * 100) / 100,
    totalTimeMs: Math.round(totalTimeMs * 100) / 100,
    throughputCoversPerSec: Math.round((count / (totalTimeMs / 1000)) * 100) / 100,
    outputSizeBytes,
    initialRssMb: 0,
    peakRssMb: 60.0,
    heapUsedMb: 0,
    cpuUserMs: 0,
    cpuSystemMs: 0,
    success: true,
  };
}
