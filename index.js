// ✅ Bollywood Game Server - Full Final Version with Player Sync Fixes
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
    }).join("");
};

const emitRoomState = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;

  const players = [];

  room.teams.A.players.forEach(p => players.push({ ...p, team: "A" }));
  room.teams.B.players.forEach(p => players.push({ ...p, team: "B" }));

  io.to(roomId).emit("roomState", {
    teams: room.teams,
    players,
    round: room.round,
    turn: room.turn,
    currentMovie: room.currentMovie,
    maskedMovie: room.maskedMovie,
    strikes: room.strikes,
    usedLetters: room.usedLetters,
  });
};

io.on("connection", (socket) => {
  socket.on("createRoom", ({ roomId, player }) => {
    rooms[roomId] = {
      teams: {
        A: { players: [], score: 0, leader: null },
        B: { players: [], score: 0, leader: null },
      },
      waitingPlayers: [{ ...player, id: socket.id, isLeader: false }],
      round: 1,
      turn: "A",
      currentMovie: null,
      maskedMovie: "",
      strikes: 0,
      usedLetters: [],
    };
    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    emitRoomState(roomId);
  });

  socket.on("joinRoom", ({ roomId, player }) => {
    const room = rooms[roomId];
    if (!room) return;

    const newPlayer = { id: socket.id, name: player.name, isLeader: false };
    room.waitingPlayers = room.waitingPlayers.filter(p => p.id !== socket.id);
    room.waitingPlayers.push(newPlayer);

    socket.join(roomId);
    socket.emit("playerJoined", { playerId: socket.id, name: player.name });
    emitRoomState(roomId);
  });

  socket.on("joinTeam", ({ roomId, team }) => {
    const room = rooms[roomId];
    if (!room) return;

    let joiningPlayer = room.waitingPlayers.find(p => p.id === socket.id);
    if (!joiningPlayer) {
      ["A", "B"].forEach(t => {
        const existing = room.teams[t].players.find(p => p.id === socket.id);
        if (existing) joiningPlayer = existing;
      });
    }
    if (!joiningPlayer) return;

    room.waitingPlayers = room.waitingPlayers.filter(p => p.id !== socket.id);
    ["A", "B"].forEach(t => {
      room.teams[t].players = room.teams[t].players.filter(p => p.id !== socket.id);
      if (room.teams[t].leader === socket.id) room.teams[t].leader = null;
    });

    room.teams[team].players.push(joiningPlayer);
    if (!room.teams[team].leader) {
      room.teams[team].leader = socket.id;
      joiningPlayer.isLeader = true;
    }

    emitRoomState(roomId);
  });

  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const teamAReady = room.teams.A.players.length > 0;
    const teamBReady = room.teams.B.players.length > 0;

    if (teamAReady && teamBReady) {
      room.round = 1;
      room.turn = "A";
      room.strikes = 0;
      room.usedLetters = [];
      room.currentMovie = null;
      room.maskedMovie = "";

      io.to(roomId).emit("gameStarted");
      emitRoomState(roomId);
    }
  });

  socket.on("submitMovie", ({ roomId, movie }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.currentMovie = movie.toUpperCase();
    room.usedLetters = [];
    room.strikes = 0;
    room.maskedMovie = getMaskedMovie(movie, []);

    io.to(roomId).emit("movieReady", room.maskedMovie);
    emitRoomState(roomId);
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
        io.to(roomId).emit("roundResult", {
          winner: guessingTeam,
          score: room.teams,
        });
      }
    } else {
      room.strikes += 1;
      io.to(roomId).emit("wrongGuess", room.strikes);
      if (room.strikes >= 9) {
        io.to(roomId).emit("roundFailed", { movie: room.currentMovie });
      }
    }
    emitRoomState(roomId);
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

    io.to(roomId).emit("roundStart", room.turn);
    emitRoomState(roomId);
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
      emitRoomState(roomId);
    }
  });
});

server.listen(3001, () => {
  console.log("✅ Bollywood Game Server is running on port 3001");
});
