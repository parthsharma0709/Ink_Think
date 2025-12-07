// socket/gameHandler.js

import { rooms, words } from "./gameState.js";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

// --- AI SETUP (NEW SDK @google/genai) ---
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ------------------- GAME CONSTANTS -------------------
const ROUND_DURATION = 60000;

// ------------------- GAME UTILS -------------------
const pickDrawer = (room) => {
  const players = room.playerOrder;
  let idx = room.roundNumber;
  while (idx < players.length) {
    const player = players[idx];
    if (room.players.has(player)) return player;
    idx += 1;
    room.roundNumber += 1;
  }
  return null;
};

const pickWord = () => {
  return words[Math.floor(Math.random() * words.length)];
};

const clearRoundTimer = (room) => {
  if (room?.currentRoundTimer) {
    clearInterval(room.currentRoundTimer);
    room.currentRoundTimer = null;
  }
};

// ------------------- GAME FLOW -------------------
const startGame = async (io, roomId) => {
  try {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.ongoingGame) return;

    if (!room.players || room.players.size < 2) {
      io.to(roomId).emit("error", { message: "Need at least 2 players to start" });
      return;
    }

    room.playerOrder = Array.from(room.players);
    room.totalRounds = room.playerOrder.length;
    room.roundNumber = 0;

    room.scores = new Map();
    room.playerOrder.forEach((p) => room.scores.set(p, 0));

    room.ongoingGame = true;
    room.roundActive = false;
    room.drawer = null;
    room.currentWord = null;
    room.lastMLCheckAt = 0;

    io.to(roomId).emit("gameStarted", {
      totalRounds: room.totalRounds,
      players: room.playerOrder.map((id) => room.usernames.get(id)),
      message: "The Game has started",
    });

    setTimeout(() => startRound(io, roomId), 1500);

  } catch (error) {
    console.log(error);
  }
};

const findWinner = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return "Nobody";

  let max = -Infinity;
  let winnerId = null;

  for (const [pid, sc] of room.scores) {
    if (sc > max) {
      max = sc;
      winnerId = pid;
    }
  }

  return room.usernames.get(winnerId) || "Nobody";
};

// ------------------- END GAME -------------------
const endGame = (roomId, io, { reason = "finished" } = {}) => {
  try {
    const room = rooms.get(roomId);
    if (!room) return;

    room.ongoingGame = false;
    room.roundActive = false;

    const winner = findWinner(roomId);

    io.to(roomId).emit("gameEnded", {
      reason,
      scores: Array.from(room.scores).map(([id, score]) => ({
        player: room.usernames.get(id),
        score,
      })),
      winner,
      message: `${winner} won the game. The Game ends here.`,
    });

    clearRoundTimer(room);
    rooms.delete(roomId);

  } catch (error) {
    console.log(error);
  }
};

// ------------------- START ROUND -------------------
const startRound = async (io, roomId) => {
  try {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.players.size < 2) {
      endGame(roomId, io, { reason: "not_enough_players" });
      return;
    }

    const drawer = pickDrawer(room);
    if (!drawer) {
      endGame(roomId, io, { reason: "no_players_left" });
      return;
    }

    room.currentWord = pickWord();
    room.drawer = drawer;
    room.roundActive = true;
    room.lastMLCheckAt = 0;

    room.remainingTime = ROUND_DURATION;

    io.to(room.drawer).emit("yourTurn", {
      word: room.currentWord,
      remainingTime: room.remainingTime,
    });

    io.to(roomId).emit("roundStarted", {
      roundNumber: room.roundNumber,
      drawer: room.usernames.get(room.drawer),
      message: "The round has started!",
      remainingTime: room.remainingTime,
    });

    clearRoundTimer(room);

    room.currentRoundTimer = setInterval(() => {
      room.remainingTime -= 1000;

      if (room.remainingTime <= 0) {
        endRound(io, roomId, { reason: "timeout" });
      } else {
        io.to(roomId).emit("timerUpdate", { remainingTime: room.remainingTime });
      }
    }, 1000);

  } catch (error) {
    console.log(error);
  }
};

// ------------------- END ROUND -------------------
const endRound = (io, roomId, { reason = "completed", winner = null } = {}) => {
  try {
    const room = rooms.get(roomId);
    if (!room || !room.roundActive) return;

    room.roundActive = false;
    clearRoundTimer(room);

    if (reason === "timeout") {
      const drawerId = room.drawer;
      const currentScore = room.scores.get(drawerId) || 0;
      room.scores.set(drawerId, Math.max(0, currentScore - 10));
    }

    io.to(roomId).emit("roundEnded", {
      reason,
      winner,
      word: room.currentWord,
      scores: Array.from(room.scores).map(([id, score]) => ({
        player: room.usernames.get(id),
        score,
      })),
      message: reason === "timeout" ? "Time's up!" : "The round has ended",
    });

    room.roundNumber++;

    if (room.roundNumber >= room.totalRounds) {
      endGame(roomId, io, { reason: "finished" });
      return;
    }

    setTimeout(() => startRound(io, roomId), 2500);

  } catch (error) {
    console.log(error);
  }
};

// ------------------- GUESS CHECK -------------------
const isCorrectGuess = (guess, actualWord) => {
  if (!guess || !actualWord) return false;
  return guess.trim().toLowerCase() === actualWord.trim().toLowerCase();
};

// ------------------- ML CHEATING CHECK -------------------
const checkDrawingWithML = async (snapshotBase64, currentWord) => {
  try {
    const base64Data = snapshotBase64.replace(/^data:image\/(png|jpeg);base64,/, "");
    const target = currentWord ? currentWord.toLowerCase() : "unknown";

    const prompt = `
      You are a strict Pictionary referee.
      The secret word is "${target}".

      Detect if the drawing contains handwriting, letters, or the word "${target}".

      Respond ONLY in JSON:
      {
        "description": "...",
        "verdict": "text" | "drawing"
      }
    `;

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: "image/png",
      },
    };

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [prompt, imagePart],
    });

    let text = result.text?.trim() || "";

    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    let json;

    try {
      json = JSON.parse(text);

      console.log("------------------------------------------------");
      console.log(`🤖 Target Word: "${target}"`);
      console.log(`👀 AI Saw: ${json.description}`);
      console.log(`⚖️ Verdict: ${json.verdict}`);
      console.log("------------------------------------------------");

      return json.verdict === "text" ? "text" : "drawing";
    } catch (e) {
      console.error("JSON parse fallback:", text);
      return text.includes("text") ? "text" : "drawing";
    }

  } catch (err) {
    console.error("AI Check Failed:", err.message);
    return "drawing";
  }
};

// ------------------- CHEATING PENALTY -------------------
const handleCheating = (io, roomId, drawerId) => {
  const room = rooms.get(roomId);
  if (!room) return;

  const oldScore = room.scores.get(drawerId) || 0;

  room.scores.set(drawerId, Math.max(0, oldScore - 10));

  io.to(roomId).emit("cheatingDetected", {
    drawer: room.usernames.get(drawerId),
    message: "⚠️ CHEATING DETECTED! -10 pts",
    scores: Array.from(room.scores).map(([id, score]) => ({
      player: room.usernames.get(id),
      score,
    })),
  });
};

// ------------------- SOCKET HANDLERS -------------------
const gameHandler = (io, socket) => {
  socket.on("startGame", async ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error", { message: "Room not found" });
    if (room.ongoingGame) return socket.emit("error", { message: "Game already running." });
    if (room.players.size < 2) return socket.emit("error", { message: "Need at least 2 players." });

    await startGame(io, roomId);
  });

  socket.on("submitGuess", ({ roomId, guess }) => {
    const room = rooms.get(roomId);
    if (!room || !room.roundActive) return;

    if (socket.id === room.drawer) {
      return socket.emit("error", { message: "Drawer cannot guess" });
    }

    if (isCorrectGuess(guess, room.currentWord)) {
      const currentScore = room.scores.get(socket.id) || 0;

      room.scores.set(socket.id, currentScore + 20);

      const correctPlayer = room.usernames.get(socket.id);

      io.to(roomId).emit("correctGuess", {
        player: correctPlayer,
        guess,
        message: `${correctPlayer} guessed correctly! (+20 pts)`,
      });

      endRound(io, roomId, { reason: "Guessed correctly", winner: correctPlayer });
    } else {
      socket.emit("guessFeedback", { correct: false, guess });
    }
  });

  socket.on("drawing", ({ roomId, stroke }) => {
    const room = rooms.get(roomId);
    if (!room || room.drawer !== socket.id || !room.roundActive) return;
    socket.to(roomId).emit("drawing", { stroke });
  });

  socket.on("checkCheating", async ({ roomId, snapshot }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const now = Date.now();
    if (now - room.lastMLCheckAt < 3000) return;
    room.lastMLCheckAt = now;

    if (room.drawer !== socket.id) return;

    const verdict = await checkDrawingWithML(snapshot, room.currentWord);

    if (verdict === "text") {
      handleCheating(io, roomId, socket.id);
    }
  });
};

// Export everything
export { gameHandler, endGame, endRound, clearRoundTimer };
