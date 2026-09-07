use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, Stream};
use qrcode::{Color, QrCode};
use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
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
    let mut template_path = PathBuf::from("assets/cover-template.pdf");

    let mut i = 1;
    while i < args.len() {
        if args[i] == "--count" && i + 1 < args.len() {
            count = args[i + 1].parse().unwrap_or(50);
            i += 2;
        } else if args[i] == "--id" && i + 1 < args.len() {
            scenario_id = args[i + 1].clone();
            i += 2;
        } else if args[i] == "--template" && i + 1 < args.len() {
            template_path = PathBuf::from(&args[i + 1]);
            i += 2;
        } else {
            i += 1;
        }
    }

    if !template_path.exists() {
        let alt = Path::new("..").join(&template_path);
        if alt.exists() {
            template_path = alt;
        }
    }

    let start_all = Instant::now();

    // 1. Load template PDF
    let template_doc = match Document::load(&template_path) {
        Ok(doc) => doc,
        Err(e) => {
            eprintln!("Failed to load template PDF at {:?}: {}", template_path, e);
            let metrics = BenchmarkMetrics {
                scenario_id,
                engine: "lopdf (Rust native)".to_string(),
                covers_count: count,
                stamping_time_ms: 0.0,
                stitching_time_ms: 0.0,
                total_time_ms: 0.0,
                throughput_covers_per_sec: 0.0,
                output_size_bytes: 0,
                peak_rss_mb: 0.0,
                success: false,
                error: Some(format!("Failed to load template: {}", e)),
            };
            println!("__BENCH_RESULT__{}", serde_json::to_string(&metrics).unwrap());
            return;
        }
    };

    let stamp_start = Instant::now();

    // Find first page of template
    let template_pages = template_doc.get_pages();
    let (_, template_first_page_id) = template_pages
        .iter()
        .next()
        .expect("Template PDF must have at least one page");

    let template_page_dict = template_doc
        .get_dictionary(*template_first_page_id)
        .expect("Template page must be a dictionary");

    // Extract MediaBox, default to A4 if missing
    let media_box: Vec<Object> = match template_page_dict.get(b"MediaBox") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => vec![0.into(), 0.into(), 595.28.into(), 841.89.into()],
    };

    let page_width = match media_box.get(2) {
        Some(Object::Real(val)) => *val as f64,
        Some(Object::Integer(val)) => *val as f64,
        _ => 595.28,
    };
    let page_height = match media_box.get(3) {
        Some(Object::Real(val)) => *val as f64,
        Some(Object::Integer(val)) => *val as f64,
        _ => 841.89,
    };

    // Extract template resources dictionary (fonts, etc.)
    let template_resources = match template_page_dict.get(b"Resources") {
        Ok(Object::Dictionary(dict)) => Object::Dictionary(dict.clone()),
        Ok(Object::Reference(id)) => Object::Reference(*id),
        _ => Object::Dictionary(dictionary! {}),
    };

    let form_content = template_doc.get_page_content(*template_first_page_id).unwrap_or_default();
    let bbox = vec![0.0f32, 0.0f32, page_width as f32, page_height as f32];
    let matrix = vec![1.0f32, 0.0, 0.0, 1.0, 0.0, 0.0];

    let form_dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "BBox" => Object::Array(bbox.into_iter().map(Object::Real).collect()),
        "Matrix" => Object::Array(matrix.into_iter().map(Object::Real).collect()),
        "Resources" => template_resources,
    };

    let mut form_stream = Stream::new(form_dict, form_content);
    let _ = form_stream.compress();

    // Copy template doc objects into out_doc so font/stream references remain valid
    let mut out_doc = Document::with_version("1.7");

    // Copy non-Catalog, non-Pages objects from template to out_doc
    for (&id, obj) in &template_doc.objects {
        if let Ok(dict) = obj.as_dict() {
            if let Ok(type_name) = dict.get(b"Type").and_then(Object::as_name_str) {
                if type_name == "Catalog" || type_name == "Pages" {
                    continue;
                }
            }
        }
        out_doc.objects.insert(id, obj.clone());
    }

    out_doc.max_id = template_doc
        .max_id
        .max(out_doc.objects.keys().map(|(id, _)| *id).max().unwrap_or(0));

    let pages_id = out_doc.new_object_id();
    let bg_form_id = out_doc.add_object(form_stream);

    let f1_id = out_doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });

    let mut out_page_ids = Vec::with_capacity(count);

    for idx in 1..=count {
        let token = uuid::Uuid::new_v4().to_string();
        let qr_url = format!("https://modools.app/enrollments/course-csc201/token_{}", token);
        let serial = format!("{:03}", idx);
        let reg_num = generate_registration_number(idx);

        // Fast native QR bitmatrix generation
        let code = QrCode::new(qr_url.as_bytes()).unwrap();
        let qr_width = code.width();
        let mut raw_bytes = Vec::with_capacity(qr_width * qr_width);
        for color in code.to_colors() {
            match color {
                Color::Dark => raw_bytes.push(0u8),
                Color::Light => raw_bytes.push(255u8),
            }
        }

        let img_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => qr_width as i64,
                "Height" => qr_width as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            raw_bytes,
        );
        let img_id = out_doc.add_object(img_stream);

        let qr_name = format!("QR{}", idx);
        let content_operations = vec![
            // Draw background cover Form XObject
            Operation::new("q", vec![]),
            Operation::new("Do", vec![Object::Name(b"CoverBG".to_vec())]),
            Operation::new("Q", vec![]),

            // Draw QR code at (50, 60), 100x100
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

            // Serial number - top right corner
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 10.0.into()]),
            Operation::new("Td", vec![(page_width - 55.0).into(), (page_height - 20.0).into()]),
            Operation::new("Tj", vec![Object::string_literal(serial)]),
            Operation::new("ET", vec![]),

            // Reg number - above QR code (50, 166)
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
            "MediaBox" => media_box.clone(),
            "Contents" => content_id,
            "Resources" => dictionary! {
                "Font" => dictionary! {
                    "F1" => f1_id,
                },
                "XObject" => dictionary! {
                    "CoverBG" => bg_form_id,
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
