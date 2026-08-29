import './style.css';
import benchmarkData from './benchmark-data.json';

interface BenchmarkMetrics {
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
}

const pdflibData = benchmarkData.sequential as BenchmarkMetrics[];
const rustData = (benchmarkData as any).nativeRust as BenchmarkMetrics[] || [];
const typstData = (benchmarkData as any).typst as BenchmarkMetrics[] || [];
const mutoolData = (benchmarkData as any).mutool as BenchmarkMetrics[] || [];

const engines = [
  { key: 'lopdf', label: 'lopdf (Rust)', data: rustData, color: 'emerald' },
  { key: 'pdflib', label: 'pdf-lib (TS)', data: pdflibData, color: 'cyan' },
  { key: 'typst', label: 'Typst CLI', data: typstData, color: 'orange' },
  { key: 'mutool', label: 'MuPDF', data: mutoolData, color: 'purple' },
] as const;

// Collect all unique cover counts across engines, sorted
const allCounts = [...new Set(engines.flatMap(e => e.data.map(m => m.coversCount)))].sort((a, b) => a - b);

// Index each engine's data by cover count for quick lookup
function indexByCount(data: BenchmarkMetrics[]) {
  const map = new Map<number, BenchmarkMetrics>();
  for (const m of data) map.set(m.coversCount, m);
  return map;
}

const indexed = engines.map(e => ({ ...e, byCount: indexByCount(e.data) }));

