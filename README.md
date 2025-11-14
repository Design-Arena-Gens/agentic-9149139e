# Universal Offline OCR

Universal Offline OCR is a secure, browser-based document digitisation suite built with Next.js. It recognises text from images, PDFs, and DOCX files entirely on-device, supports multiple languages, and ships with export tools for TXT, PDF, DOCX, and PNG formats. The experience is installable as a PWA and remains fully functional offline once assets are cached.

## ✨ Highlights

- 🔒 **Private by design** – No server round-trips; everything runs locally in the browser.
- 🌍 **Multi-language OCR** – Bundled models for English, Spanish, French, German, Arabic, Hindi, and Simplified Chinese, with UI support for importing extra Tesseract language packs.
- 📄 **Rich document support** – Handles raster images, multi-page PDFs, and Word documents (text extraction plus embedded image OCR).
- 📦 **Flexible exports** – Download recognised text as TXT, PDF, DOCX, or visual PNG transcripts.
- 📶 **Offline ready** – Ships with a service worker via `next-pwa`; once installed, works without network access.
- 🔐 **Security-first UX** – Clear indicators of offline readiness and language pack storage.

## 🚀 Getting Started

> Requirements: Node.js 18+ and npm.

```bash
cd ocr-app
npm install
npm run dev
```

Visit `http://localhost:3000` to use the application. The initial load will cache the bundled language models and OCR runtime so subsequent sessions function offline.

### Production build

```bash
npm run build
npm start
```

## 🧱 Project Structure

```
ocr-app/
├── public/              # Static assets, PWA manifest, bundled language packs
├── src/
│   ├── app/             # Next.js App Router pages & global styles
│   └── lib/             # OCR pipeline helpers, exporters, cache utilities
├── worker/              # Custom service worker injected by next-pwa
├── next.config.mjs
└── package.json
```

## 🧠 Architecture Notes

- **OCR Engine** – `tesseract.js` running inside the browser with locally-hosted worker/core wasm bundles.
- **Document Parsing** – `pdfjs-dist` renders PDF pages to canvases; `mammoth` + `jszip` extract text and embedded imagery from DOCX files.
- **Offline Cache** – `next-pwa` generates the service worker, while a custom handler caches `/tesseract/*.traineddata` requests to keep language packs offline.
- **Exports** – `file-saver`, `jspdf`, and `docx` generate the various output formats; PNG export is rendered via canvas.

## 🛡️ Security & Privacy

- No data leaves the browser—ideal for sensitive documents.
- All optional language packs are cached in the browser’s Cache Storage; users can purge them through standard browser settings.
- The PWA manifest allows installable, sandboxed usage.

## 📄 License

MIT © 2025 Universal Offline OCR contributors.
