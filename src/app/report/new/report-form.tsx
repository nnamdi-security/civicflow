"use client";

import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { LocationField } from "@/components/location-field";
import type { LonLat } from "@/components/map-picker";
import {
  DESCRIPTION_MAX,
  validateNewReport,
  type ReportIssue,
} from "@/domain/reports/new-report";
import { submitReport } from "./actions";
import { ISSUE_MESSAGES, failureMessage } from "./messages";
import { PhotoPicker } from "./photo-picker";

interface ReportFormProps {
  categories: { id: string; name: string }[];
}

export function ReportForm({ categories }: ReportFormProps) {
  const id = useId();
  const router = useRouter();
  // One key per form instance: a double click or retry returns the same report.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [point, setPoint] = useState<LonLat | null>(null);
  const [photos, setPhotos] = useState<{ publicIds: string[]; busy: boolean }>({ publicIds: [], busy: false });
  const [issues, setIssues] = useState<ReportIssue[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onPhotos = useCallback((state: { publicIds: string[]; busy: boolean }) => setPhotos(state), []);
  const issueFor = (field: ReportIssue["field"]) => {
    const issue = issues.find((i) => i.field === field);
    return issue ? ISSUE_MESSAGES[issue.code] : undefined;
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Same rules as the server, for instant feedback. The server checks again.
    const local = validateNewReport({
      categoryId,
      description,
      lon: point?.lon ?? Number.NaN,
      lat: point?.lat ?? Number.NaN,
      photoCount: photos.publicIds.length,
    });
    const missingCategory = categoryId === "";
    setCategoryError(missingCategory ? "Choose a category." : null);
    setIssues(local.ok ? [] : local.issues);
    if (!local.ok || missingCategory) return;

    setSubmitting(true);
    try {
      const result = await submitReport({
        categoryId,
        description,
        lon: point?.lon,
        lat: point?.lat,
        photoPublicIds: photos.publicIds,
        idempotencyKey,
      });
      if (result.ok) {
        router.push(`/reports/${result.report.id}`);
        return;
      }
      if (result.reason === "invalid") setIssues(result.issues);
      setFormError(failureMessage(result));
    } catch {
      setFormError("We could not send your report. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "min-h-11 w-full rounded-md border border-current bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-category`} className="font-medium">
          What is the problem?
        </label>
        <select
          id={`${id}-category`}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-invalid={categoryError ? true : undefined}
          aria-describedby={categoryError ? `${id}-category-error` : undefined}
          className={fieldClass}
        >
          <option value="">Choose a category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {categoryError ? (
          <p id={`${id}-category-error`} role="alert">
            Error: {categoryError}
          </p>
        ) : null}
      </div>

      <LocationField value={point} onChange={setPoint} error={issueFor("location")} />

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-description`} className="font-medium">
          Describe the problem
        </label>
        <textarea
          id={`${id}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={DESCRIPTION_MAX + 200}
          aria-invalid={issueFor("description") ? true : undefined}
          aria-describedby={`${id}-description-help`}
          className={`${fieldClass} py-2`}
        />
        <p id={`${id}-description-help`}>
          {[...description].length} / {DESCRIPTION_MAX} characters. Say what is wrong and where, for example
          the nearest landmark.
        </p>
        {issueFor("description") ? <p role="alert">Error: {issueFor("description")}</p> : null}
      </div>

      <PhotoPicker onChange={onPhotos} error={issueFor("photos")} />

      {formError ? (
        <p role="alert" className="rounded-md border border-current p-3">
          Error: {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting || photos.busy}>
        {submitting ? "Sending…" : photos.busy ? "Waiting for photos…" : "Send report"}
      </Button>
    </form>
  );
}
