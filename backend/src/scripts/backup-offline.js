require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectDatabase } = require("../config/database");
const User = require("../models/User");
const Sale = require("../models/Sale");

function stamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}${m}${day}-${hh}${mm}${ss}`;
}

async function run() {
  await connectDatabase();

  const users = await User.find({}).lean();
  const sales = await Sale.find({}).lean();

  const payload = {
    meta: {
      version: 1,
      app: "SahelConnect",
      createdAt: new Date().toISOString(),
      mongoUri: process.env.MONGODB_URI ? "[configured]" : "[missing]",
      usersCount: users.length,
      salesCount: sales.length,
    },
    users,
    sales,
  };

  const backupDir = path.resolve(__dirname, "../../backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const fileName = `sahelconnect-backup-${stamp()}.json`;
  const filePath = path.join(backupDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

  console.log("Sauvegarde hors ligne terminee.");
  console.log(`Fichier: ${filePath}`);
  console.log(`Users: ${users.length} | Sales: ${sales.length}`);
}

run()
  .catch((error) => {
    console.error("Echec sauvegarde:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });

