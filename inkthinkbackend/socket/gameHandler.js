import { rooms, words } from "./gameState.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

// --- AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const ROUND_DURATION = 60000; 

// Utility function to pick the next drawer
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

    room.playerOrder = Array.from(room.players);
    room.totalRounds = room.playerOrder.length;
    room.roundNumber = 0;
    
    room.playerOrder.forEach((p) => room.scores.set(p, 0));
    room.ongoingGame = true;
    room.roundActive = false;
    room.drawer = null;
    room.currentWord = null;
    room.lastMLCheckAt = 0;

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
  if(winnerId) {
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
    rooms.delete(roomId); 
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
      endGame(roomId, io, { reason: "no_players_left" });
      return;
    }
    room.currentWord = pickWord();
    room.drawer = drawer;
    room.roundActive = true;
    room.lastMLCheckAt = 0;

    room.remainingTime = ROUND_DURATION;

    io.to(room.drawer).emit("yourTurn", { word: room.currentWord, remainingTime: room.remainingTime });
    io.to(roomId).emit("roundStarted", {
      roundNumber: room.roundNumber,
      drawer: room.usernames.get(room.drawer),
      message : "The round has started!",
      remainingTime: room.remainingTime 
    });

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
      io.to(roomId).emit("timerUpdate",{
        remainingTime:room.remainingTime
      })
    }
    }, 1000); 
  } catch (error) {
    console.log(error);
  }
};

// --- UPDATED END ROUND LOGIC ---
const endRound = (io, roomId, { reason = "completed", winner = null } = {}) => {
  try {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.roundActive) return;

    room.roundActive = false;
    clearRoundTimer(room);

    // [CHANGE 2] Penalty for Drawer if nobody guessed (Reason: timeout)
    if (reason === "timeout") {
        const drawerId = room.drawer;
        if (drawerId) {
            const currentScore = room.scores.get(drawerId) || 0;
            // Subtract 10, but don't go below 0 (optional, remove Math.max if you want negative scores)
            room.scores.set(drawerId, Math.max(0, currentScore - 10));
        }
    }

    io.to(roomId).emit("roundEnded", {
      reason,
      winner,
      word: room.currentWord,
      scores: Array.from(room.scores).map(([id, score]) => ({
        player: room.usernames.get(id),
        score
      })),
      message : reason === "timeout" ? "Time's up! No one guessed it." : "The round has ended"
    });

    room.roundNumber += 1;
    if (room.roundNumber >= room.totalRounds) {
      endGame(roomId, io, { reason: "finished" });
      return;
    }

    setTimeout(() => startRound(io, roomId), 2500);
  } catch (error) {
    console.log(error);
  }
};

const isCorrectGuess = (guess, actualWord) => {
  if (!guess || !actualWord) return false;
  return guess.trim().toLowerCase() === actualWord.trim().toLowerCase();
};

// const checkDrawingWithML = async (snapshotBase64) => {
  
//   try {
//     const base64Data = snapshotBase64.replace(/^data:image\/(png|jpeg);base64,/, "");
//     // const prompt = "Look at this sketch. Does it contain written letters or words that spell out the answer? If it is mostly text/words, respond with 'text'. If it is a drawing, respond with 'drawing'.";
    

//     const prompt = `
//       Analyze this sketch for 'cheating' in a Pictionary game.
      
//       Rules for Cheating:
//       1. The user MUST be writing actual words or letters to spell out the answer.
//       2. IGNORE simple geometric shapes like circles, squares, or lines, even if they look like the letters 'O', 'L', or 'I'.
//       3. A single circle is NOT text. A single rectangle is NOT text.
//       4. Only flag as 'text' if you see clearly written words (like "APPLE", "DOG") or multiple letters arranged to form a word.
      
//       Response format:
//       - If it is a drawing (even with shapes): respond 'drawing'.
//       - If it is clearly written text/words: respond 'text'.
//     `;
    
//     const imagePart = {
//       inlineData: {
//         data: base64Data,
//         mimeType: "image/png",
//       },
//     };

//     const result = await model.generateContent([prompt, imagePart]); 
//     const response = await result.response;
//     const text = response.text().trim().toLowerCase();
    
//     console.log("🤖 Gemini Analysis:", text); 
//     return text.includes("text") ? "text" : "drawing";
//   } catch (error) {
//     console.error("AI Check Failed:", error.message);
//     return "drawing"; 
//   }
// };

// socket/gameHandler.js

// socket/gameHandler.js

// ... (imports remain the same) ...

