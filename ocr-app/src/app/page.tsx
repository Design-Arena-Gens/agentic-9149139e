"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  builtInLanguages,
  LanguageOption,
} from "@/lib/languages";
import {
  ensureLanguageCached,
  importLanguageFromFile,
} from "@/lib/cacheLanguage";
import {
  blobsToRenderedPages,
  extractDocxImages,
  extractDocxText,
  processImageFile,
  processPdfFile,
  type RenderedPage,
} from "@/lib/fileProcessors";
import { recognizeImage } from "@/lib/ocrWorker";
import {
  exportAsDocx,
  exportAsImage,
  exportAsPdf,
  exportAsText,
} from "@/lib/exporters";

type JobStatus = "pending" | "processing" | "completed" | "error";

type RecognizedSegment = {
  pageIndex: number;
  text: string;
  confidence: number;
};

type OcrJob = {
  id: string;
  name: string;
  type: string;
  size: number;
  status: JobStatus;
  languages: string[];
  progress: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  segments: RecognizedSegment[];
  extractedText: string;
  warnings: string[];
};

const SUPPORTED_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const readableFileType = (mimeType: string, fileName: string) => {
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) return "PDF";
  if (fileName.endsWith(".docx")) return "Word Document";
  return mimeType || "Unknown";
};

const isImage = (file: File) => file.type.startsWith("image/");

const isPdf = (file: File) =>
  file.type === "application/pdf" || file.name.endsWith(".pdf");

const isDocx = (file: File) =>
  file.type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
  file.name.endsWith(".docx");

const combineSegments = (segments: RecognizedSegment[]) =>
  segments
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((segment, index) => {
      const confidence = segment.confidence.toFixed(2);
      return `--- Page ${index + 1} (Confidence: ${confidence}%) ---\n${segment.text.trim()}\n`;
    })
    .join("\n");

