import fs from "fs";
import path from "path";
import exifr from "exifr";
import sharp from "sharp";

const baseDir = "assets/photos";
const folders = ["me", "photography"];
const THUMB_WIDTH = 400;
const FULL_WIDTH = 1600;
const THUMB_DIR = path.join(baseDir, "thumbs");
const FULL_DIR = path.join(baseDir, "full");

// Ensure output directories exist
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(FULL_DIR, { recursive: true });

async function buildManifest(folder) {
  const dirPath = path.join(baseDir, folder);
  const outputFile = path.join(baseDir, `${folder}_photos.json`);

  // Load existing data (if any)
  let existing = {};
  if (fs.existsSync(outputFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(outputFile, "utf8"));
      old.forEach(p => { if (p.fullSrc) existing[p.fullSrc] = p.caption || ""; });
    } catch (err) {
      console.warn(`⚠️ Could not parse existing ${outputFile}:`, err.message);
    }
  }

  const files = fs.readdirSync(dirPath).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
  const photos = [];

  for (const filename of files) {
    const fullPath = path.join(dirPath, filename);
    const thumbFilename = `${path.parse(filename).name}_thumb.webp`;
    const fullWebpFilename = `${path.parse(filename).name}_full.webp`;
    const thumbOutputPath = path.join(THUMB_DIR, thumbFilename);
    const fullOutputPath = path.join(FULL_DIR, fullWebpFilename);

    // Generate thumbnail
    await sharp(fullPath)
      .resize(THUMB_WIDTH)
      .webp({ quality: 80 })
      .toFile(thumbOutputPath);

    // Generate optimized full-size WebP
    await sharp(fullPath)
      .resize(FULL_WIDTH)
      .webp({ quality: 90 })
      .toFile(fullOutputPath);

    let date, caption;

    try {
      const exif = await exifr.parse(fullPath, ["DateTimeOriginal", "ImageDescription"]);
      const dt = exif?.DateTimeOriginal || fs.statSync(fullPath).birthtime;
      date = new Date(dt).toISOString().split("T")[0];
      caption = exif?.ImageDescription || existing[path.join(baseDir, folder, filename).replace(/\\/g, "/")] || "";
    } catch {
      date = fs.statSync(fullPath).birthtime.toISOString().split("T")[0];
      caption = existing[path.join(baseDir, folder, filename).replace(/\\/g, "/")] || "";
    }

    photos.push({
      thumbSrc: path.join(THUMB_DIR, thumbFilename).replace(/\\/g, "/"),
      fullSrc: path.join(FULL_DIR, fullWebpFilename).replace(/\\/g, "/"),
      alt: filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
      caption,
      date
    });
  }

  photos.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(outputFile, JSON.stringify(photos, null, 2));
  console.log(`✅ Wrote ${photos.length} entries to ${outputFile}`);
}

for (const folder of folders) await buildManifest(folder);
