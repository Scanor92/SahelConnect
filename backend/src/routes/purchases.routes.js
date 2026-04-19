const express = require("express");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const Purchase = require("../models/Purchase");

const router = express.Router();

function normalizeUserId(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value._id) {
    return String(value._id);
  }
  return String(value);
}

function toMoney(value) {
  const amount = Math.round(Number(value) || 0);
  const grouped = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} F CFA`;
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function normalizeItemsFromPayload(payload) {
  if (Array.isArray(payload?.items) && payload.items.length > 0) {
    const normalized = payload.items.map((item) => {
      const productName = String(item?.productName || "").trim();
      const quantity = Number(item?.quantity);
      const unitPrice = Number(item?.unitPrice);

      return {
        productName,
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      };
    });

    return normalized;
  }

  const legacyProductName = String(payload?.productName || "").trim();
  const legacyQuantity = Number(payload?.quantity);
  const legacyUnitPrice = Number(payload?.unitPrice);

  if (!legacyProductName && !legacyQuantity && !legacyUnitPrice) {
    return [];
  }

  return [
    {
      productName: legacyProductName,
      quantity: legacyQuantity,
      unitPrice: legacyUnitPrice,
      lineTotal: legacyQuantity * legacyUnitPrice,
    },
  ];
}

function normalizeSupplierFromPayload(payload) {
  return String(payload?.supplier || "").trim();
}

function normalizeInvoiceRefFromPayload(payload) {
  return String(payload?.invoiceRef || "").trim();
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "Ajoutez au moins un produit";
  }

  for (const item of items) {
    if (!item.productName) {
      return "Chaque ligne doit contenir un nom de produit";
    }

    if (Number.isNaN(item.quantity) || item.quantity <= 0) {
      return "Chaque ligne doit contenir une quantite valide";
    }

    if (Number.isNaN(item.unitPrice) || item.unitPrice < 0) {
      return "Chaque ligne doit contenir un prix unitaire valide";
    }
  }

  return null;
}

function getSaleItems(sale) {
  if (Array.isArray(sale?.items) && sale.items.length > 0) {
    return sale.items;
  }

  if (sale?.productName) {
    const quantity = Number(sale.quantity || 0);
    const unitPrice = Number(sale.unitPrice || 0);
    return [
      {
        productName: sale.productName,
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      },
    ];
  }

  return [];
}

function getRangeBounds(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (start > end) {
    return null;
  }
  return { start, end };
}

function buildPurchasesFilter(query) {
  const { q, from, to } = query || {};
  const filter = {};

  if (from || to) {
    filter.createdAt = {};
    if (from) {
      const start = new Date(from);
      if (!Number.isNaN(start.getTime())) {
        filter.createdAt.$gte = start;
      }
    }
    if (to) {
      const end = new Date(to);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    if (!filter.createdAt.$gte && !filter.createdAt.$lte) {
      delete filter.createdAt;
    }
  }

  if (q && String(q).trim()) {
    const safeQ = String(q).trim();
    filter.$or = [
      { "items.productName": { $regex: safeQ, $options: "i" } },
      { supplier: { $regex: safeQ, $options: "i" } },
      { invoiceRef: { $regex: safeQ, $options: "i" } },
    ];
  }

  return filter;
}

function toCsvRows(sales) {
  const rows = ["date,achat_id,ref_facture,fournisseur,produit,quantite,prix_unitaire,sous_total,total_achat"];

  sales.forEach((sale) => {
    const items = getSaleItems(sale);
    items.forEach((item, idx) => {
      const safeName = String(item.productName || "").replace(/"/g, '""');
      rows.push(
        [
          sale.createdAt.toISOString(),
          sale._id,
          `"${String(sale.invoiceRef || "").replace(/"/g, '""')}"`,
          `"${String(sale.supplier || "").replace(/"/g, '""')}"`,
          `"${safeName}"`,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
          idx === 0 ? sale.totalPrice : "",
        ].join(",")
      );
    });
  });

  return rows.join("\n");
}

