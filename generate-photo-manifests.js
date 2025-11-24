import fs from "fs";
import path from "path";
import exifr from "exifr";
import sharp from "sharp";

// --- CONFIGURATION ---
const SRC_BASE_DIR = "assets/photos"; // where your original JPGs live
const OUT_BASE_DIR = process.env.OUT_BASE_DIR || SRC_BASE_DIR; // where webp + json will be written

const folders = ["me", "photography"];
const THUMB_WIDTH = 400;
const FULL_WIDTH = 1600;

// build output dirs relative to OUT_BASE_DIR
const THUMB_DIR = path.join(OUT_BASE_DIR, "thumbs");
const FULL_DIR = path.join(OUT_BASE_DIR, "full");

fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(FULL_DIR, { recursive: true });

// --- MANIFEST BUILDER ---
async function buildManifest(folder) {
  const srcDir = path.join(SRC_BASE_DIR, folder); // input folder
  const outputFile = path.join(OUT_BASE_DIR, `${folder}_photos.json`);

  if (!fs.existsSync(srcDir)) {
    console.error(`❌ Source folder not found: ${srcDir}`);
    return;
  }

  const files = fs.readdirSync(srcDir).filter(f => /\.(jpe?g|png)$/i.test(f));
  const photos = [];

  for (const file of files) {
    const fullPath = path.join(srcDir, file);
    const name = path.parse(file).name;
    const thumbOutput = path.join(THUMB_DIR, `${name}_thumb.webp`);
    const fullOutput = path.join(FULL_DIR, `${name}_full.webp`);

    await sharp(fullPath).resize(THUMB_WIDTH).webp({ quality: 80 }).toFile(thumbOutput);
    await sharp(fullPath).resize(FULL_WIDTH).webp({ quality: 90 }).toFile(fullOutput);

    let date;
    try {
      const exif = await exifr.parse(fullPath, ["DateTimeOriginal"]);
      const dt = exif?.DateTimeOriginal || fs.statSync(fullPath).birthtime;
      date = new Date(dt).toISOString().split("T")[0];
    } catch {
      date = fs.statSync(fullPath).birthtime.toISOString().split("T")[0];
    }

    photos.push({
      src: path.join(FULL_DIR, `${name}_full.webp`).replace(/\\/g, "/"),
      thumbSrc: path.join(THUMB_DIR, `${name}_thumb.webp`).replace(/\\/g, "/"),
      fullSrc: path.join(FULL_DIR, `${name}_full.webp`).replace(/\\/g, "/"),
      alt: name.replace(/[-_]/g, " "),
      date
    });
  }

  fs.writeFileSync(outputFile, JSON.stringify(photos, null, 2));
  console.log(`✅ Wrote ${photos.length} entries to ${outputFile}`);
}

for (const folder of folders) await buildManifest(folder);