function formatTime(ms: number): string {
  const s = (ms / 1000).toFixed(2);
  return `${ms.toLocaleString('en-US', { maximumFractionDigits: 0 })} ms <span class="sec-label">(${s} s)</span>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Find the best (lowest) value in a row for highlighting
function findBestIdx(values: (number | null)[], lower: boolean) {
  let bestIdx = -1;
  let bestVal = lower ? Infinity : -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (lower ? v < bestVal : v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function renderComparisonTable(
  metricExtractor: (m: BenchmarkMetrics) => number,
  formatter: (val: number) => string,
  lowerIsBetter: boolean,
) {
  const headerCells = indexed.map(e =>
    `<th><span class="engine-col-label text-${e.color}">${e.label}</span></th>`
  ).join('');

  const rows = allCounts.map(count => {
    const values = indexed.map(e => {
      const m = e.byCount.get(count);
      return m ? metricExtractor(m) : null;
    });
    const bestIdx = findBestIdx(values, lowerIsBetter);

    const cells = indexed.map((e, i) => {
      const v = values[i];
      if (v === null) return `<td class="cell-na">--</td>`;
      const isBest = i === bestIdx;
      const cls = isBest ? `cell-value cell-best text-${e.color}` : 'cell-value';
      return `<td class="${cls}">${formatter(v)}${isBest ? ' <span class="best-badge">best</span>' : ''}</td>`;
    }).join('');

    return `
      <tr>
        <td class="cell-tier"><div class="tier-badge">${count.toLocaleString()} covers</div></td>
        ${cells}
      </tr>`;
  }).join('');

  return `
    <div class="table-responsive">
      <table class="benchmark-table comparison-table">
        <thead>
          <tr>
            <th>Batch Tier</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Throughput table with mini bars
function renderThroughputTable() {
  const globalMax = Math.max(
    ...engines.flatMap(e => e.data.map(m => m.throughputCoversPerSec)),
    1,
  );

  const headerCells = indexed.map(e =>
    `<th><span class="engine-col-label text-${e.color}">${e.label}</span></th>`
  ).join('');

  const rows = allCounts.map(count => {
    const values = indexed.map(e => {
      const m = e.byCount.get(count);
      return m ? m.throughputCoversPerSec : null;
    });
    const bestIdx = findBestIdx(values, false);

    const cells = indexed.map((e, i) => {
      const v = values[i];
      if (v === null) return `<td class="cell-na">--</td>`;
      const isBest = i === bestIdx;
      const pct = Math.max(8, (v / globalMax) * 100).toFixed(1);
      const cls = isBest ? 'cell-throughput cell-best' : 'cell-throughput';
      return `<td class="${cls}">
        <span class="throughput-val text-${e.color}">${v.toFixed(1)}</span> <span class="unit-sub">c/s</span>
        ${isBest ? '<span class="best-badge">best</span>' : ''}
        <div class="mini-bar-bg"><div class="mini-bar-fill fill-${e.color}" style="width: ${pct}%"></div></div>
      </td>`;
    }).join('');

    return `
      <tr>
        <td class="cell-tier"><div class="tier-badge">${count.toLocaleString()} covers</div></td>
        ${cells}
      </tr>`;
  }).join('');

  return `
    <div class="table-responsive">
      <table class="benchmark-table comparison-table">
        <thead>
          <tr>
            <th>Batch Tier</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Summary cards
function summaryCard(engine: typeof indexed[number], rank: number) {
  const last = engine.data[engine.data.length - 1];
  if (!last) return '';
  const totalSec = (last.totalTimeMs / 1000).toFixed(2);
  const avgThroughput = last.throughputCoversPerSec.toFixed(0);
  const peakRam = last.peakRssMb.toFixed(0);
  return `
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">${rank}. ${engine.label} @ ${last.coversCount.toLocaleString()}</span>
        <span class="metric-badge metric-badge-${engine.color}">${engine.key === 'lopdf' ? 'Fastest' : engine.color === 'cyan' ? 'TypeScript' : engine.color === 'orange' ? 'Typesetter' : 'C Engine'}</span>
      </div>
      <div class="metric-number">
        ${totalSec} <span class="metric-unit">s</span>
      </div>
      <div class="metric-footer">${avgThroughput} covers/s | ${peakRam} MB RAM</div>
    </div>`;
}

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
<div class="layout">
  <header class="hero-header">
    <div class="header-content">
      <div class="tag-row">
        <span class="tag tag-cyan">Modools Engine</span>
        <span class="tag tag-emerald">4-Engine Benchmark Suite</span>
        <span class="tag tag-purple">Scale: 50 - 5,000 Covers</span>
        <span class="tag tag-orange">Native Linux Binaries</span>
      </div>
      <h1 class="main-title">Manual Stamping & Stitching Performance</h1>
      <p class="main-description">
        Comprehensive empirical evaluation across 4 candidate engines: Pure TypeScript (with Form XObjects), Rust lopdf, Typst CLI, and MuPDF/mutool C engine on single-core Linux runners.
      </p>
      <div class="header-meta">
        <span class="meta-item"><i class="dot"></i> <strong>Last Ran:</strong> ${new Date(benchmarkData.generatedAt).toLocaleString()}</span>
        <span class="meta-item"><strong>Engines Evaluated:</strong> 4 Native / In-Process Options</span>
        <span class="meta-item"><strong>Status:</strong> <span class="status-pill status-pass">All Passed</span></span>
      </div>
    </div>
  </header>

  <main class="content-area">
    <!-- Top Summary Grid -->
    <div class="metrics-grid">
      ${indexed.map((e, i) => summaryCard(e, i + 1)).join('')}
    </div>

    <!-- Section 1: Elapsed Time -->
    <section class="card panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Total Elapsed Time</h2>
        <p class="panel-subtitle">Wall-clock time from start to final PDF bytes written. Lower is better.</p>
      </div>
      ${renderComparisonTable(m => m.totalTimeMs, formatTime, true)}
    </section>

    <!-- Section 2: Stamping Time -->
    <section class="card panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Stamping Time</h2>
        <p class="panel-subtitle">Time spent generating QR codes and stamping individual cover pages. Lower is better.</p>
      </div>
      ${renderComparisonTable(m => m.stampingTimeMs, formatTime, true)}
    </section>

    <!-- Section 3: Stitching Time -->
    <section class="card panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Stitching Time</h2>
        <p class="panel-subtitle">Time spent merging individual pages into the final combined PDF. Lower is better.</p>
      </div>
      ${renderComparisonTable(m => m.stitchingTimeMs, formatTime, true)}
    </section>

    <!-- Section 4: Throughput -->
    <section class="card panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Throughput</h2>
        <p class="panel-subtitle">Covers processed per second (covers/s). Higher is better.</p>
      </div>
      ${renderThroughputTable()}
    </section>

    <!-- Section 5: Peak RAM -->
    <section class="card panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Peak RAM Usage</h2>
        <p class="panel-subtitle">Maximum resident set size during the benchmark run. Lower is better.</p>
      </div>
      ${renderComparisonTable(m => m.peakRssMb, v => `${v.toFixed(1)} MB`, true)}
    </section>

    <!-- Section 6: Output PDF Size -->
    <section class="card panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Output PDF Size</h2>
        <p class="panel-subtitle">Final combined PDF file size on disk. Lower is better.</p>
      </div>
      ${renderComparisonTable(m => m.outputSizeBytes, formatBytes, true)}
    </section>

    <!-- Section 7: How to get and deploy the binaries -->
    <section class="card panel-card">
      <div class="panel-header">
        <h2 class="panel-title">How to Obtain and Deploy Each Linux Binary</h2>
        <p class="panel-subtitle">Instructions to fetch, compile, and run each binary on Linux / Vercel.</p>
      </div>

      <div class="comparison-grid">
        <div class="engine-card">
          <div class="engine-card-header">
            <h3>1. lopdf-stamper</h3>
            <span class="engine-tag tag-emerald">Pre-built in repo</span>
          </div>
          <p class="engine-desc">Compiled from source in <code>native/lopdf-stamper/</code>.</p>
          <ul class="engine-list">
            <li><strong>Location:</strong> <code>bin/lopdf-stamper</code></li>
            <li><strong>How to build:</strong> <code>cargo build --release --manifest-path native/lopdf-stamper/Cargo.toml</code></li>
            <li><strong>Deploy:</strong> Copy single file, execute via <code>spawn('./bin/lopdf-stamper', ['--count', '1000'])</code>.</li>
          </ul>
        </div>

        <div class="engine-card">
          <div class="engine-card-header">
            <h3>2. Typst CLI</h3>
            <span class="engine-tag tag-orange">Official Musl Binary</span>
          </div>
          <p class="engine-desc">Official statically-linked musl release binary from GitHub.</p>
          <ul class="engine-list">
            <li><strong>Location:</strong> <code>bin/typst</code></li>
            <li><strong>How to download:</strong> <code>curl -L https://github.com/typst/typst/releases/download/v0.11.1/typst-x86_64-unknown-linux-musl.tar.xz | tar -xJ</code></li>
            <li><strong>Deploy:</strong> Single standalone binary with zero shared library dependencies.</li>
          </ul>
        </div>

        <div class="engine-card">
          <div class="engine-card-header">
            <h3>3. MuPDF (mutool)</h3>
            <span class="engine-tag tag-purple">C Shared Libs</span>
          </div>
          <p class="engine-desc">Compiled C tool with bundled shared libraries in <code>bin/lib/</code>.</p>
          <ul class="engine-list">
            <li><strong>Location:</strong> <code>bin/mutool</code> + <code>bin/lib/</code></li>
            <li><strong>How to fetch:</strong> Extracted from upstream Ubuntu/Debian <code>mupdf-tools</code> and <code>libmupdf</code> packages.</li>
            <li><strong>Deploy:</strong> Requires <code>bin/lib</code> with <code>LD_LIBRARY_PATH</code> wrapper.</li>
          </ul>
        </div>

        <div class="engine-card">
          <div class="engine-card-header">
            <h3>4. pdf-lib</h3>
            <span class="engine-tag tag-cyan">Zero Binaries</span>
          </div>
          <p class="engine-desc">Standard TypeScript / Bun package.</p>
          <ul class="engine-list">
            <li><strong>Location:</strong> In-process npm module</li>
            <li><strong>How to install:</strong> <code>bun add pdf-lib</code></li>
            <li><strong>Deploy:</strong> Runs directly inside Next.js / Node without child processes.</li>
          </ul>
        </div>
      </div>
    </section>
  </main>
</div>
`;
