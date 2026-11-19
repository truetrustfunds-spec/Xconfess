import { NextRequest } from "next/server";
import { resolveBackendRoute } from "@/app/lib/api/proxy";

const allowedOperations = new Set([
  "access-grants",
  "policy-apply",
  "policy-previews",
  "policy-rollback",
  "report-clusters",
  "shadow-evaluation",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await params;
  if (segments.length !== 1 || !allowedOperations.has(segments[0])) {
    return Response.json({ message: "Moderation operation not found." }, { status: 404 });
  }

  const backend = resolveBackendRoute(
    request,
    `/admin/moderation/operations/${segments[0]}`,
  );
  try {
    const response = await fetch(backend.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: request.headers.get("cookie") || "",
        ...(request.headers.get("x-correlation-id")
          ? { "X-Correlation-ID": request.headers.get("x-correlation-id")! }
          : {}),
      },
      body: await request.text(),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return Response.json(
      { message: "Moderation service is unavailable. Please retry." },
      { status: 502 },
    );
  }
}
