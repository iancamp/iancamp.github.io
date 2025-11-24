import fs from "fs";
import path from "path";
import exifr from "exifr";
import sharp from "sharp";
import NodeGeocoder from "node-geocoder";
import dotenv from "dotenv";

// Load environment variables from .env (if present)
dotenv.config();

// Geocoder configuration: provider and API key can be set via env vars.
// Default to OpenCage so your `OPENCAGE_KEY` in `.env` is used automatically.
const GEOCODER_PROVIDER = process.env.GEOCODER_PROVIDER || "opencage";
// Accept several common env var names for keys (OPENCAGE_KEY, OPENCAGE_API_KEY, GEOCODER_API_KEY, MAPBOX_KEY)
const GEOCODER_API_KEY = process.env.GEOCODER_API_KEY || process.env.OPENCAGE_KEY || process.env.OPENCAGE_API_KEY || process.env.MAPBOX_KEY || null;
const GEOCODER_DELAY = parseInt(process.env.GEOCODER_DELAY || "1000", 10);

// Skip geocoding when running in CI environments
const SKIP_GEOCODING_IN_CI = !!process.env.CI;

// When set, force re-calculation of GPS / reverse-geocoding even if manifest has values
const FORCE_RECALC_GPS = !!process.env.FORCE_RECALC_GPS;

// Comma-separated list of folders for which GPS calculation should be skipped.
// Defaults to `me` as requested.
const SKIP_GPS_FOLDERS = (process.env.SKIP_GPS_FOLDERS || "me").split(",").map(s => s.trim()).filter(Boolean);

const geocoderOptions = { provider: GEOCODER_PROVIDER };
if (GEOCODER_PROVIDER === "openstreetmap") {
  // Nominatim requires a proper user agent
  geocoderOptions.userAgent = "iancamp.github.io (https://iancamp.github.io)";
}
if (GEOCODER_API_KEY) geocoderOptions.apiKey = GEOCODER_API_KEY;

// Only create the geocoder if not in CI and if the provider requirements are met.
let geocoder = null;
if (!SKIP_GEOCODING_IN_CI) {
  // For providers that require an API key (like opencage, mapbox, google), ensure we have one.
  const providerRequiresKey = ["opencage", "mapbox", "google", "geoapify", "locationiq"].includes(GEOCODER_PROVIDER);
  if (providerRequiresKey && !GEOCODER_API_KEY) {
    console.warn(`Geocoder provider '${GEOCODER_PROVIDER}' requires an API key. Set GEOCODER_API_KEY or OPENCAGE_API_KEY in your .env to enable reverse geocoding.`);
  } else {
    geocoder = NodeGeocoder(geocoderOptions);
  }
} else {
  console.log("CI environment detected — geocoding disabled.");
}

// --- CONFIGURATION ---
const SRC_BASE_DIR = "assets/photos"; // where your original JPGs live
const OUT_BASE_DIR = process.env.OUT_BASE_DIR || SRC_BASE_DIR; // where webp + json will be written

const folders = ["me", "photography"];
const THUMB_WIDTH = 400;
const FULL_WIDTH = 1600;

// Utility function to introduce a delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Convert EXIF GPS (DMS) values to decimal degrees. Handles arrays like [deg, min, sec],
// numeric values, strings, or objects. Applies hemisphere ref ('N','S','E','W') if provided.
function gpsToDecimal(coord, ref) {
  if (coord === undefined || coord === null) return null;
  if (typeof coord === 'number') {
    return (ref && (ref === 'S' || ref === 'W')) ? -coord : coord;
  }
  if (Array.isArray(coord)) {
    const [deg = 0, min = 0, sec = 0] = coord.map(Number);
    let dec = deg + (min / 60) + (sec / 3600);
    if (ref && (ref === 'S' || ref === 'W')) dec = -dec;
    return dec;
  }
  if (typeof coord === 'string') {
    // Support formats like "10,34,2.58" or "10/1,34/1,258/100"
    const parts = coord.split(/[ ,]+/).map(p => {
      if (p.includes('/')) {
        const [n, d] = p.split('/').map(Number);
        return d ? n / d : n;
      }
      return Number(p);
    });
    const [deg = 0, min = 0, sec = 0] = parts;
    let dec = deg + (min / 60) + (sec / 3600);
    if (ref && (ref === 'S' || ref === 'W')) dec = -dec;
    return dec;
  }
  if (typeof coord === 'object') {
    // exifr sometimes returns objects with latitude/longitude properties
    if ('latitude' in coord && 'longitude' in coord) return coord.latitude;
  }
  return null;
}

