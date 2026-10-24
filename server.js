const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { Chess } = require("chess.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "32kb" }));

// Allow requests from the supported chess websites.
const allowedOrigins = new Set([
"https://www.chess.com",
"https://chess.com",
"https://lichess.org"
]);

app.use((req, res, next) => {
const origin = req.get("Origin");

if (origin && allowedOrigins.has(origin)) {
res.setHeader("Access-Control-Allow-Origin", origin);
res.setHeader("Vary", "Origin");
res.setHeader(
"Access-Control-Allow-Methods",
"GET, POST, OPTIONS"
);
res.setHeader(
"Access-Control-Allow-Headers",
"Content-Type, x-license-key"
);
}

if (req.method === "OPTIONS") {
return res.sendStatus(204);
}

next();
});

// Supabase configuration.
// Set these environment variables on Render.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
process.env.SUPABASE_SECRET_KEY ||
process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
supabaseUrl && supabaseKey
? createClient(supabaseUrl, supabaseKey)
: null;

// Health check.
app.get("/", (req, res) => {
res.json({
name: "Chess Study Overlay API",
status: "online",
version: "2.1.0"
});
});

// Hash a license key before looking it up.
function hashLicenseKey(key) {
return crypto
.createHash("sha256")
.update(key, "utf8")
.digest("hex");
}

// Return a license only if it is active and has not expired.
async function findValidLicense(key) {
if (!supabase) {
throw new Error("Supabase is not configured.");
}

if (
typeof key !== "string" ||
key.length < 16 ||
key.length > 200
) {
return null;
}

const keyHash = hashLicenseKey(key);

const { data, error } = await supabase
.from("license_keys")
.select("id, label, is_active, expires_at")
.eq("key_hash", keyHash)
.maybeSingle();

if (error) {
throw error;
}

if (!data || !data.is_active) {
return null;
}

if (
data.expires_at &&
new Date(data.expires_at).getTime() <= Date.now()
) {
return null;
}

return data;
}

// License activation endpoint.
app.post("/api/license/validate", async (req, res) => {
try {
const { licenseKey } = req.body || {};
const license = await findValidLicense(licenseKey);

if (!license) {
  return res.status(403).json({
    valid: false,
    error: "Invalid, expired, or inactive license."
  });
}

return res.json({
  valid: true,
  label: license.label,
  expiresAt: license.expires_at
});

} catch (error) {
console.error("License validation failed:", error.message);

return res.status(503).json({
  valid: false,
  error: "License validation is temporarily unavailable."
});

}
});

// Middleware protecting the API.
async function requireLicense(req, res, next) {
try {
const key = req.get("x-license-key");
const license = await findValidLicense(key);

if (!license) {
  return res.status(403).json({
    error: "A valid license is required."
  });
}

req.license = {
  id: license.id,
  label: license.label
};

next();

} catch (error) {
console.error("License check failed:", error.message);

return res.status(503).json({
  error: "License validation is temporarily unavailable."
});

}
}

// Validate a FEN and return the legal moves.
// Intended for chess study, puzzles, and post-game analysis.
app.post("/api/analyze", requireLicense, (req, res) => {
try {
const { fen } = req.body || {};

if (typeof fen !== "string" || fen.length > 200) {
  return res.status(400).json({
    error: "Provide a valid FEN string."
  });
}

const game = new Chess(fen);
const moves = game.moves({ verbose: true });

return res.json({
  fen: game.fen(),
  turn: game.turn(),
  check: game.isCheck(),
  checkmate: game.isCheckmate(),
  stalemate: game.isStalemate(),
  gameOver: game.isGameOver(),
  legalMoves: moves.map(move => ({
    from: move.from,
    to: move.to,
    san: move.san,
    flags: move.flags,
    piece: move.piece,
    captured: move.captured || null,
    promotion: move.promotion || null
  }))
});

} catch {
return res.status(400).json({
error: "Invalid chess position."
});
}
});

// Save a chess study session.
app.post("/api/sessions", requireLicense, async (req, res) => {
if (!supabase) {
return res.status(503).json({
error: "Supabase is not configured."
});
}

try {
const { fen, moves } = req.body || {};

if (
  typeof fen !== "string" ||
  fen.length > 200 ||
  !Array.isArray(moves) ||
  moves.length > 500
) {
  return res.status(400).json({
    error: "Invalid session data."
  });
}

const game = new Chess(fen);

for (const move of moves) {
  if (
    !move ||
    typeof move.from !== "string" ||
    typeof move.to !== "string"
  ) {
    return res.status(400).json({
      error: "Invalid move data."
    });
  }

  const result = game.move({
    from: move.from,
    to: move.to,
    ...(move.promotion
      ? { promotion: move.promotion }
      : {})
  });

  if (!result) {
    return res.status(400).json({
      error: "Illegal move in session."
    });
  }
}

const { data, error } = await supabase
  .from("chess_sessions")
  .insert({
    starting_fen: fen,
    moves: game.history(),
    final_fen: game.fen()
  })
  .select("id")
  .single();

if (error) {
  throw error;
}

return res.status(201).json({
  id: data.id,
  finalFen: game.fen(),
  moves: game.history()
});

} catch (error) {
console.error("Session save failed:", error.message);

return res.status(500).json({
  error: "Unable to save chess session."
});

}
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Chess API listening on port ${PORT}");
});
