use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, Stream};
use qrcode::{Color, QrCode};
use serde::Serialize;
use std::env;
use std::time::Instant;

#[derive(Serialize)]
struct BenchmarkMetrics {
    scenario_id: String,
    engine: String,
    covers_count: usize,
    stamping_time_ms: f64,
    stitching_time_ms: f64,
    total_time_ms: f64,
    throughput_covers_per_sec: f64,
    output_size_bytes: usize,
    peak_rss_mb: f64,
    success: bool,
    error: Option<String>,
}

const FACULTIES: &[&str] = &["SC", "EG", "AR", "ED", "MS", "LA", "HS"];
const DEPTS: &[&str] = &["CO", "ME", "EE", "CH", "PY", "BC", "MC", "EC"];

fn generate_registration_number(index: usize) -> String {
    let year = format!("{:02}", 20 + (index % 5));
    let faculty = FACULTIES[index % FACULTIES.len()];
    let dept = DEPTS[(index * 3) % DEPTS.len()];
    let num = if index % 2 == 0 {
        format!("{:03}", 100 + (index % 900))
    } else {
        format!("{:04}", 1000 + (index % 9000))
    };
    let suffix = if index % 7 == 0 { "TR" } else { "" };
    format!("{}/{}/{}/{}{}", year, faculty, dept, num, suffix)
}

fn get_peak_rss_mb() -> f64 {
    if let Ok(statm) = std::fs::read_to_string("/proc/self/statm") {
        if let Some(rss_pages) = statm.split_whitespace().nth(1) {
            if let Ok(pages) = rss_pages.parse::<usize>() {
                return (pages * 4096) as f64 / (1024.0 * 1024.0);
            }
        }
    }
    0.0
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut count = 50;
    let mut scenario_id = "rust-lopdf".to_string();

    let mut i = 1;
    while i < args.len() {
        if args[i] == "--count" && i + 1 < args.len() {
            count = args[i + 1].parse().unwrap_or(50);
            i += 2;
        } else if args[i] == "--id" && i + 1 < args.len() {
            scenario_id = args[i + 1].clone();
            i += 2;
        } else {
            i += 1;
        }
    }

    let start_all = Instant::now();
    let stamp_start = Instant::now();

    let mut out_doc = Document::with_version("1.7");
    let pages_id = out_doc.new_object_id();

    let mut out_page_ids = Vec::with_capacity(count);

    for idx in 1..=count {
        let token = uuid::Uuid::new_v4().to_string();
        let qr_url = format!("https://modools.app/enrollments/course-csc201/token_{}", token);
        let serial = format!("{:03}", idx);
        let reg_num = generate_registration_number(idx);

        // Fast native QR bitmatrix generation
        let code = QrCode::new(qr_url.as_bytes()).unwrap();
        let width = code.width();
        let mut raw_bytes = Vec::with_capacity(width * width);
        for color in code.to_colors() {
            match color {
                Color::Dark => raw_bytes.push(0u8),
                Color::Light => raw_bytes.push(255u8),
            }
        }

        // Convert raw pixels into PDF Image XObject
        let img_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => width as i64,
                "Height" => width as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            raw_bytes,
        );
        let img_id = out_doc.add_object(img_stream);

        // Content stream
        let qr_name = format!("QR{}", idx);
        let content_operations = vec![
            Operation::new("q", vec![]),
            Operation::new(
                "cm",
                vec![
                    100.0.into(),
                    0.0.into(),
                    0.0.into(),
                    100.0.into(),
                    50.0.into(),
                    60.0.into(),
                ],
            ),
            Operation::new("Do", vec![Object::Name(qr_name.clone().into_bytes())]),
            Operation::new("Q", vec![]),
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 10.0.into()]),
            Operation::new("Td", vec![480.0.into(), 820.0.into()]),
            Operation::new("Tj", vec![Object::string_literal(serial)]),
            Operation::new("ET", vec![]),
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 10.0.into()]),
            Operation::new("Td", vec![50.0.into(), 166.0.into()]),
            Operation::new("Tj", vec![Object::string_literal(reg_num)]),
            Operation::new("ET", vec![]),
        ];

        let content_stream = Stream::new(dictionary! {}, Content { operations: content_operations }.encode().unwrap());
        let content_id = out_doc.add_object(content_stream);

        let page_dict = dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.28.into(), 841.89.into()],
            "Contents" => content_id,
            "Resources" => dictionary! {
                "Font" => dictionary! {
                    "F1" => dictionary! {
                        "Type" => "Font",
                        "Subtype" => "Type1",
                        "BaseFont" => "Helvetica",
                    },
                },
                "XObject" => dictionary! {
                    qr_name => img_id,
                },
            },
        };

        let page_id = out_doc.add_object(page_dict);
        out_page_ids.push(page_id.into());
    }

    out_doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Count" => count as i64,
            "Kids" => out_page_ids,
        }),
    );

    let catalog_id = out_doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    out_doc.trailer.set("Root", catalog_id);

    let stamping_time_ms = stamp_start.elapsed().as_secs_f64() * 1000.0;

    let stitch_start = Instant::now();
    let mut out_buffer = Vec::new();
    out_doc.save_to(&mut out_buffer).unwrap();
    let stitching_time_ms = stitch_start.elapsed().as_secs_f64() * 1000.0;

    let total_time_ms = start_all.elapsed().as_secs_f64() * 1000.0;
    let throughput = (count as f64) / (total_time_ms / 1000.0);
    let peak_rss_mb = get_peak_rss_mb();

    let metrics = BenchmarkMetrics {
        scenario_id,
        engine: "lopdf (Rust native)".to_string(),
        covers_count: count,
        stamping_time_ms: (stamping_time_ms * 100.0).round() / 100.0,
        stitching_time_ms: (stitching_time_ms * 100.0).round() / 100.0,
        total_time_ms: (total_time_ms * 100.0).round() / 100.0,
        throughput_covers_per_sec: (throughput * 100.0).round() / 100.0,
        output_size_bytes: out_buffer.len(),
        peak_rss_mb: (peak_rss_mb * 100.0).round() / 100.0,
        success: true,
        error: None,
    };

    println!("__BENCH_RESULT__{}", serde_json::to_string(&metrics).unwrap());
}
