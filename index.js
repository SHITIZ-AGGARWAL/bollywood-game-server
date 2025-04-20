// ✅ Bollywood Game Server - Full Final Version
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

io.on("connection", (socket) => {
  // ✅ CREATE ROOM
  socket.on("createRoom", ({ roomId, player }) => {
    rooms[roomId] = {
      teams: {
        A: { players: [{ ...player, id: socket.id, isLeader: true }], score: 0, leader: socket.id },
        B: { players: [], score: 0, leader: null },
      },
      round: 1,
      turn: "A",
      currentMovie: null,
      maskedMovie: "",
      strikes: 0,
      usedLetters: [],
    };
    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    io.to(roomId).emit("updateTeams", rooms[roomId].teams);
  });

  // ✅ JOIN ROOM
  socket.on("joinRoom", ({ roomId, player }) => {
    const room = rooms[roomId];
    if (!room) return;

    const newPlayer = { ...player, id: socket.id, isLeader: false };

    // Ensure clean state (remove if already in room)
    room.teams.A.players = room.teams.A.players.filter(p => p.id !== socket.id);
    room.teams.B.players = room.teams.B.players.filter(p => p.id !== socket.id);

    room.teams.A.players.push(newPlayer); // default assignment
    socket.join(roomId);
    socket.emit("playerJoined", { playerId: socket.id });
    io.to(roomId).emit("updateTeams", room.teams);
  });

  // ✅ JOIN TEAM
  socket.on("joinTeam", ({ roomId, team }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Remove from all teams
    ["A", "B"].forEach(t => {
      room.teams[t].players = room.teams[t].players.filter(p => p.id !== socket.id);
      if (room.teams[t].leader === socket.id) {
        room.teams[t].leader = null;
      }
    });

    // Reassign player to new team
    const allPlayers = [...room.teams.A.players, ...room.teams.B.players];
    const existingPlayer = allPlayers.find(p => p.id === socket.id);
    if (!existingPlayer) return;

    existingPlayer.isLeader = false;
    room.teams[team].players.push(existingPlayer);

    if (!room.teams[team].leader) {
      room.teams[team].leader = socket.id;
      existingPlayer.isLeader = true;
    }

    io.to(roomId).emit("updateTeams", room.teams);
  });

  // ✅ START GAME
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
    }
  });

  // ✅ SUBMIT MOVIE
  socket.on("submitMovie", ({ roomId, movie }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.currentMovie = movie.toUpperCase();
    room.usedLetters = [];
    room.strikes = 0;
    room.maskedMovie = getMaskedMovie(movie, []);

    io.to(roomId).emit("movieReady", room.maskedMovie);
  });

  // ✅ GUESS LETTER
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
  });

  // ✅ NEXT ROUND
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
  });

  // ✅ CHAT
  socket.on("sendMessage", ({ roomId, message }) => {
    io.to(roomId).emit("receiveMessage", message);
  });

  // ✅ HANDLE DISCONNECT
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
      io.to(roomId).emit("updateTeams", room.teams);
    }
  });
});

server.listen(3001, () => {
  console.log("✅ Bollywood Game Server is running on port 3001");
});
