export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, service: "weflab-upbo-mvp", time: new Date().toISOString() });
}
