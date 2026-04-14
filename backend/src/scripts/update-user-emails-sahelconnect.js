require("dotenv").config();

const mongoose = require("mongoose");
const crypto = require("crypto");
const { connectDatabase } = require("../config/database");
const User = require("../models/User");

function randomDigits(count = 6) {
  let digits = "";
  while (digits.length < count) {
    const n = crypto.randomInt(0, 10);
    digits += String(n);
  }
  return digits;
}

async function generateUniqueEmail(usedEmails) {
  let email = `sahelconnect${randomDigits(6)}@securemail.app`;
  while (usedEmails.has(email)) {
    email = `sahelconnect${randomDigits(6)}@securemail.app`;
  }
  usedEmails.add(email);
  return email;
}

async function run() {
  await connectDatabase();

  const targetUsers = await User.find({ role: "seller" }).sort({ createdAt: 1 }).limit(14);
  if (targetUsers.length < 14) {
    throw new Error("Moins de 14 utilisateurs seller trouves.");
  }

  const allUsers = await User.find({}, { email: 1 });
  const usedEmails = new Set(allUsers.map((u) => String(u.email || "").toLowerCase().trim()));

  console.log("=== EMAILS MIS A JOUR (MOTS DE PASSE INCHANGES) ===");
  for (const user of targetUsers) {
    usedEmails.delete(String(user.email).toLowerCase().trim());
    const newEmail = await generateUniqueEmail(usedEmails);
    const oldEmail = user.email;
    user.email = newEmail;
    await user.save();
    console.log(`id=${user._id} | ${oldEmail} -> ${newEmail}`);
  }
}

run()
  .catch((error) => {
    console.error("Echec update emails:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
