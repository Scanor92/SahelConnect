const DEV_FALLBACK_JWT_SECRET = "sahelconnect-dev-secret";

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function getJwtSecret() {
  const raw = String(process.env.JWT_SECRET || "").trim();
  if (raw) {
    if (isProduction() && raw === DEV_FALLBACK_JWT_SECRET) {
      throw new Error("JWT_SECRET de production invalide (valeur de developpement detectee).");
    }
    return raw;
  }

  if (isProduction()) {
    throw new Error("JWT_SECRET est obligatoire en production.");
  }

  return DEV_FALLBACK_JWT_SECRET;
}

function shouldBootstrapDefaultAdmin() {
  const configuredEmail = String(process.env.DEFAULT_ADMIN_EMAIL || "").trim();
  const configuredPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || "").trim();

  if (!isProduction()) {
    return true;
  }

  if (!configuredEmail || !configuredPassword) {
    return false;
  }

  if (
    configuredEmail.toLowerCase() === "admin@sahelconnect.com" ||
    configuredPassword === "Admin@1234"
  ) {
    return false;
  }

  return true;
}

module.exports = {
  isProduction,
  getJwtSecret,
  shouldBootstrapDefaultAdmin,
};

