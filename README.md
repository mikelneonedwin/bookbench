# Bookbench

Benchmark suite comparing PDF cover stamping and stitching performance across the main engine candidates used in this project: TypeScript `pdf-lib`, native Rust `lopdf`, Typst, and MuPDF.

## Scripts

- `npm run dev` — start the Vite dashboard
- `npm run bench` — run the benchmark runner
- `npm run build` — generate benchmark data and build the app

## Notes

The app renders comparative benchmarking tables for output time, throughput, and memory usage across a range of cover counts.