// build output dirs relative to OUT_BASE_DIR
const THUMB_DIR = path.join(OUT_BASE_DIR, "thumbs");
const FULL_DIR = path.join(OUT_BASE_DIR, "full");

fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(FULL_DIR, { recursive: true });

// Geocode cache persisted between runs to avoid repeated reverse-geocoding calls
const GEOCODE_CACHE_FILE = path.join(OUT_BASE_DIR, "geocode-cache.json");
let geocodeCache = new Map();
try {
  if (fs.existsSync(GEOCODE_CACHE_FILE)) {
    const raw = fs.readFileSync(GEOCODE_CACHE_FILE, "utf8");
    const obj = JSON.parse(raw || "{}");
    geocodeCache = new Map(Object.entries(obj));
  }
} catch (e) {
  console.warn("Could not load geocode cache:", e.message);
}

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
  const existingPhotosMap = new Map();

  // Read existing manifest if it exists
  if (fs.existsSync(outputFile)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
      existingData.forEach(photo => existingPhotosMap.set(path.parse(photo.src).name.replace(/_full\.webp$/, ''), photo));
    } catch (e) {
      console.warn(`WARN: Could not read existing manifest ${outputFile}. Starting fresh.`, e.message);
    }
  }

  for (const file of files) {
    const fullPath = path.join(srcDir, file);
    const name = path.parse(file).name;
    const thumbOutput = path.join(THUMB_DIR, `${name}_thumb.webp`);
    const fullOutput = path.join(FULL_DIR, `${name}_full.webp`);

    const image = sharp(fullPath);
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;

    await image.resize(THUMB_WIDTH).webp({ quality: 80 }).toFile(thumbOutput);
    await image.resize(FULL_WIDTH).webp({ quality: 90 }).toFile(fullOutput);

    let date, city, country;
    const existingPhoto = existingPhotosMap.get(name);
    const skipGpsForThis = SKIP_GPS_FOLDERS.includes(folder);

    if (skipGpsForThis) {
      // For folders explicitly configured to skip GPS calc (e.g., `me`), do not perform
      // any GPS extraction or reverse geocoding. Prefer existing manifest values when present.
      if (existingPhoto && existingPhoto.city && existingPhoto.country && !FORCE_RECALC_GPS) {
        city = existingPhoto.city;
        country = existingPhoto.country;
        date = existingPhoto.date;
        console.log(`💡 Using existing location data for ${file}: ${city}, ${country} (folder '${folder}' configured to skip GPS)`);
      } else {
        // Only extract the date; skip all GPS work
        try {
          const exif = await exifr.parse(fullPath, ["DateTimeOriginal"]);
          const dt = exif?.DateTimeOriginal || fs.statSync(fullPath).birthtime;
          date = new Date(dt).toISOString().split("T")[0];
        } catch (e) {
          date = fs.statSync(fullPath).birthtime.toISOString().split("T")[0];
        }
        city = existingPhoto?.city || null;
        country = existingPhoto?.country || null;
        console.log(`ℹ️ Skipping GPS extraction for ${file} (folder '${folder}')`);
      }
    } else {
      if (existingPhoto && existingPhoto.city && existingPhoto.country && !FORCE_RECALC_GPS) {
        city = existingPhoto.city;
        country = existingPhoto.country;
        date = existingPhoto.date;
        console.log(`💡 Using existing location data for ${file}: ${city}, ${country}`);
      } else {
        if (existingPhoto && FORCE_RECALC_GPS) {
          console.log(`🔁 FORCE_RECALC_GPS enabled — will re-calculate location for ${file}. Previous: ${existingPhoto.city || 'N/A'}, ${existingPhoto.country || 'N/A'}`);
        }
      }
      try {
        // Parse DateTimeOriginal
        const exif = await exifr.parse(fullPath, ["DateTimeOriginal"]);
        const dt = exif?.DateTimeOriginal || fs.statSync(fullPath).birthtime;
        date = new Date(dt).toISOString().split("T")[0];

        // Try exifr.gps() which usually returns signed decimal coords {latitude, longitude}
        let gpsCoords = null;
        try {
          gpsCoords = await exifr.gps(fullPath);
        } catch (gpe) {
          console.warn(`DEBUG: exifr.gps failed for ${file}:`, gpe && gpe.message ? gpe.message : gpe);
        }

        // Also peek at raw EXIF GPS tags for diagnostics (DMS + Ref fields)
        const rawExif = await exifr.parse(fullPath, ["GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef"]).catch(() => ({}));
        console.log(`DEBUG: EXIF keys for ${file}:`, Object.keys(rawExif || {}));
        console.log(`DEBUG: EXIF GPS raw for ${file}:`, { GPSLatitude: rawExif?.GPSLatitude, GPSLongitude: rawExif?.GPSLongitude, GPSLatitudeRef: rawExif?.GPSLatitudeRef, GPSLongitudeRef: rawExif?.GPSLongitudeRef });
        console.log(`DEBUG: exifr.gps output for ${file}:`, gpsCoords);

        // Determine lat/lon, prefer exifr.gps signed decimals when present
        const lat = gpsCoords?.latitude ?? gpsToDecimal(rawExif?.GPSLatitude, rawExif?.GPSLatitudeRef);
        const lon = gpsCoords?.longitude ?? gpsToDecimal(rawExif?.GPSLongitude, rawExif?.GPSLongitudeRef);
        console.log(`DEBUG: Converted GPS for ${file}: lat=${lat}, lon=${lon}`);

        if (lat != null && lon != null) {
          // Use a coarse key to cache nearby coordinates together
          const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
          if (geocodeCache.has(cacheKey)) {
            const cached = geocodeCache.get(cacheKey);
            console.log(`DEBUG: Geocode cache hit for ${cacheKey} ->`, cached);
            city = cached.city;
            country = cached.country;
          } else if (SKIP_GEOCODING_IN_CI) {
            // In CI we skip live reverse lookups to avoid external calls
            console.log(`CI detected; skipping reverse geocoding for ${file}`);
          } else {
            // Only delay if a positive delay is configured; allow disabling throttle by setting GEOCODER_DELAY=0
            if (GEOCODER_DELAY > 0) await delay(GEOCODER_DELAY);
            if (!geocoder) {
              console.log(`No geocoder configured; skipping reverse geocoding for ${file}`);
            } else {
              try {
                console.log(`DEBUG: Making reverse geocode request for ${file} (lat=${lat}, lon=${lon}) using provider=${GEOCODER_PROVIDER}`);
                const geo = await geocoder.reverse({ lat, lon });
                console.log(`DEBUG: Geocoder response for ${file}:`, Array.isArray(geo) ? geo[0] : geo);
                if (geo && geo.length > 0) {
                  city = geo[0].city || geo[0].smalltown || geo[0].village || geo[0].town || null;
                  country = geo[0].country || null;
                  geocodeCache.set(cacheKey, { city: city || null, country: country || null });
                  console.log(`DEBUG: Cached geocode for ${cacheKey} ->`, { city, country });
                }
              } catch (gerr) {
                console.error(`Geocoding failed for ${file}:`, gerr && gerr.message ? gerr.message : gerr);
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error processing EXIF or geocoding for ${file}:`, e.message);
        date = fs.statSync(fullPath).birthtime.toISOString().split("T")[0];
      }
    }

    // Preserve existing caption if present in the manifest. Do not append location to captions.
    const caption = existingPhoto && existingPhoto.caption ? existingPhoto.caption : name.replace(/[-_]/g, " ");

    photos.push({
      src: path.join(FULL_DIR, `${name}_full.webp`).replace(/\\/g, "/"),
      thumbSrc: `/assets/photos/thumbs/${name}_thumb.webp`,
      fullSrc: `/assets/photos/full/${name}_full.webp`,
      alt: name.replace(/[-_]/g, " "),
      date,
      width,
      height,
      caption,
      city: city || null,
      country: country || null
    });
  }

  fs.writeFileSync(outputFile, JSON.stringify(photos, null, 2));
  console.log(`✅ Wrote ${photos.length} entries to ${outputFile}`);
  // Persist geocode cache after writing manifest for this folder
  try {
    const obj = Object.fromEntries(geocodeCache);
    fs.writeFileSync(GEOCODE_CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn("Could not persist geocode cache:", e.message);
  }
}

for (const folder of folders) await buildManifest(folder);