function writeReportPdf(doc, title, subtitle, sales) {
  const logoPath = path.resolve(__dirname, "../../assets/logo.png");
  const totalAmount = sales.reduce((sum, s) => sum + Number(s.totalPrice || 0), 0);
  doc.roundedRect(40, 36, 515, 132, 12).fillAndStroke("#f8fafc", "#dbe5f0");
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 52, 58, { fit: [74, 30], align: "left" });
  }
  const titleX = 132;
  const titleY = 56;
  const titleWidth = 418;
  let titleSize = 19;
  while (titleSize >= 10) {
    doc.font("Helvetica-Bold").fontSize(titleSize);
    const oneLineWidth = doc.widthOfString(title);
    if (oneLineWidth <= titleWidth) {
      break;
    }
    titleSize -= 1;
  }
  doc
    .font("Helvetica-Bold")
    .fontSize(titleSize)
    .fillColor("#0f172a")
    .text(title, titleX, titleY, { lineBreak: false });
  const subtitleY = titleY + titleSize + 10;
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#475569")
    .text(subtitle, titleX, subtitleY, { width: titleWidth });

  doc.roundedRect(40, 182, 252, 56, 10).fillAndStroke("#eef2ff", "#c7d2fe");
  doc.roundedRect(303, 182, 252, 56, 10).fillAndStroke("#ecfeff", "#a5f3fc");
  doc.font("Helvetica").fontSize(10).fillColor("#3730a3").text("Nombre d'achats", 54, 198);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#1e1b4b").text(String(sales.length), 54, 212);
  doc.font("Helvetica").fontSize(10).fillColor("#0f766e").text("Montant total", 317, 198);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#115e59").text(toMoney(totalAmount), 317, 212);

  let y = 256;
  sales.forEach((sale, saleIndex) => {
    if (y > 720) {
      doc.addPage();
      y = 60;
    }

    doc.roundedRect(40, y, 515, 106, 10).fillAndStroke("#ffffff", "#dbe5f0");
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#0f172a")
      .text(`Achat #${saleIndex + 1} - ${String(sale._id).slice(-8)}`, 54, y + 12);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`Date: ${sale.createdAt.toLocaleString("fr-FR")}`, 54, y + 30);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`Fournisseur: ${sale.supplier || "Achat comptoir"}`, 54, y + 46);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`Ref facture: ${sale.invoiceRef || "-"}`, 54, y + 62);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#0f172a")
      .text(`Total achat: ${toMoney(sale.totalPrice)}`, 54, y + 78);
    y += 114;

    const items = getSaleItems(sale);
    items.forEach((item, idx) => {
      if (y > 760) {
        doc.addPage();
        y = 60;
      }
      doc.roundedRect(54, y, 487, 26, 6).fillAndStroke("#f8fafc", "#e2e8f0");
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor("#1e293b")
        .text(
          `${idx + 1}. ${item.productName} | Qt: ${item.quantity} | PU: ${toMoney(item.unitPrice)} | ST: ${toMoney(item.lineTotal)}`,
          64,
          y + 8
        );
      y += 30;
    });

    y += 8;
  });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#64748b")
    .text("Document officiel de rapport genere par SahelConnect.", 40, 790, {
      align: "center",
      width: 515,
    });
}

