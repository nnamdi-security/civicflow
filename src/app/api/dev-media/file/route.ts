import { isDevMediaStorage } from "@/server/adapters/media";
import { getMediaStorage } from "@/server/reports/deps";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** Serves photos from the dev store. 404 whenever the dev store is not the active storage. */
export async function GET(request: Request) {
  const storage = getMediaStorage();
  if (!isDevMediaStorage(storage)) return new Response("Not found", { status: 404 });

  const id = new URL(request.url).searchParams.get("id");
  const file = id ? await storage.readFile(id) : null;
  const contentType = file ? CONTENT_TYPES[file.format] : undefined;
  if (!file || !contentType) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": contentType,
      // Never let the browser sniff a stored file into something executable.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
