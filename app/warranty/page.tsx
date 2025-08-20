// app/warranty/page.tsx
"use client";

import { FormEvent, useMemo, useState } from "react";
import NextImage from "next/image";

type FilePayload = { name: string; mimeType: string; content: string } | null;

// ---------- Utilities ----------
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = String(fr.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function isIOSSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|ad|od)/.test(ua);
  const isWebkit = /WebKit/.test(ua);
  const isCriOS = /CriOS/.test(ua); // Chrome on iOS (ยังใช้ WebKit ใต้ท้อง)
  const isFxiOS = /FxiOS/.test(ua);
  return isIOS && isWebkit && !isCriOS && !isFxiOS;
}

/** ย่อรูป → JPEG (มี fallback เข้มข้น: ถ้าพลาด = ส่งไฟล์เดิมทันที) */
async function compressImageToBase64(
  file: File,
  opts: { maxW?: number; maxH?: number; quality?: number } = {}
): Promise<{ base64: string; mimeType: string; name: string }> {
  const { maxW = 1200, maxH = 1200, quality = 0.8 } = opts;

  // ไม่ใช่รูป → ส่งไฟล์เดิม
  if (!file.type.startsWith("image/")) {
    const base64 = await readFileAsBase64(file);
    return { base64, mimeType: file.type || "application/octet-stream", name: file.name };
  }

  // เคส iOS Safari: บางรุ่น toBlob/createImageBitmap มี issue → เลือก "simple path" ให้เสถียรที่สุดก่อน
  if (isIOSSafari()) {
    try {
      // ใช้ <img> + canvas + dataURL fallback เป็นหลัก
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = URL.createObjectURL(file);
      });

      // คำนวณ scale
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      const scale = Math.min(maxW / srcW, maxH / srcH, 1);
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no-2d-context");
      ctx.drawImage(img, 0, 0, outW, outH);

      // ใช้ dataURL (เชื่อมือสุดบน iOS)
      const dataURL = canvas.toDataURL("image/jpeg", quality);
      const base64 = dataURL.split(",")[1] || "";
      const name = file.name.replace(/\.(heic|heif|webp|png|gif|jpeg|jpg)$/i, "") + ".jpg";
      return { base64, mimeType: "image/jpeg", name };
    } catch {
      // ถ้าย่อไม่ได้จริง ๆ → ส่งไฟล์เดิม (อย่าให้ค้าง)
      const base64 = await readFileAsBase64(file);
      return { base64, mimeType: file.type || "application/octet-stream", name: file.name };
    }
  }

  // ทางปกติ (เบราว์เซอร์อื่น)
  let bmp: ImageBitmap | null = null;
  try {
    // @ts-ignore
    bmp = typeof createImageBitmap === "function" ? await createImageBitmap(file, { imageOrientation: "from-image" }) : null;
  } catch {
    bmp = null;
  }

  const loadImg = () =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  let srcW: number, srcH: number, draw: (ctx: CanvasRenderingContext2D) => void;
  if (bmp) {
    srcW = bmp.width;
    srcH = bmp.height;
    draw = (ctx) => ctx.drawImage(bmp!, 0, 0, srcW, srcH);
  } else {
    const img = await loadImg();
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;
    draw = (ctx) => ctx.drawImage(img, 0, 0, srcW, srcH);
  }

  const scale = Math.min(maxW / srcW, maxH / srcH, 1);
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);

  // toBlob + fallback
  async function canvasToBlobJPEG(c: HTMLCanvasElement, q: number): Promise<Blob> {
    if (c.toBlob) {
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", q));
      if (blob) return blob;
    }
    // fallback dataURL
    const dataURL = c.toDataURL("image/jpeg", q);
    const byteStr = atob((dataURL.split(",")[1] || ""));
    const bytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  }

  try {
    const blob = await canvasToBlobJPEG(canvas, quality);
    const buf = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const name = file.name.replace(/\.(heic|heif|webp|png|gif|jpeg|jpg)$/i, "") + ".jpg";
    return { base64, mimeType: "image/jpeg", name };
  } catch {
    // ย่อไม่ได้ → ส่งไฟล์เดิม
    const base64 = await readFileAsBase64(file);
    return { base64, mimeType: file.type || "application/octet-stream", name: file.name };
  } finally {
    try { bmp?.close?.(); } catch {}
  }
}

