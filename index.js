import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const rooms = {};

const getMaskedMovie = (movie, usedLetters = []) => {
  return movie
    .toUpperCase()
    .split("")
    .map(char => {
      if ("AEIOU ".includes(char)) return char;
      return usedLetters.includes(char) ? char : "_";
    })
    .join("");
};

const broadcastState = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("gameStateUpdate", {
    teams: room.teams,
    round: room.round,
    turn: room.turn,
    gameState: room.gameState,
    maskedMovie: room.maskedMovie,
    strikes: room.strikes,
  });
};

io.on("connection", (socket) => {
  socket.on("createRoom", ({ roomId, player }) => {
    rooms[roomId] = {
      teams: {
        A: { players: [{ ...player, id: socket.id, isLeader: true }], score: 0, leader: socket.id },
        B: { players: [], score: 0, leader: null },
      },
      waitingPlayers: [],
      round: 1,
      turn: "A",
      currentMovie: null,
      maskedMovie: "",
      strikes: 0,
      usedLetters: [],
      gameState: "waiting",
    };
    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    broadcastState(roomId);
  });

  socket.on("joinRoom", ({ roomId, player }) => {
    const room = rooms[roomId];
    if (!room) return;

    const newPlayer = { id: socket.id, name: player.name, isLeader: false };
    room.waitingPlayers = room.waitingPlayers.filter(p => p.id !== socket.id);
    room.waitingPlayers.push(newPlayer);
    socket.join(roomId);
    socket.emit("playerJoined", { playerId: socket.id, name: player.name });
    broadcastState(roomId);
  });

  socket.on("joinTeam", ({ roomId, team }) => {
    const room = rooms[roomId];
    if (!room) return;

    const index = room.waitingPlayers.findIndex(p => p.id === socket.id);
    if (index === -1) return;

    const joiningPlayer = room.waitingPlayers.splice(index, 1)[0];

    ["A", "B"].forEach(t => {
      room.teams[t].players = room.teams[t].players.filter(p => p.id !== socket.id);
      if (room.teams[t].leader === socket.id) room.teams[t].leader = null;
    });

    room.teams[team].players.push(joiningPlayer);
    if (!room.teams[team].leader) {
      room.teams[team].leader = socket.id;
      joiningPlayer.isLeader = true;
    }

    broadcastState(roomId);
  });

  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const A = room.teams.A.players.length > 0;
    const B = room.teams.B.players.length > 0;
    if (A && B) {
      room.round = 1;
      room.turn = "A";
      room.strikes = 0;
      room.usedLetters = [];
      room.currentMovie = null;
      room.maskedMovie = "";
      room.gameState = "submitting";
      io.to(roomId).emit("gameStarted");
      broadcastState(roomId);
    }
  });

  socket.on("submitMovie", ({ roomId, movie }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.currentMovie = movie.toUpperCase();
    room.usedLetters = [];
    room.strikes = 0;
    room.maskedMovie = getMaskedMovie(movie, []);
    room.gameState = "guessing";
    io.to(roomId).emit("movieReady", room.maskedMovie);
    broadcastState(roomId);
  });

  socket.on("guessLetter", ({ roomId, letter }) => {
    const room = rooms[roomId];
    if (!room || !room.currentMovie || room.usedLetters.includes(letter)) return;

    const upper = room.currentMovie.toUpperCase();
    room.usedLetters.push(letter);

    if (upper.includes(letter)) {
      room.maskedMovie = getMaskedMovie(upper, room.usedLetters);
      io.to(roomId).emit("correctGuess", room.maskedMovie);
      if (!room.maskedMovie.includes("_")) {
        const guessingTeam = room.turn === "A" ? "B" : "A";
        room.teams[guessingTeam].score += 10;
        room.gameState = "watching";
        io.to(roomId).emit("roundResult", {
          winner: guessingTeam,
          score: room.teams,
        });
        broadcastState(roomId);
      }
    } else {
      room.strikes += 1;
      io.to(roomId).emit("wrongGuess", room.strikes);
      if (room.strikes >= 9) {
        room.gameState = "watching";
        io.to(roomId).emit("roundFailed", { movie: room.currentMovie });
        broadcastState(roomId);
      }
    }
  });

  socket.on("nextRound", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.round += 1;
    room.turn = room.turn === "A" ? "B" : "A";
    room.currentMovie = "";
    room.maskedMovie = "";
    room.strikes = 0;
    room.usedLetters = [];
    room.gameState = "submitting";
    io.to(roomId).emit("roundStart", room.turn);
    broadcastState(roomId);
  });

  socket.on("sendMessage", ({ roomId, message }) => {
    io.to(roomId).emit("receiveMessage", message);
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      ["A", "B"].forEach(teamKey => {
        const team = room.teams[teamKey];
        team.players = team.players.filter(p => p.id !== socket.id);
        if (team.leader === socket.id) {
          team.leader = team.players[0]?.id || null;
          if (team.players[0]) team.players[0].isLeader = true;
        }
      });
      room.waitingPlayers = room.waitingPlayers.filter(p => p.id !== socket.id);
      broadcastState(roomId);
    }
  });
});

server.listen(3001, () => {
  console.log("✅ Bollywood Game Server is running on port 3001");
});
