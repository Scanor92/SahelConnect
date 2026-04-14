require("dotenv").config();

const mongoose = require("mongoose");
const { connectDatabase } = require("../config/database");
const Sale = require("../models/Sale");
const User = require("../models/User");

async function run() {
  await connectDatabase();

  const fallbackEmail = String(process.env.DEFAULT_ADMIN_EMAIL || "admin@sahelconnect.com")
    .toLowerCase()
    .trim();

  let owner = await User.findOne({ email: fallbackEmail });
  if (!owner) {
    owner = await User.findOne().sort({ createdAt: 1 });
  }

  if (!owner) {
    throw new Error("Aucun utilisateur trouve pour attribuer les anciennes ventes.");
  }

  const filter = {
    $or: [{ createdBy: { $exists: false } }, { createdBy: null }],
  };

  const missingCount = await Sale.countDocuments(filter);
  if (missingCount === 0) {
    console.log("Migration terminee: aucune vente a mettre a jour.");
    return;
  }

  const update = await Sale.updateMany(filter, { $set: { createdBy: owner._id } });

  console.log("Migration terminee.");
  console.log(`Proprietaire assigne: ${owner.fullName} <${owner.email}>`);
  console.log(`Ventes mises a jour: ${update.modifiedCount}/${missingCount}`);
}

run()
  .catch((error) => {
    console.error("Echec migration:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });

