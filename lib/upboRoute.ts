import { NextResponse } from "next/server";

export function jsonOk(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function jsonError(error: unknown) {
  const err = error as Error & { status?: number };
  const status = err.status && err.status >= 400 ? err.status : 400;
  return NextResponse.json({ ok: false, error: err.message || "unknown error" }, { status });
}

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function extensionTokenFromRequest(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : request.headers.get("x-upbo-extension-token")?.trim() || "";
}
