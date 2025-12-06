// This file contains all the game orchsteration logic, rounds in the game, guesses in the game, and all of this will be handled here

import { rooms, words } from "./gameState.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
//const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

//const ML_API_URL = ""; // will be integrated later
const ROUND_DURATION = 60000; // in milli-seconds

// This is the Structure of the Map used to manage the state of the game
//   players: Set(socketId),
//   scores: Map(socketId -> number),
//   playerOrder: Array(socketId) // snapshot at game start
//   drawer: socketId | null,
//   currentWord: string | null,
//   roundActive: boolean,
//   roundNumber: number,
//   totalRounds: number,
//   ongoingGame: boolean,
//   currentRoundTimer: Timeout | null,
//   lastMLCheckAt: number (timestamp ms) // optional
//   remainingTime: null (Eventually will be time)


// Utility function to pick the next drawer
const pickDrawer = (room) => {
  const players = room.playerOrder;
  let idx = room.roundNumber; // 0 - based indexing, for roundNumber
  while (idx < players.length) {
    const player = players[idx];
    if (room.players.has(player)) return player;
    idx += 1; // Skip Invalid Players
    room.roundNumber += 1;
  }
  return null;
};

// Utility Function to pick the word
const pickWord = () => {
  return words[Math.floor(Math.random() * words.length)];
};

// Utility Function to clear any timer attached to the room state
const clearRoundTimer = (room) => {
  if (!room) return null;
  if (room.currentRoundTimer) {
    clearInterval(room.currentRoundTimer);
    room.currentRoundTimer = null;
  }
};

const startGame = async (io, roomId) => {
  try {
    const room = rooms.get(roomId);
    if (!room) return null;
    if (!room.scores) room.scores = new Map();
    if (!room.playerOrder) room.playerOrder = [];

    if (room.ongoingGame) return;
    if (!room.players || room.players.size < 2) {
      io.to(roomId).emit("error", {
        message: "Need at least 2 players to start",
      });
      return;
    }

    // Freeze player order for the whole game
    room.playerOrder = Array.from(room.players);
    room.totalRounds = room.playerOrder.length;
    room.roundNumber = 0;
    // Initialise scores
    room.playerOrder.forEach((p) => room.scores.set(p, 0));
    room.ongoingGame = true;
    room.roundActive = false;
    room.drawer = null;
    room.currentWord = null;
    room.lastMLCheckAt = 0;

    // The players who have joined the room for the game session are stored in this array

    io.to(roomId).emit("gameStarted", {
      totalRounds: room.totalRounds,
      players: room.playerOrder.map(id => room.usernames.get(id)),
      message: "The Game has started"
    });

    setTimeout(() => {
      startRound(io, roomId);
    }, 1500);
  } catch (error) {
    console.log(error);
  }
};

const findWinner = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return null;
  let max = -Infinity;
  let winnerId = null;
  for (const [pid, sc] of room.scores) {
    if (sc > max) {
      max = sc;
      winnerId = pid;
    }
  }
  if(winnerId)
  {
    return room.usernames.get(winnerId);
  }
  return "Nobody";
};

const endGame = (roomId, io, { reason = "finished" } = {}) => {
  try {
    const room = rooms.get(roomId);
    if (!room) return;

    room.ongoingGame = false;
    room.roundActive = false;

    const winner = findWinner(roomId);
    // Declare the winner, i.e emit the event to the players in the room
    io.to(roomId).emit("gameEnded", {
      reason,
      scores: Array.from(room.scores).map(([id, score]) => ({
      player: room.usernames.get(id),
      score
      })),
      winner: winner,
      message : `${winner} won the game. The Game ends here.`
    });
    clearRoundTimer(room);
    rooms.delete(roomId); // delete this room
  } catch (error) {
    console.log(error);
  }
};

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
      // If there is no-one left to draw, end the game right now
      endGame(roomId, io, { reason: "no_players_left" });
      return;
    }
    room.currentWord = pickWord();
    room.drawer = drawer;
    room.roundActive = true;
    room.lastMLCheckAt = 0;

    room.remainingTime = ROUND_DURATION;

    // Drawer and the word has been decided, send this info to the players in the room
    io.to(room.drawer).emit("yourTurn", { word: room.currentWord, remainingTime: room.remainingTime });
    io.to(roomId).emit("roundStarted", {
      roundNumber: room.roundNumber,
      drawer: room.usernames.get(room.drawer),
      message : "The round has started!",
      remainingTime: room.remainingTime 
    });

    // Start a roundTimer (Give a fix time to guess the word to the players)
    clearRoundTimer(room);
    room.currentRoundTimer = setInterval(() => {
    room.remainingTime -= 1000;
    if(room.remainingTime <= 0)
    {
      // Time is up, end the round
      endRound(io,roomId,{reason:"timeout"});
    }
    else
    {
      // Time is still-left update to anybody
      io.to(roomId).emit("timerUpdate",{
        remainingTime:room.remainingTime
      })
    }
    }, 1000); // Run this every second
  } catch (error) {
    console.log(error);
  }
};

