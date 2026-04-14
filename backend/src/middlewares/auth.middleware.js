const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Authentification requise" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "sahelconnect-dev-secret");
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalide" });
  }
}

module.exports = { requireAuth };