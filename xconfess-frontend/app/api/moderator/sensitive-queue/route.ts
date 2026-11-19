import { NextRequest } from "next/server";
import { resolveBackendRoute } from "@/app/lib/api/proxy";

export async function GET(request: NextRequest) {
  const backend = resolveBackendRoute(request, "/moderator/sensitive-queue");
  try {
    const response = await fetch(backend.url, {
      headers: {
        Cookie: request.headers.get("cookie") || "",
        ...(request.headers.get("x-correlation-id")
          ? { "X-Correlation-ID": request.headers.get("x-correlation-id")! }
          : {}),
      },
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
