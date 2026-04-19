require("dotenv").config();

const express = require("express");
const cors = require("cors");
const os = require("os");
const bcrypt = require("bcryptjs");
const { connectDatabase } = require("./config/database");
const { getJwtSecret, isProduction, shouldBootstrapDefaultAdmin } = require("./config/security");
const User = require("./models/User");
const { requireAuth } = require("./middlewares/auth.middleware");
const authRouter = require("./routes/auth.routes");
const salesRouter = require("./routes/sales.routes");
const purchasesRouter = require("./routes/purchases.routes");

const app = express();
const port = process.env.PORT || 5000;
const host = process.env.HOST || "0.0.0.0";

function buildCorsConfig() {
  const raw = String(process.env.CORS_ORIGIN || "").trim();
  if (!raw && isProduction()) {
    throw new Error("CORS_ORIGIN est obligatoire en production.");
  }
  if (!raw) {
    return {};
  }
  const allowedOrigins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    return {};
  }

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS non autorise"));
    },
  };
}

function getLocalIpv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

app.use(cors(buildCorsConfig()));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/sales", requireAuth, salesRouter);
app.use("/api/purchases", requireAuth, purchasesRouter);

async function ensureDefaultAdminUser() {
  if (!shouldBootstrapDefaultAdmin()) {
    console.warn("Creation de l'admin par defaut ignoree en production (config manquante/insecure).");
    return;
  }

  const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || "admin@sahelconnect.com").toLowerCase().trim();
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || "Admin@1234";
  const adminName = process.env.DEFAULT_ADMIN_NAME || "Administrateur";

  const existing = await User.findOne({ email: adminEmail });
  if (existing) {
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await User.create({
    fullName: adminName,
    email: adminEmail,
    passwordHash,
    role: "admin",
  });

  console.log(`Utilisateur admin cree: ${adminEmail}`);
}

connectDatabase()
  .then(() => {
    // Force la validation de JWT_SECRET au demarrage.
    getJwtSecret();
    return ensureDefaultAdminUser();
  })
  .then(() => {
    app.listen(port, host, () => {
      console.log(`Serveur demarre sur http://localhost:${port}`);
      const localIp = getLocalIpv4();
      if (localIp) {
        console.log(`Acces reseau local: http://${localIp}:${port}`);
      }
    });
  })
  .catch((error) => {
    console.error("Erreur de connexion MongoDB:", error.message);
    process.exit(1);
  });
