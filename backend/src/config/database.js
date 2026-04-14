const mongoose = require("mongoose");

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI est manquant dans les variables d'environnement");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  });
  console.log("MongoDB connecte");
}

module.exports = { connectDatabase };
