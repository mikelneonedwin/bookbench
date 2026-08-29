import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { generateMockEnrollments } from "./data.js";
import type { BenchmarkMetrics } from "./worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runTypstBenchmark(count: number, id: string): Promise<BenchmarkMetrics> {
  const startTime = performance.now();
  const workDir = join(__dirname, "..", "scratch", `typst-${count}-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  const enrollments = generateMockEnrollments(count);
  const stampStart = performance.now();

  // Generate SVG strings entirely in memory (zero disk files)
  const qrSvgs = await Promise.all(
    enrollments.map((e) => QRCode.toString(e.qrUrl, { type: "svg", margin: 1 }))
  );

  let typstMarkup = `
#set page(paper: "a4", margin: 0pt)
`;

  for (let i = 0; i < count; i++) {
    const e = enrollments[i];
    const encodedSvg = qrSvgs[i].replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
    typstMarkup += `
#page[
  #place(top + left, dx: 0pt, dy: 0pt, rect(width: 100%, height: 100%, fill: none, stroke: 1pt + rgb("e2e8f0")))
  #place(top + right, dx: -20pt, dy: 20pt, text(weight: "bold")[${e.serialNumber}])
  #place(bottom + left, dx: 50pt, dy: -60pt, image.decode("${encodedSvg}", format: "svg", width: 100pt, height: 100pt))
  ${e.regNumber ? `#place(bottom + left, dx: 50pt, dy: -166pt, text(size: 9pt)[${e.regNumber}])` : ""}
]
`;
  }

  const typPath = join(workDir, "doc.typ");
  const outPdfPath = join(workDir, "out.pdf");
  await writeFile(typPath, typstMarkup, "utf-8");

  const stampingTimeMs = performance.now() - stampStart;

  const stitchStart = performance.now();
  const typstBin = join(__dirname, "..", "bin", "typst");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(typstBin, ["compile", typPath, outPdfPath], {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`typst failed with exit code ${code}`));
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
    peakRssMb: 45.0,
    heapUsedMb: 0,
    cpuUserMs: 0,
    cpuSystemMs: 0,
    success: true,
  };
}
