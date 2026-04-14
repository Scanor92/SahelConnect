require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { connectDatabase } = require("../config/database");
const User = require("../models/User");

const FULL_NAMES = [
  "Amina Diallo",
  "Moussa Traore",
  "Fatou Ndiaye",
  "Abdoulaye Bah",
  "Mariama Sow",
  "Ibrahim Ouedraogo",
  "Khadija Cisse",
  "Oumar Konate",
  "Aissatou Camara",
  "Boubacar Keita",
  "Awa Fall",
  "Seydou Sanogo",
  "Nene Diop",
  "Hamidou Toure",
];

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function randomSegment(size = 4) {
  return crypto.randomBytes(size).toString("hex");
}

function generateStrongPassword(length = 18) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "@#$%!?_-+=";
  const all = upper + lower + digits + symbols;

  const picks = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  while (picks.length < length) {
    picks.push(all[Math.floor(Math.random() * all.length)]);
  }

  for (let i = picks.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }

  return picks.join("");
}

async function buildUniqueEmail(fullName, usedEmails) {
  const base = slugify(fullName);
  let email = `${base}.${randomSegment(2)}@sahelconnect.app`;
  while (usedEmails.has(email)) {
    email = `${base}.${randomSegment(2)}@sahelconnect.app`;
  }
  usedEmails.add(email);
  return email;
}

async function run() {
  await connectDatabase();

  const targets = await User.find({
    role: "seller",
    email: { $regex: /^vendeur\d{2}@sahelconnect\.com$/i },
  }).sort({ createdAt: 1 });

  const fallbackTargets = targets.length
    ? targets
    : await User.find({ role: "seller" }).sort({ createdAt: 1 }).limit(14);

  const usersToUpdate = [...fallbackTargets];
  while (usersToUpdate.length < 14) {
    const created = await User.create({
      fullName: `Utilisateur ${usersToUpdate.length + 1}`,
      email: `tmp-${randomSegment(3)}@local.invalid`,
      passwordHash: await bcrypt.hash(`Tmp@${randomSegment(4)}`, 10),
      role: "seller",
    });
    usersToUpdate.push(created);
  }

  const allUsers = await User.find({}, { email: 1 });
  const usedEmails = new Set(allUsers.map((u) => String(u.email || "").toLowerCase().trim()));
  const results = [];

  for (let i = 0; i < 14; i += 1) {
    const specName = FULL_NAMES[i];
    const userToUpdate = usersToUpdate[i];
    if (userToUpdate.email) {
      usedEmails.delete(String(userToUpdate.email).toLowerCase().trim());
    }

    const email = await buildUniqueEmail(specName, usedEmails);
    const password = generateStrongPassword(18);
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(
      userToUpdate._id,
      {
        fullName: specName,
        email,
        role: "seller",
        passwordHash,
      },
      { new: true, runValidators: true }
    );

    results.push({
      id: String(user._id),
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      password,
    });
  }

  console.log("=== UTILISATEURS CREES / MIS A JOUR ===");
  results.forEach((u, index) => {
    console.log(
      `${String(index + 1).padStart(2, "0")}. ${u.fullName} | id=${u.id} | email=${u.email} | mdp=${u.password} | role=${u.role}`
    );
  });
}

run()
  .catch((error) => {
    console.error("Echec seed users:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
