# Bookbench

Bookbench is a small benchmarking dashboard for evaluating PDF cover stamping and stitching performance across the engines used in this project: TypeScript `pdf-lib`, native Rust `lopdf`, Typst CLI, and MuPDF.

The goal is simple: make the trade-offs concrete. It measures total elapsed time, throughput, memory usage, and output size across a range of cover counts so the fastest and most reliable option is visible in one place.

## What it compares

- `pdf-lib` in Bun/TypeScript
- native `lopdf` Rust binary
- Typst CLI rendering pipeline
- MuPDF `mutool` workflow

## Run locally

- `bun install` — install dependencies
- `bun run dev` — start the Vite dashboard
- `bun run bench` — run benchmark scenarios
- `bun run build` — generate benchmark data and build the app

## Notes

The app renders side-by-side benchmark tables for elapsed time, throughput, and memory footprint across production-relevant cover volumes.
