import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { generateMockEnrollments } from "./data.js";
import { createStampedCoverPage } from "./stamp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BenchmarkMetrics {
  scenarioId: string;
  coversCount: number;
  stampingTimeMs: number;
  stitchingTimeMs: number;
  totalTimeMs: number;
  throughputCoversPerSec: number;
  outputSizeBytes: number;
  initialRssMb: number;
  peakRssMb: number;
  heapUsedMb: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  success: boolean;
  error?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let count = 50;
  let id = "benchmark";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--id" && args[i + 1]) {
      id = args[i + 1];
      i++;
    }
  }
  return { count, id };
}

async function runWorker() {
  const { count, id } = parseArgs();
  const startCpu = process.cpuUsage();
  const startTime = performance.now();

  let peakRssBytes = process.memoryUsage().rss;
  const initialRssMb = peakRssBytes / (1024 * 1024);

  const memSampler = setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.rss > peakRssBytes) {
      peakRssBytes = mem.rss;
    }
  }, 10);

  try {
    const templatePath = join(__dirname, "..", "assets", "cover-template.pdf");
    const templateBytes = await readFile(templatePath);

    const enrollments = generateMockEnrollments(count);

    const frontDoc = await PDFDocument.load(templateBytes);
    const targetDoc = await PDFDocument.create();

    // Embed shared background template as a Form XObject once
    const embeddedCover = await targetDoc.embedPage(frontDoc.getPages()[0]);
    // Embed standard font once
    const font = await targetDoc.embedFont(StandardFonts.Helvetica);

    const stampStart = performance.now();
    for (const enrollment of enrollments) {
      await createStampedCoverPage({
        targetDoc,
        embeddedCover,
        font,
        qrX: 50,
        qrY: 60,
        serialNumber: enrollment.serialNumber,
        qrUrl: enrollment.qrUrl,
        regNumber: enrollment.regNumber,
      });
    }
    const stampEnd = performance.now();
    const stampingTimeMs = stampEnd - stampStart;

    const stitchStart = performance.now();
    const outputPdfBytes = await targetDoc.save({ useObjectStreams: false });
    const stitchEnd = performance.now();
    const stitchingTimeMs = stitchEnd - stitchStart;

    const totalTimeMs = performance.now() - startTime;
    const cpuDelta = process.cpuUsage(startCpu);

    clearInterval(memSampler);
    const finalMem = process.memoryUsage();
    if (finalMem.rss > peakRssBytes) {
      peakRssBytes = finalMem.rss;
    }

    const metrics: BenchmarkMetrics = {
      scenarioId: id,
      coversCount: count,
      stampingTimeMs: Math.round(stampingTimeMs * 100) / 100,
      stitchingTimeMs: Math.round(stitchingTimeMs * 100) / 100,
      totalTimeMs: Math.round(totalTimeMs * 100) / 100,
      throughputCoversPerSec: Math.round((count / (totalTimeMs / 1000)) * 100) / 100,
      outputSizeBytes: outputPdfBytes.length,
      initialRssMb: Math.round(initialRssMb * 100) / 100,
      peakRssMb: Math.round((peakRssBytes / (1024 * 1024)) * 100) / 100,
      heapUsedMb: Math.round((finalMem.heapUsed / (1024 * 1024)) * 100) / 100,
      cpuUserMs: Math.round(cpuDelta.user / 1000),
      cpuSystemMs: Math.round(cpuDelta.system / 1000),
      success: true,
    };

    console.log(`__BENCH_RESULT__${JSON.stringify(metrics)}`);
  } catch (err: any) {
    clearInterval(memSampler);
    const metrics: BenchmarkMetrics = {
      scenarioId: id,
      coversCount: count,
      stampingTimeMs: 0,
      stitchingTimeMs: 0,
      totalTimeMs: performance.now() - startTime,
      throughputCoversPerSec: 0,
      outputSizeBytes: 0,
      initialRssMb,
      peakRssMb: peakRssBytes / (1024 * 1024),
      heapUsedMb: 0,
      cpuUserMs: 0,
      cpuSystemMs: 0,
      success: false,
      error: err?.message || String(err),
    };
    console.log(`__BENCH_RESULT__${JSON.stringify(metrics)}`);
    process.exit(1);
  }
}

runWorker();