router.get("/", async (req, res) => {
  try {
    const filter = buildPurchasesFilter(req.query);
    const sales = await Purchase.find(filter).sort({ createdAt: -1 });
    return res.json({ sales });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/daily", async (req, res) => {
  try {
    const dateQuery = req.query?.date;
    const baseDate = dateQuery ? new Date(dateQuery) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      return res.status(400).json({ message: "Date invalide" });
    }

    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({
      createdAt: -1,
    });
    const totalAmount = sales.reduce((sum, s) => sum + Number(s.totalPrice || 0), 0);

    return res.json({
      reportType: "daily",
      date: start.toISOString().slice(0, 10),
      salesCount: sales.length,
      totalAmount,
      sales,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/weekly", async (req, res) => {
  try {
    const dateQuery = req.query?.date;
    const baseDate = dateQuery ? new Date(dateQuery) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      return res.status(400).json({ message: "Date invalide" });
    }

    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const dayIndex = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayIndex);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({
      createdAt: -1,
    });
    const totalAmount = sales.reduce((sum, s) => sum + Number(s.totalPrice || 0), 0);

    return res.json({
      reportType: "weekly",
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      salesCount: sales.length,
      totalAmount,
      sales,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/range", async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!from || !to) {
      return res.status(400).json({ message: "from et to sont obligatoires" });
    }

    const bounds = getRangeBounds(from, to);
    if (!bounds) {
      return res.status(400).json({ message: "from doit etre inferieur ou egal a to" });
    }
    const { start, end } = bounds;

    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({
      createdAt: -1,
    });
    const totalAmount = sales.reduce((sum, s) => sum + Number(s.totalPrice || 0), 0);

    return res.json({
      reportType: "range",
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      salesCount: sales.length,
      totalAmount,
      sales,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/daily/export.csv", async (req, res) => {
  try {
    const dateQuery = req.query?.date;
    const baseDate = dateQuery ? new Date(dateQuery) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      return res.status(400).json({ message: "Date invalide" });
    }

    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 });
    const csv = toCsvRows(sales);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=rapport-journalier-${start.toISOString().slice(0, 10)}.csv`);
    return res.send(csv);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/range/export.csv", async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!from || !to) {
      return res.status(400).json({ message: "from et to sont obligatoires" });
    }

    const bounds = getRangeBounds(from, to);
    if (!bounds) {
      return res.status(400).json({ message: "from doit etre inferieur ou egal a to" });
    }
    const { start, end } = bounds;

    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 });
    const csv = toCsvRows(sales);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=rapport-intervalle-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.csv`);
    return res.send(csv);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/daily/export.pdf", async (req, res) => {
  try {
    const dateQuery = req.query?.date;
    const baseDate = dateQuery ? new Date(dateQuery) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      return res.status(400).json({ message: "Date invalide" });
    }

    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 });

    const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 50, right: 50 } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Disposition", `inline; filename=rapport-journalier-${start.toISOString().slice(0, 10)}.pdf`);
    doc.pipe(res);
    writeReportPdf(doc, "Rapport Journalier des Achats", `Date: ${start.toISOString().slice(0, 10)}`, sales);
    doc.end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/weekly/export.pdf", async (req, res) => {
  try {
    const dateQuery = req.query?.date;
    const baseDate = dateQuery ? new Date(dateQuery) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      return res.status(400).json({ message: "Date invalide" });
    }

    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const dayIndex = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayIndex);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 });

    const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 50, right: 50 } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=rapport-hebdomadaire-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.pdf`
    );
    doc.pipe(res);
    writeReportPdf(
      doc,
      "Rapport Hebdomadaire",
      `Du ${start.toISOString().slice(0, 10)} au ${end.toISOString().slice(0, 10)}`,
      sales
    );
    doc.end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/reports/range/export.pdf", async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!from || !to) {
      return res.status(400).json({ message: "from et to sont obligatoires" });
    }
    const bounds = getRangeBounds(from, to);
    if (!bounds) {
      return res.status(400).json({ message: "from doit etre inferieur ou egal a to" });
    }
    const { start, end } = bounds;
    const sales = await Purchase.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 });

    const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 50, right: 50 } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=rapport-intervalle-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.pdf`
    );
    doc.pipe(res);
    writeReportPdf(
      doc,
      "Rapport des Achats par Intervalle",
      `Du ${start.toISOString().slice(0, 10)} au ${end.toISOString().slice(0, 10)}`,
      sales
    );
    doc.end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/", async (req, res) => {
  try {
    const items = normalizeItemsFromPayload(req.body || {});
    const validationMessage = validateItems(items);

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const totalPrice = items.reduce((sum, item) => sum + item.lineTotal, 0);

    const supplier = normalizeSupplierFromPayload(req.body || {});
    const invoiceRef = normalizeInvoiceRefFromPayload(req.body || {});
    const sale = await Purchase.create({
      items,
      totalPrice,
      supplier,
      invoiceRef,
      createdBy: req.user?.sub,
    });

    return res.status(201).json({
      message: "Achat enregistre",
      sale,
      receiptUrl: `/api/purchases/${sale._id}/receipt`,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existingSale = await Purchase.findById(id);
    if (!existingSale) {
      return res.status(404).json({ message: "Achat introuvable" });
    }

    const isOwner = normalizeUserId(existingSale.createdBy) === normalizeUserId(req.user?.sub);
    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Vous pouvez modifier uniquement vos achats" });
    }

    const items = normalizeItemsFromPayload(req.body || {});
    const validationMessage = validateItems(items);

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const totalPrice = items.reduce((sum, item) => sum + item.lineTotal, 0);

    const supplier = normalizeSupplierFromPayload(req.body || {});
    const invoiceRef = normalizeInvoiceRefFromPayload(req.body || {});
    const updatedSale = await Purchase.findByIdAndUpdate(
      existingSale._id,
      {
        items,
        totalPrice,
        supplier,
        invoiceRef,
      },
      { new: true, runValidators: true }
    );

    if (!updatedSale) {
      return res.status(404).json({ message: "Achat introuvable" });
    }

    return res.json({ message: "Achat modifie", sale: updatedSale });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Purchase.findById(id);

    if (!sale) {
      return res.status(404).json({ message: "Achat introuvable" });
    }

    const isOwner = normalizeUserId(sale.createdBy) === normalizeUserId(req.user?.sub);
    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Vous pouvez supprimer uniquement vos achats" });
    }

    await Purchase.deleteOne({ _id: sale._id });
    return res.json({ message: "Achat supprime" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/:id/verify", async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Purchase.findById(id);

    if (!sale) {
      return res.status(404).json({
        authentic: false,
        message: "Recu introuvable",
      });
    }

    return res.json({
      authentic: true,
      message: "Recu authentique SAHELCONNECT",
      sale: {
        id: sale._id,
        items: getSaleItems(sale),
        totalPrice: sale.totalPrice,
        supplier: sale.supplier || "",
        invoiceRef: sale.invoiceRef || "",
        createdAt: sale.createdAt,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ authentic: false, message: "Erreur serveur" });
  }
});

router.get("/:id/receipt", async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Purchase.findById(id);

    if (!sale) {
      return res.status(404).json({ message: "Achat introuvable" });
    }

    const items = getSaleItems(sale);

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Recu ${sale._id}`,
        Author: "SahelConnect",
        Subject: "Recu d'achat",
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Disposition", `inline; filename=recu-${sale._id}.pdf`);

    doc.pipe(res);

    const logoPath = path.resolve(__dirname, "../../assets/logo.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 118, { fit: [130, 48], align: "left" });
    }

    const verificationUrl = `${getBaseUrl(req)}/api/purchases/${sale._id}/verify`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 180,
    });
    const qrImageBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("Recu d'achat", 50, 182, { align: "center" });

    doc.strokeColor("#cbd5e1").lineWidth(1).moveTo(50, 220).lineTo(545, 220).stroke();

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`Numero du recu: ${sale._id}`, 50, 236)
      .text(`Date: ${sale.createdAt.toLocaleString("fr-FR")}`, 50, 252)
      .text(`Fournisseur: ${sale.supplier || "Achat comptoir"}`, 50, 268)
      .text(`Ref facture: ${sale.invoiceRef || "-"}`, 50, 284);

    const detailsY = 318;
    const headerH = 28;
    const rowH = 24;
    const detailsH = headerH + rowH * Math.max(items.length, 1) + 18;

    doc.roundedRect(50, detailsY, 495, detailsH, 8).fillAndStroke("#f8fafc", "#cbd5e1");

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text("Details de l'achat", 65, detailsY + 12);

    let rowY = detailsY + 40;
    items.forEach((item, index) => {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#1e293b")
        .text(`${index + 1}. ${item.productName}`, 65, rowY)
        .text(`Qt: ${item.quantity} | PU: ${toMoney(item.unitPrice)} | Sous-total: ${toMoney(item.lineTotal)}`, 250, rowY);
      rowY += rowH;
    });

    const totalY = detailsY + detailsH + 18;
    doc.roundedRect(50, totalY, 495, 72, 8).fillAndStroke("#eef2ff", "#a5b4fc");

    doc.font("Helvetica").fontSize(11).fillColor("#3730a3").text("Montant total achat", 65, totalY + 19);
    doc.font("Helvetica-Bold").fontSize(24).fillColor("#1e1b4b").text(toMoney(sale.totalPrice), 65, totalY + 36);

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text("Document authentique - SAHELCONNECT", 50, 560, {
      align: "center",
    });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#64748b")
      .text("Ce recu est genere automatiquement par le systeme SahelConnect.", 50, 576, {
        align: "center",
      })
      .text("Optimiser . Securiser . Transformer", 50, 591, {
        align: "center",
      });

    doc.image(qrImageBuffer, 442, 538, { fit: [92, 92] });
    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("Scanner pour verifier", 438, 632, {
      width: 104,
      align: "center",
    });

    doc.end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

module.exports = router;

