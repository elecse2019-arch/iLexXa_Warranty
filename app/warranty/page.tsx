// app/warranty/page.tsx
"use client";

import { FormEvent, useState } from "react";
import NextImage from "next/image";

type FilePayload = { name: string; mimeType: string; content: string } | null;

/** ย่อรูป → JPEG */
async function compressImageToBase64(
  file: File,
  opts: { maxW?: number; maxH?: number; quality?: number } = {}
): Promise<{ base64: string; mimeType: string; name: string }> {
  const { maxW = 1200, maxH = 1200, quality = 0.8 } = opts;
  if (!file.type.startsWith("image/")) {
    const buf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { base64, mimeType: file.type || "application/octet-stream", name: file.name };
  }
  let bmp: ImageBitmap | null = null;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" as any }); } catch { bmp = null; }

  const loadImg = () => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

  let srcW: number, srcH: number, draw: (ctx: CanvasRenderingContext2D) => void;
  if (bmp) { srcW = bmp.width; srcH = bmp.height; draw = (ctx) => ctx.drawImage(bmp!, 0, 0, srcW, srcH); }
  else {
    const img = await loadImg();
    srcW = img.naturalWidth; srcH = img.naturalHeight;
    draw = (ctx) => ctx.drawImage(img, 0, 0, srcW, srcH);
  }

  const scale = Math.min(maxW / srcW, maxH / srcH, 1);
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d")!; draw(ctx);

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", quality)
  );
  if (bmp) bmp.close();

  const buf = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const name = file.name.replace(/\.(heic|heif|webp|png|gif|jpeg|jpg)$/i, "") + ".jpg";
  return { base64, mimeType: "image/jpeg", name };
}

export default function WarrantyPage() {
  const [loading, setLoading] = useState(false);
  const [agree, setAgree] = useState(false);        // ✅ ยอมรับเงื่อนไข
  const [showTerms, setShowTerms] = useState(false); // ✅ เปิด/ปิดป๊อปอัปเงื่อนไข

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;

    if (!agree) {            // กันพลาดกรณี browser ไม่เช็ค required
      alert("โปรดยอมรับเงื่อนไขการรับประกันก่อนส่งแบบฟอร์ม");
      return;
    }

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
      agreeToTerms: agree, // ส่งสถานะยอมรับไปเก็บได้ด้วย
    };

    if (!payload.fullName || !payload.phone || !payload.email || !payload.purchaseDate || !payload.evidence) {
      alert("กรุณากรอกข้อมูลที่มีเครื่องหมาย * และแนบหลักฐานให้ครบ");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/warranty", { method: "POST", body: JSON.stringify(payload) });
      const text = await res.text();
      const json = JSON.parse(text);
      if (!json.ok) throw new Error(json.error || "ส่งไม่สำเร็จ");
      alert("ลงทะเบียนสำเร็จ ขอบคุณครับ!");
      form.reset();
      setAgree(false);
    } catch (err: any) {
      alert("เกิดข้อผิดพลาด: " + (err?.message || "unknown"));
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
            <select className="w-select" name="gender">
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
            <input className="w-input" name="store" placeholder="เช่น สาขา..., มหาวิทยาลัย" />
          </div>

          <div className="w-field span-2">
            <label>แนบหลักฐาน (รูปสินค้า/ใบเสร็จ) *</label>
            <input className="w-file" type="file" name="evidence" accept="image/*,.pdf" required />
            <div className="w-hint">* ระบบจะย่อรูปอัตโนมัติก่อนอัปโหลด</div>
          </div>

          {/* ✅ กล่องยอมรับเงื่อนไข + ลิงก์อ่านเงื่อนไข (เปิดป๊อปอัป) */}
          <div className="w-field span-2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="agree"
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              required
              style={{ width: 18, height: 18 }}
            />
            <label htmlFor="agree" style={{ fontWeight: 500 }}>
              ยอมรับเงื่อนไขการรับประกัน <span style={{ color: "#fe7300", cursor: "pointer" }} onClick={() => setShowTerms(true)}>อ่านเงื่อนไข</span>
            </label>
          </div>

          <div className="span-2" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="w-btn w-btn-orange" type="submit" disabled={loading || !agree}>
              {loading ? "กำลังส่ง…" : "ลงทะเบียนรับประกัน"}
            </button>
          </div>
        </div>
      </form>

      {/* ✅ ป๊อปอัปเงื่อนไขการรับประกัน */}
      {showTerms && (
        <div className="w-modal-backdrop" onClick={() => setShowTerms(false)}>
          <div className="w-modal" onClick={(e) => e.stopPropagation()}>
            <div className="w-modal-header">
              <h3>เงื่อนไขการรับประกัน</h3>
              <button className="w-modal-close" onClick={() => setShowTerms(false)}>×</button>
            </div>
            <div className="w-modal-body">
              <p><strong>เงื่อนไขการรับประกัน</strong></p>
              <ol>
                <li>iLexXa รับประกันผลิตภัณฑ์เฉพาะที่ซื้อในประเทศไทยเท่านั้น โดยปกติ 1 ปี (บางสินค้า 6 เดือน) นับจากวันที่ซื้อ</li>
                <li>รับประกันเฉพาะความเสียหายจากการผลิต/การใช้งานตามคำแนะนำ ต้องส่งสินค้าตรวจสอบกับบริษัททุกครั้ง</li>
                <li>หากเข้าเงื่อนไข บริษัทจะเปลี่ยนสินค้าใหม่ (เฉพาะชิ้นส่วนที่เสีย) ภายใต้เงื่อนไขสำคัญ เช่น ต้องมีการลงทะเบียน/ใบเสร็จสมบูรณ์</li>
                <li>รับประกันเฉพาะอแดปเตอร์ชาร์จไฟบ้านและชาร์จไฟรถ ไม่รวมอุปกรณ์เสริม/วัสดุสิ้นเปลือง</li>
                <li>ความเสียหายจากการใช้งานผิดวิธี อุบัติเหตุ ภัยธรรมชาติ สัตว์/แมลง ฯลฯ อยู่นอกการรับประกัน</li>
              </ol>

              <p><strong>ข้อยกเว้นความคุ้มครอง</strong></p>
              <ol>
                <li>ใช้งานผิดวัตถุประสงค์/ฝ่าฝืนคำแนะนำ</li>
                <li>ความเสียหายอันเนื่องจากน้ํา สภาพอากาศ การดัดแปลง/ซ่อมแซม/โปรแกรม</li>
                <li>สงคราม การก่อความไม่สงบ ก่อการร้าย คำสั่งของรัฐ ฯลฯ</li>
                <li>การแตกหักจากอัคคีภัยหรือโจรกรรม</li>
                <li>สึกหรอ เสื่อมสภาพ ปฏิกิริยาของแสง/บรรยากาศ ฯลฯ</li>
                <li>ปฏิกิริยานิวเคลียร์/กัมมันตภาพรังสี</li>
                <li>การกระทำโดยเจตนาหรือประมาทเลินเล่ออย่างร้ายแรง</li>
                <li>การฉ้อโกง/ไม่ซื่อสัตย์</li>
              </ol>

              <p><strong>เงื่อนไขสิทธิประกันภัย</strong> ต้องลงทะเบียนภายใน 7 วันนับจากวันที่ซื้อ</p>
            </div>
            <div className="w-modal-footer">
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
