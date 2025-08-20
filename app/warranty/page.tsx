// app/warranty/page.tsx
"use client";

import { FormEvent, useState } from "react";
import NextImage from "next/image";

type FilePayload = { name: string; mimeType: string; content: string } | null;

/** ย่อรูป → JPEG (รองรับมือถือ/iOS เก่า) */
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

  // โหลดรูป (พยายามแก้ orientation)
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" as any });
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

  let srcW: number,
    srcH: number,
    draw: (ctx: CanvasRenderingContext2D) => void;

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

  // toBlob fallback (สำหรับ Safari/iOS)
  async function canvasToBlobJPEG(c: HTMLCanvasElement, q: number): Promise<Blob> {
    if (c.toBlob) {
      return await new Promise<Blob>((resolve, reject) => {
        c.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          "image/jpeg",
          q
        );
      });
    }
    const dataURL = c.toDataURL("image/jpeg", q);
    const byteStr = atob(dataURL.split(",")[1]);
    const len = byteStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteStr.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  }

  let blob: Blob;
  try {
    blob = await canvasToBlobJPEG(canvas, quality);
  } catch (e) {
    console.error("compress fallback:", e);
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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = e.currentTarget; // เก็บไว้ใช้หลัง await
    const fd = new FormData(form);

    // แนบหลักฐาน
    const raw = (fd.get("evidence") as File) || null;
    let filePayload: FilePayload = null;
    if (raw && raw.size > 0) {
      try {
        const { base64, mimeType, name } = await compressImageToBase64(raw);
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
    if (!agree) {
      alert("กรุณาติ๊กยอมรับเงื่อนไขการรับประกันก่อนส่งแบบฟอร์ม");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/warranty", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("network or server error");
      const text = await res.text();
      const json = JSON.parse(text);
      if (!json.ok) throw new Error(json.error || "ส่งไม่สำเร็จ");

      alert("ลงทะเบียนสำเร็จ ขอบคุณครับ!");
      form.reset();
      setAgree(false);
    } catch (err: any) {
      console.error("submit error:", err);
      alert("เกิดข้อผิดพลาดในการส่งข้อมูล: " + (err?.message || "unknown"));
    } finally {
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

          <div className="w-field span-2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="agree"
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <label htmlFor="agree" style={{ userSelect: "none" }}>
              ยอมรับเงื่อนไขการรับประกัน <a href="/terms" target="_blank" rel="noreferrer">อ่านเงื่อนไข</a>
            </label>
          </div>

          <div className="span-2" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="w-btn w-btn-orange" type="submit" disabled={loading || !agree}>
              {loading ? "กำลังส่ง…" : "ลงทะเบียนรับประกัน"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
