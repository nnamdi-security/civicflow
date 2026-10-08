"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PHOTOS_MAX } from "@/domain/reports/new-report";
import { authorizeUpload } from "./actions";

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;

interface Photo {
  key: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  publicId?: string;
  message?: string;
}

interface PhotoPickerProps {
  /** Called whenever the finished uploads or the busy state change. */
  onChange: (state: { publicIds: string[]; busy: boolean }) => void;
  error?: string;
}

/**
 * Shrinks the photo in the browser before upload (low-bandwidth). Re-encoding through a canvas
 * also drops embedded EXIF data, including GPS. Falls back to the original file if the browser
 * cannot decode it; the server still validates whatever arrives.
 */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (blob) return { blob, width, height };
  } catch {
    // fall through to the original file
  }
  return { blob: file, width: 0, height: 0 };
}

async function upload(file: File): Promise<string> {
  const { blob, width, height } = await shrink(file);
  const authorization = await authorizeUpload();
  if (!authorization.ok) throw new Error("You have added too many photos recently. Try again later.");

  const form = new FormData();
  for (const [name, value] of Object.entries(authorization.fields)) form.append(name, value);
  // Only our dev store needs the size; real providers measure it themselves.
  if (authorization.uploadUrl.startsWith("/")) {
    form.append("width", String(width));
    form.append("height", String(height));
  }
  form.append("file", blob, "photo.jpg");

  const response = await fetch(authorization.uploadUrl, { method: "POST", body: form });
  if (!response.ok) throw new Error("The photo could not be uploaded. Try again.");
  const body: unknown = await response.json();
  const publicId =
    typeof body === "object" && body !== null && "public_id" in body ? (body as { public_id: unknown }).public_id : null;
  if (typeof publicId !== "string") throw new Error("The photo could not be uploaded. Try again.");
  return publicId;
}

export function PhotoPicker({ onChange, error }: PhotoPickerProps) {
  const id = useId();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange({
      publicIds: photos.flatMap((p) => (p.status === "done" && p.publicId ? [p.publicId] : [])),
      busy: photos.some((p) => p.status === "uploading"),
    });
  }, [photos, onChange]);

  // Preview URLs hold memory until revoked; release any that remain when the picker goes away.
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const update = useCallback((key: string, patch: Partial<Photo>) => {
    setPhotos((current) => current.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }, []);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const room = PHOTOS_MAX - photos.length;
    for (const file of Array.from(files).slice(0, room)) {
      const key = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      setPhotos((current) => [...current, { key, previewUrl, status: "uploading" }]);
      upload(file).then(
        (publicId) => update(key, { status: "done", publicId }),
        (e: unknown) => update(key, { status: "error", message: e instanceof Error ? e.message : "Upload failed." }),
      );
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(key: string) {
    const photo = photos.find((p) => p.key === key);
    if (photo) {
      URL.revokeObjectURL(photo.previewUrl);
      previewUrls.current.delete(photo.previewUrl);
    }
    setPhotos((current) => current.filter((p) => p.key !== key));
  }

  const full = photos.length >= PHOTOS_MAX;

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="font-medium">Photos (1 to {PHOTOS_MAX} required)</legend>
      <label htmlFor={`${id}-file`} className="sr-only">
        Add a photo
      </label>
      <input
        ref={inputRef}
        id={`${id}-file`}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        disabled={full}
        onChange={(e) => void addFiles(e.target.files)}
        className="min-h-11 text-base"
      />
      {full ? <p>You have added the maximum of {PHOTOS_MAX} photos.</p> : null}

      <ul className="flex flex-col gap-3">
        {photos.map((photo, index) => (
          <li key={photo.key} className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not optimizable */}
            <img src={photo.previewUrl} alt={`Preview of photo ${index + 1}`} className="h-16 w-16 rounded-md object-cover" />
            <span role="status" className="flex-1">
              {photo.status === "uploading" ? "Uploading…" : null}
              {photo.status === "done" ? "Uploaded" : null}
              {photo.status === "error" ? `Failed: ${photo.message ?? "Upload failed."}` : null}
            </span>
            <button
              type="button"
              onClick={() => remove(photo.key)}
              className="min-h-11 rounded-md border border-current px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Remove photo {index + 1}
            </button>
          </li>
        ))}
      </ul>

      {error ? (
        <p id={`${id}-error`} role="alert">
          Error: {error}
        </p>
      ) : null}
    </fieldset>
  );
}
