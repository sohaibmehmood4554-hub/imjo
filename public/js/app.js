// IMGO client app
// Everything here is client-side except two fetch() calls to
// /api/remove-bg and /api/enhance. No API key ever touches this file.

(() => {
  'use strict';

  /* ------------------------- theme ------------------------- */
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const storedTheme = safeGet('imgo-theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(storedTheme || (prefersLight ? 'light' : 'dark'));

  themeToggle.addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  function setTheme(mode) {
    root.dataset.theme = mode;
    themeToggle.textContent = mode === 'dark' ? '◐' : '◑';
    safeSet('imgo-theme', mode);
  }

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

  /* ------------------- device fingerprint ------------------- */
  // Sent as a header so the backend can hash it together with the
  // Cloudflare-verified client IP. Nothing here is stored client-side
  // beyond this session; the backend never sees more than this string.
  function getFingerprint() {
    const parts = [
      navigator.userAgent,
      `${screen.width}x${screen.height}`,
      String(new Date().getTimezoneOffset()),
      navigator.language,
      String(navigator.hardwareConcurrency || ''),
    ];
    return parts.join('|');
  }

  /* ---------------------------- ads --------------------------- */
  // Injects the ad unit into every [data-ad-slot] on the page. Each
  // slot gets its own script tags since ad networks generally key off
  // a single global `atOptions` read at script-eval time.
  function injectAds() {
    document.querySelectorAll('[data-ad-slot]').forEach((slot) => {
      if (slot.dataset.filled) return;
      slot.dataset.filled = 'true';

      const configScript = document.createElement('script');
      configScript.text = `atOptions = {
        'key' : 'c33d01174d5c50c4818e285efe8aae8c',
        'format' : 'iframe',
        'height' : 50,
        'width' : 320,
        'params' : {}
      };`;

      const invokeScript = document.createElement('script');
      invokeScript.src = 'https://grannyreproof.com/c33d01174d5c50c4818e285efe8aae8c/invoke.js';
      invokeScript.async = true;

      const wrap = document.createElement('div');
      wrap.appendChild(configScript);
      wrap.appendChild(invokeScript);
      slot.appendChild(wrap);
    });
  }
  injectAds();

  /* ------------------------- quota pill ------------------------ */
  const quotaValue = document.getElementById('quotaValue');
  async function refreshQuota() {
    try {
      const res = await apiFetch('/api/limits', { method: 'GET' });
      if (!res.ok) throw new Error('limits fetch failed');
      const data = await res.json();
      quotaValue.textContent = `${data.deviceRemaining}/${data.deviceLimit}`;
    } catch {
      quotaValue.textContent = '—';
    }
  }
  refreshQuota();

  function apiFetch(path, opts = {}) {
    return fetch(path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        'X-Device-Fingerprint': getFingerprint(),
      },
    });
  }

  /* --------------------------- modals --------------------------- */
  const modalProcessing = document.getElementById('modal-processing');
  const modalResult = document.getElementById('modal-result');
  const modalLimit = document.getElementById('modal-limit');
  const modalError = document.getElementById('modal-error');

  function openModal(el) { el.classList.add('open'); }
  function closeModal(el) { el.classList.remove('open'); }

  document.getElementById('result-close').addEventListener('click', () => closeModal(modalResult));
  document.getElementById('limit-close').addEventListener('click', () => closeModal(modalLimit));
  document.getElementById('error-close').addEventListener('click', () => closeModal(modalError));

  function showError(message) {
    document.getElementById('error-message').textContent = message;
    openModal(modalError);
  }

  /* ----------------------- AI tool flow -------------------------- */
  function wireAiTool({ dropzoneId, fileInputId, endpoint, title }) {
    const dz = document.getElementById(dropzoneId);
    const input = document.getElementById(fileInputId);

    dz.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

    async function handleFile(file) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        showError('Please use a PNG, JPEG, or WEBP image.');
        return;
      }

      document.getElementById('processing-title').textContent = title;
      openModal(modalProcessing);

      try {
        const { base64, mimeType } = await fileToBase64(file);
        const res = await apiFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, mimeType }),
        });

        closeModal(modalProcessing);

        if (res.status === 429) {
          openModal(modalLimit);
          return;
        }
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          showError(errBody.error || 'Processing failed. Please try again.');
          return;
        }

        const data = await res.json();
        const resultSrc = `data:${data.mimeType};base64,${data.image}`;
        document.getElementById('result-title').textContent = title;
        document.getElementById('result-image').src = resultSrc;
        document.getElementById('result-download').href = resultSrc;
        openModal(modalResult);
        refreshQuota();
      } catch (err) {
        closeModal(modalProcessing);
        showError('Network error. Please check your connection and try again.');
      } finally {
        input.value = '';
      }
    }
  }

  wireAiTool({
    dropzoneId: 'dz-remove-bg',
    fileInputId: 'file-remove-bg',
    endpoint: '/api/remove-bg',
    title: 'Removing background…',
  });
  wireAiTool({
    dropzoneId: 'dz-enhance',
    fileInputId: 'file-enhance',
    endpoint: '/api/enhance',
    title: 'Enhancing image…',
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const [, base64] = reader.result.split(',');
        resolve({ base64, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ------------------------- tabs (classic tools) ------------------------- */
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tool-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
    });
  });

  /* ------------------------- shared canvas loader ------------------------- */
  function wireDropzoneToCanvas(dzId, fileId, canvas, onLoaded) {
    const dz = document.getElementById(dzId);
    const input = document.getElementById(fileId);
    const ctx = canvas.getContext('2d');

    dz.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('dragover');
      if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) load(input.files[0]); });

    function load(file) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        onLoaded && onLoaded(img);
      };
      img.src = url;
    }
  }

  function downloadCanvas(canvas, filename, mime = 'image/png', quality) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL(mime, quality);
    link.click();
  }

  /* ------------------------- Crop & Resize ------------------------- */
  (() => {
    const canvas = document.getElementById('canvas-crop');
    const ctx = canvas.getContext('2d');
    const widthInput = document.getElementById('crop-width');
    const heightInput = document.getElementById('crop-height');
    const lockRatio = document.getElementById('crop-lock');
    let sourceImg = null;
    let aspect = 1;

    wireDropzoneToCanvas('dz-crop', 'file-crop', canvas, (img) => {
      sourceImg = img;
      aspect = img.naturalWidth / img.naturalHeight;
      widthInput.value = img.naturalWidth;
      heightInput.value = img.naturalHeight;
    });

    widthInput.addEventListener('input', () => {
      if (lockRatio.checked && aspect) heightInput.value = Math.round(widthInput.value / aspect);
    });
    heightInput.addEventListener('input', () => {
      if (lockRatio.checked && aspect) widthInput.value = Math.round(heightInput.value * aspect);
    });

    document.getElementById('btn-crop-apply').addEventListener('click', () => {
      if (!sourceImg) return showError('Drop an image first.');
      const w = parseInt(widthInput.value, 10);
      const h = parseInt(heightInput.value, 10);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(sourceImg, 0, 0, w, h);
    });

    document.getElementById('btn-crop-download').addEventListener('click', () => {
      if (!sourceImg) return showError('Drop an image first.');
      downloadCanvas(canvas, 'imgo-resized.png');
    });
  })();

  /* ------------------------- Format Converter ------------------------- */
  (() => {
    const canvas = document.getElementById('canvas-convert');
    let loaded = false;
    wireDropzoneToCanvas('dz-convert', 'file-convert', canvas, () => { loaded = true; });

    document.getElementById('btn-convert-download').addEventListener('click', () => {
      if (!loaded) return showError('Drop an image first.');
      const mime = document.getElementById('convert-format').value;
      const ext = mime.split('/')[1];
      downloadCanvas(canvas, `imgo-converted.${ext}`, mime, 0.92);
    });
  })();

  /* ------------------------- Compressor ------------------------- */
  (() => {
    const canvas = document.getElementById('canvas-compress');
    const qualityInput = document.getElementById('compress-quality');
    const qualityVal = document.getElementById('compress-quality-val');
    const readout = document.getElementById('compress-size-readout');
    let loaded = false;

    wireDropzoneToCanvas('dz-compress', 'file-compress', canvas, () => { loaded = true; updateReadout(); });
    qualityInput.addEventListener('input', () => {
      qualityVal.textContent = qualityInput.value;
      if (loaded) updateReadout();
    });

    function updateReadout() {
      canvas.toBlob((blob) => {
        if (blob) readout.textContent = `Estimated size: ${(blob.size / 1024).toFixed(1)} KB`;
      }, 'image/jpeg', qualityInput.value / 100);
    }

    document.getElementById('btn-compress-download').addEventListener('click', () => {
      if (!loaded) return showError('Drop an image first.');
      downloadCanvas(canvas, 'imgo-compressed.jpg', 'image/jpeg', qualityInput.value / 100);
    });
  })();

  /* ------------------------- Watermark ------------------------- */
  (() => {
    const canvas = document.getElementById('canvas-watermark');
    const ctx = canvas.getContext('2d');
    let sourceImg = null;

    wireDropzoneToCanvas('dz-watermark', 'file-watermark', canvas, (img) => { sourceImg = img; });

    document.getElementById('wm-opacity').addEventListener('input', (e) => {
      document.getElementById('wm-opacity-val').textContent = e.target.value;
    });
    document.getElementById('wm-size').addEventListener('input', (e) => {
      document.getElementById('wm-size-val').textContent = e.target.value;
    });

    document.getElementById('btn-watermark-apply').addEventListener('click', () => {
      if (!sourceImg) return showError('Drop an image first.');
      canvas.width = sourceImg.naturalWidth;
      canvas.height = sourceImg.naturalHeight;
      ctx.drawImage(sourceImg, 0, 0);

      const text = document.getElementById('wm-text').value || '© your name';
      const opacity = parseInt(document.getElementById('wm-opacity').value, 10) / 100;
      const size = parseInt(document.getElementById('wm-size').value, 10);
      const position = document.getElementById('wm-position').value;

      ctx.save();
      ctx.font = `600 ${size}px Inter, sans-serif`;
      ctx.fillStyle = `rgba(255,255,255,${opacity})`;
      ctx.strokeStyle = `rgba(0,0,0,${opacity * 0.5})`;
      ctx.lineWidth = Math.max(1, size / 16);
      const metrics = ctx.measureText(text);
      const pad = size * 0.6;

      if (position === 'tile') {
        ctx.textBaseline = 'middle';
        const stepX = metrics.width + pad * 3;
        const stepY = size * 3;
        for (let y = size; y < canvas.height + stepY; y += stepY) {
          for (let x = -stepX; x < canvas.width + stepX; x += stepX) {
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
          }
        }
      } else {
        let x = pad, y = canvas.height - pad;
        ctx.textBaseline = 'alphabetic';
        if (position === 'br') { x = canvas.width - metrics.width - pad; y = canvas.height - pad; }
        if (position === 'bl') { x = pad; y = canvas.height - pad; }
        if (position === 'tr') { x = canvas.width - metrics.width - pad; y = pad + size; }
        if (position === 'tl') { x = pad; y = pad + size; }
        if (position === 'center') { x = (canvas.width - metrics.width) / 2; y = canvas.height / 2; }
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      }
      ctx.restore();
    });

    document.getElementById('btn-watermark-download').addEventListener('click', () => {
      if (!sourceImg) return showError('Drop an image first.');
      downloadCanvas(canvas, 'imgo-watermarked.png');
    });
  })();

  /* ------------------------- Filter Presets ------------------------- */
  (() => {
    const canvas = document.getElementById('canvas-filters');
    const ctx = canvas.getContext('2d');
    let sourceImg = null;

    wireDropzoneToCanvas('dz-filters', 'file-filters', canvas, (img) => { sourceImg = img; });

    ['filter-brightness', 'filter-contrast'].forEach((id) => {
      document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById(`${id}-val`).textContent = e.target.value;
      });
    });

    document.getElementById('btn-filters-apply').addEventListener('click', () => {
      if (!sourceImg) return showError('Drop an image first.');
      canvas.width = sourceImg.naturalWidth;
      canvas.height = sourceImg.naturalHeight;

      const preset = document.getElementById('filter-preset').value;
      const brightness = document.getElementById('filter-brightness').value;
      const contrast = document.getElementById('filter-contrast').value;

      let filter = `brightness(${brightness}%) contrast(${contrast}%)`;
      if (preset === 'grayscale') filter += ' grayscale(100%)';
      if (preset === 'sepia') filter += ' sepia(85%)';
      if (preset === 'blur') filter += ' blur(3px)';

      ctx.filter = filter;
      ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
    });

    document.getElementById('btn-filters-download').addEventListener('click', () => {
      if (!sourceImg) return showError('Drop an image first.');
      downloadCanvas(canvas, 'imgo-filtered.png');
    });
  })();
})();
