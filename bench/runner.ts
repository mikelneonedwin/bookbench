import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTypstBenchmark } from "./typst-bench.js";
import { runMutoolBenchmark } from "./mutool-bench.js";
import type { BenchmarkMetrics } from "./worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkerRunResult {
  metrics: BenchmarkMetrics;
  rawStdout: string;
  exitCode: number;
}

function formatTime(ms: number): string {
  return `${ms.toLocaleString('en-US', { maximumFractionDigits: 0 })} ms (${(ms / 1000).toFixed(2)} s)`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function spawnTsWorker(count: number, id: string): Promise<WorkerRunResult> {
  const scriptPath = join(__dirname, "worker.ts");
  const child = spawn("bun", ["run", scriptPath, "--count", String(count), "--id", id], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise<WorkerRunResult>((resolve, reject) => {
    child.on("close", (code) => {
      const match = stdout.match(/__BENCH_RESULT__(.+)/);
      if (match) {
        try {
          const metrics = JSON.parse(match[1]) as BenchmarkMetrics;
          resolve({ metrics, rawStdout: stdout, exitCode: code ?? 0 });
          return;
        } catch {}
      }

      if (code !== 0) {
        reject(new Error(`Worker ${id} failed with exit code ${code}: ${stderr || stdout}`));
      } else {
        reject(new Error(`Worker ${id} produced no parseable result: ${stdout}`));
      }
    });
  });
}

function spawnRustWorker(count: number, id: string): Promise<WorkerRunResult> {
  const binaryPath = join(__dirname, "..", "bin", "lopdf-stamper");
  const child = spawn(binaryPath, ["--count", String(count), "--id", id], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise<WorkerRunResult>((resolve, reject) => {
    child.on("close", (code) => {
      const match = stdout.match(/__BENCH_RESULT__(.+)/);
      if (match) {
        try {
          const raw = JSON.parse(match[1]);
          const metrics: BenchmarkMetrics = {
            scenarioId: raw.scenario_id,
            coversCount: raw.covers_count,
            stampingTimeMs: raw.stamping_time_ms,
            stitchingTimeMs: raw.stitching_time_ms,
            totalTimeMs: raw.total_time_ms,
            throughputCoversPerSec: raw.throughput_covers_per_sec,
            outputSizeBytes: raw.output_size_bytes,
            initialRssMb: 0,
            peakRssMb: raw.peak_rss_mb,
            heapUsedMb: 0,
            cpuUserMs: 0,
            cpuSystemMs: 0,
            success: raw.success,
            error: raw.error,
          };
          resolve({ metrics, rawStdout: stdout, exitCode: code ?? 0 });
          return;
        } catch {}
      }

      if (code !== 0) {
        reject(new Error(`Rust worker ${id} failed with exit code ${code}: ${stderr || stdout}`));
      } else {
        reject(new Error(`Rust worker ${id} produced no parseable result: ${stdout}`));
      }
    });
  });
}

async function runBenchmarkSuite() {
  const fullCounts = [50, 150, 200, 300, 500, 1000, 1500, 2000, 3000, 5000];

  console.info("\n============================================================");
  console.info(" 🚀 1. RUNNING OPTIMIZED PDF-LIB (Form XObjects in Bun/TS)");
  console.info("============================================================");

  const pdflibResults: BenchmarkMetrics[] = [];
  for (const count of fullCounts) {
    const id = `pdflib-${count}`;
    console.info(`▶ Starting [pdf-lib]: ${count} covers...`);
    const { metrics } = await spawnTsWorker(count, id);
    pdflibResults.push(metrics);
    console.info(`  ✔ ${count} covers: Total ${formatTime(metrics.totalTimeMs)} | Throughput ${metrics.throughputCoversPerSec} c/s | Peak RAM ${metrics.peakRssMb} MB`);
  }

  const rustResults: BenchmarkMetrics[] = [];
  const rustBinPath = join(__dirname, "..", "bin", "lopdf-stamper");
  if (existsSync(rustBinPath)) {
    console.info("\n============================================================");
    console.info(" ⚡ 2. RUNNING NATIVE RUST BINARY (lopdf-stamper)");
    console.info("============================================================");

    for (const count of fullCounts) {
      const id = `rust-${count}`;
      console.info(`▶ Starting [lopdf-stamper]: ${count} covers...`);
      const { metrics } = await spawnRustWorker(count, id);
      rustResults.push(metrics);
      console.info(`  ✔ ${count} covers: Total ${formatTime(metrics.totalTimeMs)} | Throughput ${metrics.throughputCoversPerSec} c/s | Peak RAM ${metrics.peakRssMb} MB`);
    }
  }

  const typstResults: BenchmarkMetrics[] = [];
  const typstBinPath = join(__dirname, "..", "bin", "typst");
  if (existsSync(typstBinPath)) {
    console.info("\n============================================================");
    console.info(" 📐 3. RUNNING TYPST NATIVE CLI (typst compile)");
    console.info("============================================================");

    for (const count of fullCounts) {
      const id = `typst-${count}`;
      console.info(`▶ Starting [typst]: ${count} covers...`);
      try {
        const metrics = await runTypstBenchmark(count, id);
        typstResults.push(metrics);
        console.info(`  ✔ ${count} covers: Total ${formatTime(metrics.totalTimeMs)} | Throughput ${metrics.throughputCoversPerSec} c/s`);
      } catch (err) {
        console.warn(`  ⚠ typst ${count} covers failed:`, err);
      }
    }
  }

  const mutoolResults: BenchmarkMetrics[] = [];
  const mutoolBinPath = join(__dirname, "..", "bin", "mutool");
  if (existsSync(mutoolBinPath)) {
    console.info("\n============================================================");
    console.info(" 🏎 4. RUNNING MUPDF NATIVE ENGINE (mutool merge)");
    console.info("============================================================");

    for (const count of fullCounts) {
      const id = `mutool-${count}`;
      console.info(`▶ Starting [mutool]: ${count} covers...`);
      try {
        const metrics = await runMutoolBenchmark(count, id);
        mutoolResults.push(metrics);
        console.info(`  ✔ ${count} covers: Total ${formatTime(metrics.totalTimeMs)} | Throughput ${metrics.throughputCoversPerSec} c/s`);
      } catch (err) {
        console.warn(`  ⚠ mutool ${count} covers failed:`, err);
      }
    }
  }

  return { pdflibResults, rustResults, typstResults, mutoolResults };
}

async function main() {
  const { pdflibResults, rustResults, typstResults, mutoolResults } = await runBenchmarkSuite();

  const payload = {
    generatedAt: new Date().toISOString(),
    sequential: pdflibResults,
    nativeRust: rustResults,
    typst: typstResults,
    mutool: mutoolResults,
  };

  const projectRoot = join(__dirname, "..");
  const publicDir = join(projectRoot, "public");
  const srcDir = join(projectRoot, "src");

  if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "benchmark-data.json"), JSON.stringify(payload, null, 2));
  writeFileSync(join(srcDir, "benchmark-data.json"), JSON.stringify(payload, null, 2));
  console.info("\n✔ Saved benchmark results for all 4 engines to public/benchmark-data.json and src/benchmark-data.json");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
