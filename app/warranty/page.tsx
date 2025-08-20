// app/warranty/page.tsx
"use client";

import { FormEvent, useState } from "react";
import NextImage from "next/image";

type FilePayload = { name: string; mimeType: string; content: string } | null;

/** ย่อรูป → JPEG (รองรับ iPhone/Safari + มี fallback) */
async function compressImageToBase64(
  file: File,
  opts: { maxW?: number; maxH?: number; quality?: number } = {}
): Promise<{ base64: string; mimeType: string; name: string }> {
  const { maxW = 1200, maxH = 1200, quality = 0.8 } = opts;

  // ถ้าไม่ใช่รูป (เช่น PDF) → ส่งไฟล์เดิม
  if (!file.type.startsWith("image/")) {
    const buf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { base64, mimeType: file.type || "application/octet-stream", name: file.name };
  }

  // พยายามโหลดแบบแก้ EXIF orientation (บาง Safari ไม่รองรับ createImageBitmap ก็ try/catch)
  let bmp: ImageBitmap | null = null;
  try {
    // @ts-ignore: imageOrientation อาจยังไม่มี type
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = null;
  }

  const loadImg = () =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = URL.createObjectURL(file);
    });

  let srcW: number, srcH: number, draw: (ctx: CanvasRenderingContext2D) => void;
  if (bmp) {
    srcW = bmp.width; srcH = bmp.height;
    draw = (ctx) => ctx.drawImage(bmp!, 0, 0, srcW, srcH);
  } else {
    const img = await loadImg();
    srcW = img.naturalWidth; srcH = img.naturalHeight;
    draw = (ctx) => ctx.drawImage(img, 0, 0, srcW, srcH);
  }

  const scale = Math.min(maxW / srcW, maxH / srcH, 1);
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);

  // ✅ toBlob fallback สำหรับ Safari/iOS รุ่นเก่า (บางเครื่อง toBlob คืน null)
  async function canvasToBlobJPEG(c: HTMLCanvasElement, q: number): Promise<Blob> {
    if (c.toBlob) {
      return await new Promise<Blob>((resolve, reject) => {
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/jpeg", q);
      });
    }
    // fallback ผ่าน dataURL → Blob
    const dataURL = c.toDataURL("image/jpeg", q);
    const byteStr = atob(dataURL.split(",")[1]);
    const bytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  }

  let blob: Blob;
  try {
    blob = await canvasToBlobJPEG(canvas, quality);
  } catch {
    // สุดท้ายจริง ๆ ส่งไฟล์ต้นฉบับไปเพื่อไม่ให้ค้าง
    const buf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { base64, mimeType: file.type || "application/octet-stream", name: file.name };
  } finally {
    bmp?.close?.();
  }

  const buf = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const name = file.name.replace(/\.(heic|heif|webp|png|gif|jpeg|jpg)$/i, "") + ".jpg";
  return { base64, mimeType: "image/jpeg", name };
}

export default function WarrantyPage() {
  const [loading, setLoading] = useState(false);
  const [agree, setAgree] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;

    if (!agree) {
      alert("กรุณาติ๊กยอมรับเงื่อนไขการรับประกันก่อนส่งแบบฟอร์ม");
      return;
    }

    const fd = new FormData(form);

    // เตรียมไฟล์ (ย่อถ้าเป็นรูป)
    const raw = (fd.get("evidence") as File) || null;
    let filePayload: FilePayload = null;
    if (raw && raw.size > 0) {
      try {
        const { base64, mimeType, name } = await compressImageToBase64(raw, { maxW: 1200, maxH: 1200, quality: 0.8 });
        filePayload = { name, mimeType, content: base64 };
      } catch {
        const buf = await raw.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
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

    // ✅ กันค้างบนมือถือ: ใส่ timeout เวลา fetch
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 45_000); // 45 วินาที

    try {
      setLoading(true);
      const res = await fetch("/api/warranty", { method: "POST", body: JSON.stringify(payload), signal: ac.signal });
      if (!res.ok) throw new Error("network or server error");
      const text = await res.text();
      const json = JSON.parse(text);
      if (!json.ok) throw new Error(json.error || "ส่งไม่สำเร็จ");

      alert("ลงทะเบียนสำเร็จ ขอบคุณครับ!");
      form.reset();
      setAgree(false);
    } catch (err: any) {
      console.error("submit error:", err);
      const msg =
        err?.name === "AbortError"
          ? "หมดเวลารอการเชื่อมต่อ (timeout) โปรดลองอีกครั้ง"
          : err?.message || "unknown";
      alert("เกิดข้อผิดพลาดในการส่งข้อมูล: " + msg);
    } finally {
      clearTimeout(t);
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
            <input className="w-input" name="phone" required placeholder="เช่น 0812345678" />
          </div>

          <div className="w-field">
            <label>อีเมล *</label>
            <input className="w-input" type="email" name="email" required placeholder="name@example.com" />
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
            <input className="w-file" type="file" name="evidence" accept="image/*,.pdf" required />
            <div className="w-hint">* ระบบจะย่อรูปอัตโนมัติก่อนอัปโหลด</div>
          </div>

          {/* ยอมรับเงื่อนไข + เปิดป๊อปอัป */}
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

      {/* ✅ Modal เงื่อนไข (สไตล์ inline เพื่อไม่ต้องแก้ CSS ไฟล์อื่น) */}
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
              <button
                className="w-btn w-btn-orange"
                onClick={() => { setAgree(true); setShowTerms(false); }}
              >
                ยอมรับเงื่อนไข
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
