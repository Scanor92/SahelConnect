require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectDatabase } = require("../config/database");
const User = require("../models/User");
const Sale = require("../models/Sale");

function normalizeDoc(doc) {
  if (!doc || typeof doc !== "object") {
    return doc;
  }
  const copy = { ...doc };
  delete copy.__v;
  return copy;
}

async function run() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: npm run restore:offline -- <chemin_fichier_backup.json>");
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Fichier introuvable: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  const payload = JSON.parse(raw);

  const users = Array.isArray(payload.users) ? payload.users.map(normalizeDoc) : [];
  const sales = Array.isArray(payload.sales) ? payload.sales.map(normalizeDoc) : [];

  await connectDatabase();

  await User.deleteMany({});
  await Sale.deleteMany({});

  if (users.length > 0) {
    await User.insertMany(users, { ordered: false });
  }
  if (sales.length > 0) {
    await Sale.insertMany(sales, { ordered: false });
  }

  console.log("Restauration terminee.");
  console.log(`Source: ${resolvedPath}`);
  console.log(`Users restores: ${users.length} | Sales restores: ${sales.length}`);
}

run()
  .catch((error) => {
    console.error("Echec restauration:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });

