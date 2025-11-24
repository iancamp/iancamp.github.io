import fs from "fs";
import path from "path";
import exifr from "exifr";
import sharp from "sharp";

// NEW: separate source vs output roots
const SRC_BASE_DIR = "assets/photos";
const OUT_BASE_DIR = process.env.OUT_BASE_DIR || SRC_BASE_DIR;


const folders = ["me", "photography"];
const THUMB_WIDTH = 400;
const FULL_WIDTH = 1600;
const THUMB_DIR = path.join(OUT_BASE_DIR, "thumbs");
const FULL_DIR = path.join(OUT_BASE_DIR, "full");

// Ensure output directories exist
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(FULL_DIR, { recursive: true });

async function buildManifest(folder) {
  const dirPath = path.join(SRC_BASE_DIR, folder); // read from source dir
  const outputFile = path.join(OUT_BASE_DIR, `${folder}_photos.json`); // write json to OUT dir

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Source folder not found: ${dirPath}`);
  }

  // Load existing captions (if any) from previous OUT json
  let existing = {};
  if (fs.existsSync(outputFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(outputFile, "utf8"));
      old.forEach(p => { if (p.fullSrc) existing[p.fullSrc] = p.caption || ""; });
    } catch (err) {
      console.warn(`⚠️ Could not parse existing ${outputFile}:`, err.message);
    }
  }

  // Only treat JPG/PNG as inputs (do not include existing webp files)
  const files = fs.readdirSync(dirPath).filter(f => /\.(jpe?g|png)$/i.test(f));
  const photos = [];

  for (const filename of files) {
    const fullPath = path.join(dirPath, filename);
    const nameOnly = path.parse(filename).name;

    const thumbFilename = `${nameOnly}_thumb.webp`;
    const fullWebpFilename = `${nameOnly}_full.webp`;
    const thumbOutputPath = path.join(THUMB_DIR, thumbFilename);
    const fullOutputPath = path.join(FULL_DIR, fullWebpFilename);

    // Generate thumbnail
    await sharp(fullPath).resize(THUMB_WIDTH).webp({ quality: 80 }).toFile(thumbOutputPath);

    // Generate optimized full-size WebP
    await sharp(fullPath).resize(FULL_WIDTH).webp({ quality: 90 }).toFile(fullOutputPath);

    // EXIF for date/caption (fallbacks preserved)
    let date, caption;
    try {
      const exif = await exifr.parse(fullPath, ["DateTimeOriginal", "ImageDescription"]);
      const dt = exif?.DateTimeOriginal || fs.statSync(fullPath).birthtime;
      date = new Date(dt).toISOString().split("T")[0];
      caption = exif?.ImageDescription || existing[path.join(FULL_DIR, fullWebpFilename).replace(/\\/g, "/")] || "";
    } catch {
      date = fs.statSync(fullPath).birthtime.toISOString().split("T")[0];
      caption = existing[path.join(FULL_DIR, fullWebpFilename).replace(/\\/g, "/")] || "";
    }

    // Manifest: only webp paths (no original JPGs)
    photos.push({
      // If you want a generic "src", point to the full webp:
      src: path.join(FULL_DIR, fullWebpFilename).replace(/\\/g, "/"),
      thumbSrc: path.join(THUMB_DIR, thumbFilename).replace(/\\/g, "/"),
      fullSrc: path.join(FULL_DIR, fullWebpFilename).replace(/\\/g, "/"),
      alt: nameOnly.replace(/[-_]/g, " "),
      caption,
      date
    });
  }

  photos.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(outputFile, JSON.stringify(photos, null, 2));
  console.log(`✅ Wrote ${photos.length} entries to ${outputFile}`);
}

for (const folder of folders) await buildManifest(folder);
