const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../config/security");

const JWT_SECRET = getJwtSecret();

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Authentification requise" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalide" });
  }
}

module.exports = { requireAuth };