// ---------- Page ----------
export default function WarrantyPage() {
  const [loading, setLoading] = useState(false);
  const [agree, setAgree] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const isIOS = useMemo(() => isIOSSafari(), []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;

    if (!agree) {
      alert("กรุณาติ๊กยอมรับเงื่อนไขการรับประกันก่อนส่งแบบฟอร์ม");
      return;
    }

    const fd = new FormData(form);

    // ไฟล์แนบ
    const raw = (fd.get("evidence") as File) || null;
    let filePayload: FilePayload = null;
    if (raw && raw.size > 0) {
      try {
        // iOS → ลดไซส์ให้มากขึ้นนิดเพื่อกันเมม (1000px)
        const { base64, mimeType, name } = await compressImageToBase64(
          raw,
          isIOS ? { maxW: 1000, maxH: 1000, quality: 0.8 } : { maxW: 1200, maxH: 1200, quality: 0.8 }
        );
        filePayload = { name, mimeType, content: base64 };
      } catch {
        const base64 = await readFileAsBase64(raw);
        filePayload = { name: raw.name, mimeType: raw.type || "application/octet-stream", content: base64 };
      }
    }

    const payload = {
      fullName: String(fd.get("fullName") || "").trim(),
      address: String(fd.get("address") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      gender: String(fd.get("gender") || ""),
      birthday: String(fd.get("birthday") || ""),
      purchaseDate: String(fd.get("purchaseDate") || ""),
      store: String(fd.get("store") || "").trim(),
      evidence: filePayload,
    };

    if (!payload.fullName || !payload.phone || !payload.email || !payload.purchaseDate || !payload.evidence) {
      alert("กรุณากรอกข้อมูลที่มีเครื่องหมาย * และแนบหลักฐานให้ครบ");
      return;
    }

    // กันค้าง: timeout 45s (รองรับเบราว์เซอร์เก่า—ถ้า AbortController ไม่มี ให้ข้าม)
    let controller: AbortController | null = null;
    try { controller = new AbortController(); } catch {}
    const timer = controller ? setTimeout(() => controller!.abort(), 45_000) : null;

    try {
      setLoading(true);
      const res = await fetch("/api/warranty", {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // เผื่อ strict server
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { throw new Error("bad server response"); }
      if (!res.ok || !json?.ok) throw new Error(json?.error || "ส่งไม่สำเร็จ");

      alert("ลงทะเบียนสำเร็จ ขอบคุณครับ!");
      form.reset();
      setAgree(false);
    } catch (err: any) {
      console.error("submit error:", err);
      const msg = err?.name === "AbortError" ? "หมดเวลารอการเชื่อมต่อ (timeout)" : (err?.message || "unknown");
      alert("เกิดข้อผิดพลาดในการส่งข้อมูล: " + msg);
    } finally {
      if (timer) clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <div className="warranty-wrap">
      <div className="warranty-hero">
        <NextImage src="/warranty-header.png" alt="i LexXa" fill priority sizes="100vw" />
      </div>

      <h1 className="warranty-title">ลงทะเบียนรับประกันสินค้า</h1>
      <p className="warranty-sub">กรุณากรอกข้อมูลให้ครบถ้วนเพื่อรับสิทธิ์การรับประกันจาก i LexXa</p>

      <form className="warranty-form" onSubmit={handleSubmit}>
        <div className="w-grid">
          <div className="w-field span-2">
            <label>ชื่อ–สกุล *</label>
            <input className="w-input" name="fullName" required placeholder="เช่น สมชาย ใจดี" />
          </div>

          <div className="w-field span-2">
            <label>ที่อยู่</label>
            <input className="w-input" name="address" placeholder="บ้านเลขที่/ถนน/แขวง/อำเภอ/จังหวัด/รหัสไปรษณีย์" />
          </div>

          <div className="w-field">
            <label>เบอร์โทรศัพท์ *</label>
            <input className="w-input" name="phone" required placeholder="เช่น 0812345678" inputMode="tel" />
          </div>

          <div className="w-field">
            <label>อีเมล *</label>
            <input className="w-input" type="email" name="email" required placeholder="name@example.com" inputMode="email" />
          </div>

          <div className="w-field">
            <label>เพศ</label>
            <select className="w-select" name="gender" defaultValue="">
              <option value="">ไม่ระบุ</option>
              <option>ชาย</option>
              <option>หญิง</option>
              <option>อื่น ๆ</option>
            </select>
          </div>

          <div className="w-field">
            <label>วันเกิด</label>
            <input className="w-input" type="date" name="birthday" />
          </div>

          <div className="w-field">
            <label>วันที่ซื้อ *</label>
            <input className="w-input" type="date" name="purchaseDate" required />
          </div>

          <div className="w-field">
            <label>ร้าน/ช่องทางที่ซื้อ</label>
            <input className="w-input" name="store" placeholder="เช่น สาขา..., Shopee, Lazada" />
          </div>

          <div className="w-field span-2">
            <label>แนบหลักฐาน (รูปสินค้า/ใบเสร็จ) *</label>
            <input
              className="w-file"
              type="file"
              name="evidence"
              accept="image/*,.pdf"
              // ช่วยให้ iOS โชว์กล้อง/อัลบั้มง่ายขึ้น
              capture="environment"
              required
            />
            <div className="w-hint">* ระบบจะย่อรูปอัตโนมัติก่อนอัปโหลด (ถ้ามีปัญหาจะส่งไฟล์เดิมแทนทันที)</div>
          </div>

          {/* ติ๊กยอมรับ + ป๊อปอัปอ่านเงื่อนไข */}
          <div className="w-field span-2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="agree"
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              style={{ width: 18, height: 18 }}
              required
            />
            <label htmlFor="agree" style={{ userSelect: "none" }}>
              ยอมรับเงื่อนไขการรับประกัน{" "}
              <span
                onClick={() => setShowTerms(true)}
                style={{ color: "#fe7300", cursor: "pointer", textDecoration: "underline" }}
                role="button"
                aria-haspopup="dialog"
              >
                (อ่านเงื่อนไข)
              </span>
            </label>
          </div>

          <div className="span-2" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="w-btn w-btn-orange" type="submit" disabled={loading || !agree}>
              {loading ? "กำลังส่ง…" : "ลงทะเบียนรับประกัน"}
            </button>
          </div>
        </div>
      </form>

      {/* Modal เงื่อนไข */}
      {showTerms && (
        <div
          onClick={() => setShowTerms(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 60, padding: 16
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-labelledby="termsTitle"
            style={{
              width: "min(760px, 100%)", background: "#fff", borderRadius: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.25)", maxHeight: "90vh",
              display: "flex", flexDirection: "column", overflow: "hidden"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #eee" }}>
              <h3 id="termsTitle" style={{ margin: 0 }}>เงื่อนไขการรับประกัน</h3>
              <button onClick={() => setShowTerms(false)} aria-label="Close" style={{ border: 0, background: "transparent", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ padding: "14px 16px", overflow: "auto", lineHeight: 1.7 }}>
              <p><strong>เงื่อนไขการรับประกัน</strong></p>
              <ol>
                <li>iLexXa รับประกันผลิตภัณฑ์ที่ซื้อในประเทศไทย โดยทั่วไป 1 ปี (บางรุ่น 6 เดือน) นับจากวันที่ซื้อ</li>
                <li>รับประกันความเสียหายจากการผลิต/การใช้งานที่ถูกต้อง ต้องส่งสินค้าตรวจสอบกับบริษัทฯ ทุกครั้ง</li>
                <li>หากเข้าเงื่อนไข บริษัทจะเปลี่ยนเฉพาะอุปกรณ์ที่เสีย โดยพิจารณาตามความเหมาะสม และอาจต้องมีการลงทะเบียน/ใบเสร็จสมบูรณ์</li>
                <li>การรับประกันไม่ครอบคลุมวัสดุสิ้นเปลือง/อุปกรณ์เสริมบางชนิด</li>
                <li>ความเสียหายจากการใช้งานผิดวิธี อุบัติเหตุ ภัยธรรมชาติ สัตว์/แมลง ฯลฯ อยู่นอกการรับประกัน</li>
              </ol>

              <p><strong>ข้อยกเว้นความคุ้มครอง</strong></p>
              <ol>
                <li>ใช้งานผิดวัตถุประสงค์/ฝ่าฝืนคำแนะนำ</li>
                <li>ความเสียหายอันเนื่องจากน้ำ/สภาพอากาศ/การดัดแปลง/ซ่อมแซม/โปรแกรม</li>
                <li>สงคราม จลาจล ก่อการร้าย คำสั่งของรัฐ ฯลฯ</li>
                <li>ความสูญเสียจากอัคคีภัย/โจรกรรม</li>
                <li>สึกหรอ เสื่อมสภาพ แมลง/สัตว์ทำลาย การทำความสะอาด/บูรณะ</li>
                <li>ปฏิกิริยานิวเคลียร์/กัมมันตภาพรังสี</li>
                <li>การกระทำโดยเจตนาหรือประมาทเลินเล่ออย่างร้ายแรง</li>
                <li>การฉ้อโกง/ไม่ซื่อสัตย์</li>
              </ol>

              <p><strong>เงื่อนไขสิทธิประกันภัย</strong> ลูกค้าต้องลงทะเบียนภายใน 7 วันนับจากวันที่ซื้อสินค้า</p>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "12px 16px", borderTop: "1px solid #eee" }}>
              <button className="w-btn" onClick={() => setShowTerms(false)}>ปิด</button>
              <button className="w-btn w-btn-orange" onClick={() => { setAgree(true); setShowTerms(false); }}>
                ยอมรับเงื่อนไข
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
