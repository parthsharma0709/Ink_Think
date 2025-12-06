// All the logic related to rooms, i.e room creation , keeping track of the sockets enrolled in a room, etc lives here
import { rooms } from "./gameState.js";
import { endGame, endRound, clearRoundTimer } from "./gameHandler.js";

// Clean-up logic for roomHandler: Handles both the game and room related events
const roomCleanup = (io, roomId, socketId) => {
  const room = rooms.get(roomId);
  if (!room) return;

  // Game related clean-up
  if (room.ongoingGame && room.roundActive && room.drawer === socketId) {
    endRound(io, roomId, { reason: "drawer_left" });
  }
  if (room.ongoingGame && room.players.size < 2) {
    endGame(roomId, io, { reason: "not_enough_players" });
  }

  // Room- Level Cleanup
  const username = room.usernames.get(socketId);
  room.players.delete(socketId);
  io.to(room.id).emit("playerLeft", { message: `${username} left the game` });
  if (room.players.size === 0) {
    clearRoundTimer(room);
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted`);
  }
};

const roomHandler = (io, socket) => {
  // Listen for room create events from the client
  socket.on("createRoom", ({ roomId, username }) => {
    try {
      console.log(`User ${username} wants to create room: ${roomId}`);

      // Check if room already exists
      if (rooms.has(roomId)) {
        return socket.emit("error", { message: "The room already exists" });
      }

      if (!username || username.trim().length === 0 || username.length > 20) {
        return socket.emit("error", { message: "Invalid username" });
      }

      // Create a new room in the map
      rooms.set(roomId, {
        players: new Set([socket.id]),
        usernames: new Map([[socket.id, username]]),
        scores: new Map([[socket.id, 0]]),
        playerOrder: [], // will be populated when the game starts (snapshot of player order)
        drawer: null,
        currentWord: null, // active word for the round
        roundActive: false,
        roundNumber: 0,
        totalRounds: 0, // can later be updated to players.size()
        ongoingGame: false, // prevents joining mid-game
        currentRoundTimer: null,
        lastMLCheckAt: Date.now(), // optional timestamp for ML check tracking
        remainingTime: null
      });

      // Join this client into the room
      socket.join(roomId);

      // Acknowledge back to the client
      socket.emit("roomCreated", {
        roomId,
        username,
        message: "The room has been created!",
      });

      socket
        .to(roomId)
        .emit("message", { message: `${username} created room ${roomId}` });

      console.log(`Room ${roomId} created with player ${username}`);
    } catch (error) {
      console.log("Error in the create room handler: ", error.message);
      socket.emit("error", { message: "Failed to create the room" });
    }
  });

  //  Listener for Room Join events from the client
  socket.on("joinRoom", ({ roomId, username }) => {
    try {
      // First Check if the room exists or not
      if (!rooms.has(roomId)) {
        return socket.emit("error", { message: "This room does not exist" });
      }

      console.log(`User ${username} wants to join the room ${roomId}`);
      if (!username || username.trim().length === 0 || username.length > 20) {
        return socket.emit("error", { message: "Invalid username" });
      }

      const room = rooms.get(roomId);
      if (room.ongoingGame) {
        return socket.emit("error", {
          message: "Game has already started, you can't join",
        });
      }
      if (!room.players.has(socket.id)) {
        room.players.add(socket.id);
        room.usernames.set(socket.id, username);

        // Join this client into the room
        socket.join(roomId);

        // Acknowledge Back to the client
        socket.emit("roomJoined", {
          roomId,
          username,
          message: "You have joined the room",
        });

        // Notify others in the room
        socket
          .to(roomId)
          .emit("message", { message: `${username} joined room ${roomId}` });
      } else {
        socket.emit("error", {
          message: "You can not join the same room twice!",
        });
      }
    } catch (error) {
      console.log("Error in the joinRoom handler", error.message);
      socket.emit("error", { message: "Failed to join the room" });
    }
  });

  // Listener for leaving room events from the client
  socket.on("leaveRoom", ({ roomId }) => {
    try {
      roomCleanup(io, roomId, socket.id);
    } catch (error) {
      console.log("Error in the leaveRoom handler", error.message);
      socket.emit("error", { message: "Failed to leave the room" });
    }
  });

  // Listener for disconnect clean-up
  socket.on("disconnecting", () => {
    try {
      [...socket.rooms]
        .filter((r) => r !== socket.id)
        .forEach((roomId) => {
          roomCleanup(io, roomId, socket.id);
        });
    } catch (error) {
      console.error("There was an error in the disconnecting listener:", error);
    }
  });
};

export default roomHandler;