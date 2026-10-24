const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { Chess } = require("chess.js");

const app = express();
app.use(express.json({ limit: "32kb" }));

const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

app.get("/", (req, res) => {
  res.json({
    name: "Chess Study Overlay API",
    status: "online"
  });
});

app.post("/api/analyze", (req, res) => {
  try {
    const { fen } = req.body;

    if (typeof fen !== "string" || fen.length > 200) {
      return res.status(400).json({
        error: "Provide a valid FEN string."
      });
    }

    const game = new Chess(fen);

    const moves = game.moves({
      verbose: true
    });

    res.json({
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
    res.status(400).json({
      error: "Invalid chess position."
    });
  }
});

app.post("/api/sessions", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({
      error: "Supabase is not configured."
    });
  }

  try {
    const { fen, moves } = req.body;

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

    res.status(201).json({
      id: data.id,
      finalFen: game.fen(),
      moves: game.history()
    });
  } catch {
    res.status(500).json({
      error: "Unable to save chess session."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Chess API listening on port ${PORT}`);
});
