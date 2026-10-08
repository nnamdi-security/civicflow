import { DevMediaStorage } from "@/server/adapters/media";
import { MediaVerificationError } from "@/server/adapters/media/media-storage";
import { getMediaStorage } from "@/server/reports/deps";

export const dynamic = "force-dynamic";

/**
 * Development stand-in for Cloudinary's upload endpoint (ADR 0008). Only exists when the dev
 * store is active, which never happens in production.
 */
export async function POST(request: Request) {
  const storage = getMediaStorage();
  if (!(storage instanceof DevMediaStorage)) return new Response("Not found", { status: 404 });

  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  const file = form?.get("file");
  const width = Number(form?.get("width"));
  const height = Number(form?.get("height"));
  if (typeof token !== "string" || !(file instanceof File)) {
    return new Response("Bad request", { status: 400 });
  }

  try {
    const asset = await storage.acceptUpload({
      token,
      bytes: new Uint8Array(await file.arrayBuffer()),
      width: Number.isFinite(width) && width > 0 ? width : 1,
      height: Number.isFinite(height) && height > 0 ? height : 1,
    });
    return Response.json({
      public_id: asset.publicId,
      format: asset.format,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
    });
  } catch (error) {
    if (error instanceof MediaVerificationError) {
      return Response.json({ error: error.code }, { status: error.code === "not_owner" ? 403 : 400 });
    }
    throw error;
  }
}