export default function Home() {
  const [availableLanguages, setAvailableLanguages] =
    useState<LanguageOption[]>(builtInLanguages);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(["eng"]);
  const [jobs, setJobs] = useState<OcrJob[]>([]);
  const [isImportingLanguage, setIsImportingLanguage] = useState(false);
  const [languageCodeInput, setLanguageCodeInput] = useState("");
  const [languageFile, setLanguageFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileMap = useRef(new Map<string, File>());

  useEffect(() => {
    availableLanguages
      .filter((lang) => lang.builtIn)
      .forEach((lang) => {
        void ensureLanguageCached(lang).catch(() => {
          // We intentionally swallow the error to keep the UI responsive.
        });
      });
  }, [availableLanguages]);

  const totalPending = useMemo(
    () => jobs.filter((job) => job.status === "processing").length,
    [jobs],
  );

  const handleLanguageToggle = useCallback(
    (code: string) => {
      setSelectedLanguages((prev) => {
        if (prev.includes(code)) {
          const next = prev.filter((item) => item !== code);
          return next.length > 0 ? next : prev;
        }
        return [...prev, code];
      });
    },
    [setSelectedLanguages],
  );

  const updateJob = useCallback((id: string, partial: Partial<OcrJob>) => {
    setJobs((prev) =>
      prev.map((job) => (job.id === id ? { ...job, ...partial } : job)),
    );
  }, []);

  const appendSegment = useCallback((id: string, segment: RecognizedSegment) => {
    setJobs((prev) =>
      prev.map((job) =>
        job.id === id
          ? { ...job, segments: [...job.segments, segment] }
          : job,
      ),
    );
  }, []);

  const processFile = useCallback(
    async (jobId: string) => {
      const job = jobs.find((entry) => entry.id === jobId);
      const file = fileMap.current.get(jobId);
      if (!job || !file) return;

      updateJob(jobId, { status: "processing", progress: 0, error: undefined });

      try {
        const languageEntries = job.languages
          .map((code) => availableLanguages.find((lang) => lang.code === code))
          .filter(Boolean) as LanguageOption[];

        await Promise.all(
          languageEntries.map((language) => ensureLanguageCached(language)),
        );

        let canvases: RenderedPage[] = [];
        const warnings: string[] = [];
        let extractedText = "";

        if (isImage(file)) {
          canvases = await processImageFile(file);
        } else if (isPdf(file)) {
          canvases = await processPdfFile(file);
        } else if (isDocx(file)) {
          extractedText = await extractDocxText(file);
          const imageBlobs = await extractDocxImages(file);
          if (imageBlobs.length === 0) {
            warnings.push(
              "No embedded images found in the document; OCR is limited to textual extraction.",
            );
          } else {
            canvases = await blobsToRenderedPages(imageBlobs);
          }
        } else {
          throw new Error("Unsupported file type");
        }

        if (canvases.length === 0 && !extractedText) {
          warnings.push("No visual content found for OCR.");
        }

        const languageList = job.languages;

        for (let index = 0; index < canvases.length; index += 1) {
          const { canvas } = canvases[index];
          const start = performance.now();
          const result = await recognizeImage(
            canvas,
            languageList,
            (progress) => {
              updateJob(jobId, {
                progress:
                  (index + progress) / (canvases.length || 1),
              });
            },
          );
          const duration = performance.now() - start;

          appendSegment(jobId, {
            pageIndex: index,
            text: result.text,
            confidence: result.confidence,
          });

          const durationWarning =
            duration > 15000
              ? `Page ${index + 1} took ${(duration / 1000).toFixed(
                  1,
                )}s to process. Consider splitting large documents.`
              : null;
          if (durationWarning) {
            warnings.push(durationWarning);
          }

          updateJob(jobId, {
            progress: (index + 1) / (canvases.length || 1),
            warnings: [...warnings],
          });
        }

        updateJob(jobId, {
          status: "completed",
          completedAt: Date.now(),
          extractedText,
          warnings,
          progress: 1,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected error";
        updateJob(jobId, { status: "error", error: message });
      } finally {
        fileMap.current.delete(jobId);
      }
    },
    [appendSegment, availableLanguages, jobs, updateJob],
  );

  useEffect(() => {
    const pending = jobs.filter((job) => job.status === "pending");
    if (pending.length === 0) return;
    pending.forEach((job) => {
      void processFile(job.id);
    });
  }, [jobs, processFile]);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const accepted: File[] = [];
      const rejected: string[] = [];

      Array.from(fileList).forEach((file) => {
        if (
          SUPPORTED_FILE_TYPES.includes(file.type) ||
          isImage(file) ||
          isPdf(file) ||
          isDocx(file)
        ) {
          accepted.push(file);
        } else {
          rejected.push(file.name);
        }
      });

      if (rejected.length > 0) {
        const jobId = uuid();
        setJobs((prev) => [
          {
            id: jobId,
            name: "Unsupported files",
            type: "System",
            size: 0,
            status: "error",
            languages: selectedLanguages,
            progress: 0,
            startedAt: Date.now(),
            error: `Unsupported files: ${rejected.join(", ")}`,
            segments: [],
            extractedText: "",
            warnings: [],
          },
          ...prev,
        ]);
      }

      accepted.forEach((file) => {
        const id = uuid();
        fileMap.current.set(id, file);
        setJobs((prev) => [
          {
            id,
            name: file.name,
            type: readableFileType(file.type, file.name),
            size: file.size,
            status: "pending",
            languages: [...selectedLanguages],
            progress: 0,
            startedAt: Date.now(),
            segments: [],
            extractedText: "",
            warnings: [],
          },
          ...prev,
        ]);
      });
    },
    [selectedLanguages],
  );

  const aggregatedText = useCallback(
    (job: OcrJob) =>
      `${job.extractedText ? `${job.extractedText.trim()}\n\n` : ""}${combineSegments(job.segments)}`,
    [],
  );

  const handleExport = useCallback(
    async (job: OcrJob, format: "txt" | "pdf" | "docx" | "png") => {
      const content = aggregatedText(job);
      switch (format) {
        case "txt":
          exportAsText(content, job.name);
          break;
        case "pdf":
          await exportAsPdf(content, job.name);
          break;
        case "docx":
          await exportAsDocx(content, job.name);
          break;
        case "png":
          await exportAsImage(content, job.name);
          break;
        default:
          break;
      }
    },
    [aggregatedText],
  );

  const handleLanguageImport = useCallback(async () => {
    if (!languageFile || !languageCodeInput.trim()) return;
    setIsImportingLanguage(true);
    try {
      const { code, path } = await importLanguageFromFile(
        languageCodeInput.toLowerCase(),
        languageFile,
      );
      const option: LanguageOption = {
        code,
        label: code.toUpperCase(),
        path,
      };
      setAvailableLanguages((prev) => [...prev, option]);
      setSelectedLanguages((prev) =>
        prev.includes(code) ? prev : [...prev, code],
      );
      setLanguageCodeInput("");
      setLanguageFile(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsImportingLanguage(false);
    }
  }, [languageCodeInput, languageFile]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 pb-16 pt-12 md:px-12">
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl shadow-blue-900/20 backdrop-blur">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.35em] text-blue-400">
            Universal Offline OCR
          </p>
          <h1 className="text-4xl font-semibold text-white md:text-5xl">
            Extract text securely from any document, anywhere.
          </h1>
        </div>
        <p className="max-w-3xl text-lg text-slate-200">
          Drop images, PDFs, or Word documents to run high-accuracy OCR directly
          in your browser. Everything stays on-device, works offline, and
          exports clean transcripts to text, PDF, DOCX, or image formats.
        </p>
        <div className="flex flex-wrap gap-4 text-sm text-slate-300">
          <span className="rounded-full bg-blue-500/10 px-4 py-1 text-blue-200">
            Offline ready
          </span>
          <span className="rounded-full bg-emerald-500/10 px-4 py-1 text-emerald-200">
            Multi-language OCR
          </span>
          <span className="rounded-full bg-purple-500/10 px-4 py-1 text-purple-200">
            Secure &amp; private
          </span>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-8">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-10 text-center shadow-lg shadow-blue-900/10">
            <label
              htmlFor="file-upload"
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handleFiles(event.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-8 transition ${
                isDragging
                  ? "border-blue-400 bg-blue-500/10 text-blue-100"
                  : "border-slate-700 text-slate-200"
              }`}
            >
              <span className="text-lg font-medium">
                Drag &amp; drop files or click to browse
              </span>
              <span className="text-sm text-slate-400">
                Images (PNG, JPG, TIFF, GIF), PDFs, DOCX documents
              </span>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                multiple
                onChange={(event) => handleFiles(event.target.files)}
              />
              <div className="mt-4 flex items-center gap-2 rounded-full bg-blue-500/10 px-6 py-2 text-blue-300">
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                {totalPending > 0
                  ? `Processing ${totalPending} item${totalPending > 1 ? "s" : ""}…`
                  : "All secure and offline"}
              </div>
            </label>
          </div>

          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">
              Recognition Queue
            </h2>
            {jobs.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-800 p-10 text-center text-slate-500">
                Upload a file to start OCR. Processed documents will appear here
                with export tools.
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {jobs.map((job) => {
                  const content = aggregatedText(job);
                  return (
                    <article
                      key={job.id}
                      className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner shadow-slate-950/50"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <h3 className="text-lg font-semibold text-white">
                            {job.name}
                          </h3>
                          <p className="text-sm text-slate-400">
                            {job.type} ·{" "}
                            {(job.size / (1024 * 1024)).toFixed(2)} MB ·{" "}
                            {job.languages.join(", ").toUpperCase()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-300">
                          <span
                            className={`rounded-full px-3 py-1 ${
                              job.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-200"
                                : job.status === "processing"
                                  ? "bg-blue-500/10 text-blue-200"
                                  : job.status === "error"
                                    ? "bg-rose-500/10 text-rose-200"
                                    : "bg-slate-700/60 text-slate-200"
                            }`}
                          >
                            {job.status.toUpperCase()}
                          </span>
                          <span>
                            {job.status === "completed"
                              ? `Finished in ${job.completedAt && job.startedAt ? ((job.completedAt - job.startedAt) / 1000).toFixed(1) : "—"}s`
                              : `${Math.round(job.progress * 100)}%`}
                          </span>
                        </div>
                      </div>

                      {job.status === "processing" && (
                        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${Math.max(job.progress * 100, 8)}%` }}
                          />
                        </div>
                      )}

                      {job.error && (
                        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                          {job.error}
                        </p>
                      )}

                      {job.warnings.length > 0 && (
                        <ul className="mt-4 space-y-2 text-sm text-amber-200">
                          {job.warnings.map((warning, idx) => (
                            <li
                              key={`${job.id}-warning-${idx}`}
                              className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3"
                            >
                              ⚠ {warning}
                            </li>
                          ))}
                        </ul>
                      )}

                      {job.status === "completed" && (
                        <div className="mt-6 space-y-4">
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => void handleExport(job, "txt")}
                              className="rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
                            >
                              Export TXT
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleExport(job, "pdf")}
                              className="rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
                            >
                              Export PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleExport(job, "docx")}
                              className="rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
                            >
                              Export DOCX
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleExport(job, "png")}
                              className="rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
                            >
                              Export Image
                            </button>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard?.writeText(content)}
                              className="rounded-full bg-blue-500/20 px-4 py-2 text-sm text-blue-100 transition hover:bg-blue-500/30"
                            >
                              Copy Text
                            </button>
                          </div>
                          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left text-sm text-slate-200">
                            {content || "No text detected."}
                          </pre>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-8">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold text-white">Languages</h2>
            <p className="mt-1 text-sm text-slate-400">
              Select all languages that appear in your document for the best
              accuracy.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {availableLanguages.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => handleLanguageToggle(language.code)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    selectedLanguages.includes(language.code)
                      ? "border-blue-400 bg-blue-500/20 text-blue-100"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {language.label} ({language.code})
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold text-white">
              Add Custom Language
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Import <code>.traineddata</code> or <code>.traineddata.gz</code>{" "}
              files to run OCR in additional languages offline.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <input
                type="text"
                value={languageCodeInput}
                onChange={(event) => setLanguageCodeInput(event.target.value)}
                placeholder="Language code (e.g. jpn, rus)"
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
              />
              <input
                type="file"
                accept=".traineddata,.traineddata.gz"
                onChange={(event) =>
                  setLanguageFile(event.target.files?.[0] ?? null)
                }
                className="text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-blue-500/20 file:px-3 file:py-2 file:text-blue-100 file:hover:bg-blue-500/30"
              />
              <button
                type="button"
                disabled={
                  isImportingLanguage ||
                  !languageFile ||
                  languageCodeInput.trim().length === 0
                }
                onClick={() => void handleLanguageImport()}
                className="rounded-full bg-blue-500/20 px-4 py-2 text-sm text-blue-100 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              >
                {isImportingLanguage ? "Importing…" : "Add Language"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
            <h2 className="text-lg font-semibold text-white">Security</h2>
            <ul className="mt-3 space-y-2">
              <li>• Processing happens entirely in-browser.</li>
              <li>• Documents never leave your device.</li>
              <li>• PWA support lets you install and run fully offline.</li>
              <li>
                • Cached language packs stay local and can be cleared via browser
                storage.
              </li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
