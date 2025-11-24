/* Interactive JS for Ian's site */
const THUMB_WIDTH = 400; // Must match generate-photo-manifests.js
const FULL_WIDTH = 1600; // Must match generate-photo-manifests.js

const state = {
  get photos() {
    return window.IAN_SITE_PHOTOS || [];
  },
};

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Nav toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => navMenu.classList.toggle('open'));
}

// Render Portfolio Grid
const portfolioGrid = document.getElementById('portfolioGrid');
const galleryGrid = document.getElementById('galleryGrid');
function renderPortfolio(filter = 'all') {
  if (!portfolioGrid) return;
  portfolioGrid.innerHTML = '';
  const items = state.photos.filter(p => filter === 'all' ? true : p.category === filter);
  items.forEach(p => portfolioGrid.appendChild(makePhotoCard(p)));
}

function renderGallery() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = '';
  const items = state.photos;
  items.forEach(p => galleryGrid.appendChild(makeMasonryTile(p)));
}

function makePhotoCard(p) {
  const figure = document.createElement('figure');
  const wrapper = document.createElement('div');
  wrapper.className = 'photo-wrapper';

  const img = document.createElement('img');
  img.src = p.thumbSrc;
  img.srcset = `${p.thumbSrc} ${THUMB_WIDTH}w, ${p.fullSrc} ${FULL_WIDTH}w`;
  img.sizes = `(max-width: ${THUMB_WIDTH}px) ${THUMB_WIDTH}px, ${FULL_WIDTH}px`;
  img.alt = p.alt;
  img.loading = 'lazy';
  img.addEventListener('click', () => openLightbox(p));

  const caption = document.createElement('div');
  caption.className = 'photo-caption';
  caption.textContent = p.caption;

  wrapper.appendChild(img);
  wrapper.appendChild(caption);
  figure.appendChild(wrapper);
  return figure;
}

function makeMasonryTile(p) {
  const div = document.createElement('div');
  div.className = 'tile';
  const img = document.createElement('img');
  img.src = p.thumbSrc;
  img.srcset = `${p.thumbSrc} ${THUMB_WIDTH}w, ${p.fullSrc} ${FULL_WIDTH}w`;
  img.sizes = `(max-width: ${THUMB_WIDTH}px) ${THUMB_WIDTH}px, ${FULL_WIDTH}px`;
  img.alt = p.alt;
  img.loading = 'lazy';
  img.addEventListener('click', () => openLightbox(p));
  div.appendChild(img);
  return div;
}

// Lightbox
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxCaption = document.getElementById('lightboxCaption');
const lightboxClose = document.getElementById('lightboxClose');

function openLightbox(p) {
  if (!lightbox) return;
  lightboxImg.src = p.fullSrc;
  lightboxCaption.textContent = p.caption || '';
  lightbox.hidden = false;
}
if (lightboxClose) lightboxClose.addEventListener('click', () => lightbox.hidden = true);
if (lightbox) lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.hidden = true; });

// Filters
// Moved inside photosLoaded listener in photography.html to ensure buttons exist

// Initial render after photos are loaded
window.addEventListener('photosLoaded', () => {
  const portfolioGrid = document.getElementById('portfolioGrid');
  const galleryGrid = document.getElementById('galleryGrid');

  // Filter logic is now entirely handled in photography.html after buttons are created.

  if (galleryGrid) {
    renderGallery();
  }

  // Dynamically load captions for specific images in the 'About Me' section
  const aboutPhotoIds = ['photo-mx-taco', 'photo-bike-party', 'photo-tux2', 'photo-tiki-ian'];
  aboutPhotoIds.forEach(id => {
    const photoWrapper = document.getElementById(id);
    if (photoWrapper) {
      const img = photoWrapper.querySelector('img');
      const captionDiv = photoWrapper.querySelector('.photo-caption');
      console.log(captionDiv)
      if (img && captionDiv) {
        // Extract filename from src to match with JSON data
        const imgFilename = img.src.split('/').pop().split('.')[0]; // e.g., "mx_taco"
        const photoData = state.photos.find(p => p.thumbSrc.includes(imgFilename) || p.fullSrc.includes(imgFilename));
        if (photoData && (photoData.caption || photoData.alt)) {
          captionDiv.textContent = photoData.caption || photoData.alt;
        }
      }
    }
  });
});