// End the current round
const endRound = (io, roomId, { reason = "completed", winner = null } = {}) => {
  try {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.roundActive) return;

    room.roundActive = false;
    clearRoundTimer(room);

    // Inform players of the current round result
   io.to(roomId).emit("roundEnded", {
    reason,
    winner,
    word: room.currentWord,
    scores: Array.from(room.scores).map(([id, score]) => ({
    player: room.usernames.get(id),
    score
  })),
  message : "The round has ended"
});

    // Increment the round Number
    room.roundNumber += 1;
    if (room.roundNumber >= room.totalRounds) {
      endGame(roomId, io, { reason: "finished" });
      return;
    }

    // Start next round after a short delay, so that client can show results
    setTimeout(() => startRound(io, roomId), 2500);
  } catch (error) {
    console.log(error);
  }
};

const isCorrectGuess = (guess, actualWord) => {
  if (!guess || !actualWord) return false;
  return guess.trim().toLowerCase() === actualWord.trim().toLowerCase();
};



// const checkDrawingWithML = async (snapshot) => {
//   // will be implemented later
// };
// 1. Implement the AI Check function
const checkDrawingWithML = async (snapshotBase64) => {
  try {
    // Remove the data URL prefix (e.g., "data:image/png;base64,")
    const base64Data = snapshotBase64.replace(/^data:image\/(png|jpeg);base64,/, "");

    const prompt = "Look at this sketch. Does it contain written letters or words that spell out the answer? If it is mostly text/words, respond with 'text'. If it is a drawing, respond with 'drawing'.";
    
    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: "image/png",
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text().trim().toLowerCase();
    
    console.log("Gemini Analysis:", text); // For debugging
    return text.includes("text") ? "text" : "drawing";
  } catch (error) {
    console.error("AI Check Failed:", error);
    return "drawing"; // Fail safe
  }
};


// cheating penalty
const handleCheating = (io, roomId, drawerId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  const oldscore = room.scores.get(drawerId) || 0;
  room.scores.set(drawerId, Math.max(0, oldscore - 1));
  io.to(roomId).emit("cheatingDetected", {
    drawer : room.usernames.get(drawerId),
    message: "Drawer attempted cheating! Penalty imposed",
  });
};

const gameHandler = (io, socket) => {
  // Start Game Listener
  socket.on("startGame", async ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("error", { message: "Room not found" });
      if (room.ongoingGame)
        return socket.emit("error", { message: "Game already running." });
      if (room.players.size < 2)
        return socket.emit("error", {
          message: "Need at least 2 players to start the game.",
        });
      await startGame(io, roomId);
    } catch (error) {
      console.error("Error in the startGame listener:", error);
      socket.emit("error", { message: "Failed to start game" });
    }
  });

  // Guess Listener
  socket.on("submitGuess", ({ roomId, guess }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("error", { message: "Room not found" });
      if (!room.roundActive) return; // Not do anything at all
      if (socket.id == room.drawer)
        return socket.emit("error", { message: "Drawer cannot guess" });
      // Check the correctness of the guess
      if (isCorrectGuess(guess, room.currentWord)) {
        const currentScore = room.scores.get(socket.id) || 0;
        room.scores.set(socket.id, currentScore + 1);

        const correctGuesser = room.usernames.get(socket.id);
        io.to(roomId).emit("correctGuess", {
          player: correctGuesser,
          guess,
          message : `${correctGuesser} guessed correctly.`
        });

        endRound(io, roomId, {
          reason: "Guessed correctly",
          winner: room.usernames.get(socket.id),
        });
      } else {
        socket.emit("guessFeedback", { correct: false, guess });
      }
    } catch (error) {
      console.error("Error in submitGuess Listener:", error);
      socket.emit("error", { message: "Failed to process the guess" });
    }

    
  });

  // Handle Drawing Strokes
  // socket.on("drawing", async ({ roomId, stroke, snapshot }) => {
  //   try {
  //     const room = rooms.get(roomId);
  //     if (!room) return;
  //     if (room.drawer !== socket.id) return; // Only, the drawer can draw
  //     if (!room.roundActive) return;

  //     // Broadcast stroke to other players
  //     socket.to(roomId).emit("drawing", { stroke });

  //     // Machine Learning Check
  //     const now = Date.now();
  //     if (snapshot && now - room.lastMLCheckAt > 3000) {
  //       room.lastMLCheckAt = now;
  //       const result = await checkDrawingWithML(snapshot);
  //       if (result === "text") {
  //         handleCheating(io, roomId, socket.id);
  //       }
  //     }
  //   } catch (error) {
  //     console.error("Error in drawing lsitener:", error);
  //   }
  // });
  socket.on("drawing", ({ roomId, stroke }) => {
      const room = rooms.get(roomId);
      if (!room || room.drawer !== socket.id || !room.roundActive) return;
      socket.to(roomId).emit("drawing", { stroke });
  });

  // 2. Add a NEW listener specifically for periodic checks
  socket.on("checkCheating", async ({ roomId, snapshot }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return;
      
      // Throttling: Ensure we don't check too often (server-side safety)
      const now = Date.now();
      if (now - room.lastMLCheckAt < 3000) return; 
      room.lastMLCheckAt = now;

      if (room.drawer !== socket.id) return; // Only check the drawer

      const result = await checkDrawingWithML(snapshot);
      
      if (result === "text") {
        handleCheating(io, roomId, socket.id);
      }
    } catch (error) {
      console.error("Error in checkCheating:", error);
    }
  });

  
};

export { gameHandler, endGame, endRound, clearRoundTimer };