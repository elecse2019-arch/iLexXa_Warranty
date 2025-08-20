// app/api/warranty/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();

    // parse JSON
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    // ✅ เติมค่า default ที่ปลายทางคาดหวัง
    if (!("product" in data)) data.product = "N/A";
    if (!("serial"  in data)) data.serial  = "N/A";

    // ✅ ทำให้เข้ากันได้กับ Apps Script เดิม: evidence -> file
    if (!data.file && data.evidence) {
      data.file = data.evidence;
      delete data.evidence;
    }

    const url = process.env.APPSCRIPT_WEB_APP_URL;
    if (!url) {
      return NextResponse.json({ ok: false, error: "Missing APPSCRIPT_WEB_APP_URL" }, { status: 500 });
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const raw = await resp.text();
    let upstream: any; try { upstream = JSON.parse(raw); } catch { upstream = { raw }; }

    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: upstream?.error || raw }, { status: 502 });
    }

    return NextResponse.json({ ok: true, upstream });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