const checkDrawingWithML = async (snapshotBase64, currentWord) => {
  try {
    const base64Data = snapshotBase64.replace(/^data:image\/(png|jpeg);base64,/, "");
    // Ensure we have a valid target word
    const target = currentWord ? currentWord.trim().toLowerCase() : "unknown";

    const prompt = `
      You are a strict referee for a Pictionary game. The secret word is "${target}".
      
      Analyze the image and provide a JSON response.
      
      Step 1: Look for HANDWRITING. 
      - Do you see any letters or words? 
      - Does it spell "${target}" or parts of it?
      - Note: Messy handwriting counts as text.
      
      Step 2: Make a Verdict.
      - If you see the written word "${target}" (even partially), the verdict is 'text'.
      - If you see BOTH a drawing and the written word, the verdict is 'text'.
      - Only return 'drawing' if there is NO writing related to the answer.

      Return ONLY a JSON object in this format:
      {
        "description": "I see a sketch of a cylinder. I also see the letters B, O, T, T, L, E written.",
        "verdict": "text" 
      }
    `;

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: "image/png",
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    let text = response.text().trim();

    // Clean up potential markdown formatting
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    try {
        const analysis = JSON.parse(text);
        
        // --- VISUALIZE WHAT AI SEES ---
        console.log(`------------------------------------------------`);
        console.log(`🤖 Target Word: "${target}"`);
        console.log(`👀 AI Saw: ${analysis.description}`);
        console.log(`⚖️ Verdict: ${analysis.verdict}`);
        console.log(`------------------------------------------------`);
        
        return analysis.verdict === "text" ? "text" : "drawing";
    } catch (e) {
        console.error("JSON Parse Error, falling back to raw check:", text);
        return text.includes("text") ? "text" : "drawing";
    }

  } catch (error) {
    console.error("AI Check Failed:", error.message);
    return "drawing"; 
  }
};

// ... (Rest of the file remains exactly as you had it) ...

// --- UPDATED CHEATING LOGIC ---


const handleCheating = (io, roomId, drawerId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  const oldscore = room.scores.get(drawerId) || 0;
  
  // Apply Penalty
  room.scores.set(drawerId, Math.max(0, oldscore - 10));
  
  io.to(roomId).emit("cheatingDetected", {
    drawer : room.usernames.get(drawerId),
    message: "⚠️ CHEATING DETECTED! Penalty of -10 applied!",
    // NEW: Send the updated scores array so frontend can update immediately
    scores: Array.from(room.scores).map(([id, score]) => ({
      player: room.usernames.get(id),
      score
    }))
  });
};

const gameHandler = (io, socket) => {
  socket.on("startGame", async ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("error", { message: "Room not found" });
      if (room.ongoingGame) return socket.emit("error", { message: "Game already running." });
      if (room.players.size < 2) return socket.emit("error", { message: "Need at least 2 players." });
      await startGame(io, roomId);
    } catch (error) {
      console.error("Error starting game:", error);
    }
  });

  socket.on("submitGuess", ({ roomId, guess }) => {
    try {
       const room = rooms.get(roomId);
       if (!room || !room.roundActive) return;
       if (socket.id == room.drawer) return socket.emit("error", { message: "Drawer cannot guess" });
       
       if (isCorrectGuess(guess, room.currentWord)) {
         const currentScore = room.scores.get(socket.id) || 0;
         
         // [CHANGE 1] Reward increased from +1 to +20
         room.scores.set(socket.id, currentScore + 20);

         const correctGuesser = room.usernames.get(socket.id);
         io.to(roomId).emit("correctGuess", {
           player: correctGuesser,
           guess,
           message : `${correctGuesser} guessed correctly! (+20 pts)`
         });
         endRound(io, roomId, { reason: "Guessed correctly", winner: correctGuesser });
       } else {
         socket.emit("guessFeedback", { correct: false, guess });
       }
    } catch(err) { console.log(err); }
  });

  socket.on("drawing", ({ roomId, stroke }) => {
     const room = rooms.get(roomId);
     if (!room || room.drawer !== socket.id || !room.roundActive) return;
     socket.to(roomId).emit("drawing", { stroke });
  });

  socket.on("checkCheating", async ({ roomId, snapshot }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return;
      
      const now = Date.now();
      if (now - room.lastMLCheckAt < 3000) return; 
      room.lastMLCheckAt = now;

      if (room.drawer !== socket.id) return; 

      const result = await checkDrawingWithML(snapshot , room.currentWord);
      
      if (result === "text") {
        handleCheating(io, roomId, socket.id);
      }
    } catch (error) {
      console.error("Error in checkCheating:", error);
    }
  });
};

export { gameHandler, endGame, endRound, clearRoundTimer };