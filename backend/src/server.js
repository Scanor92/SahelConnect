require("dotenv").config();

const express = require("express");
const cors = require("cors");
const os = require("os");
const bcrypt = require("bcryptjs");
const { connectDatabase } = require("./config/database");
const User = require("./models/User");
const { requireAuth } = require("./middlewares/auth.middleware");
const authRouter = require("./routes/auth.routes");
const salesRouter = require("./routes/sales.routes");

const app = express();
const port = process.env.PORT || 5000;
const host = process.env.HOST || "0.0.0.0";

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

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/sales", requireAuth, salesRouter);

async function ensureDefaultAdminUser() {
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
