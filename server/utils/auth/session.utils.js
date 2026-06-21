import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const SESSION_SECRET = process.env.SESSION_SECRET;

export function generateSessionId() {
  const id = crypto.randomBytes(16).toString("hex");

  const hashedId = hashSessionId(id);

  return { raw: id, hashed: hashedId };
}

export function hashSessionId(rawSessionId) {
  const sanitizedId = String(rawSessionId).replace(/['"]+/g, "").trim();
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(sanitizedId)
    .digest("hex");
}
