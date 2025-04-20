import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const rooms = {};

const getMaskedMovie = (movie, usedLetters = []) => {
  return movie
    .toUpperCase()
    .split("")
    .map(char => {
      if ("AEIOU".includes(char)) return char;
      return usedLetters.includes(char) ? char : "_";
    });
};

io.on("connection", (socket) => {
  socket.on("create-room", ({ name }, cb) => {
    const code = Math.random().toString(36).substr(2, 5).toUpperCase();
    rooms[code] = {
      players: [{ id: socket.id, name, team: "A", isLeader: true }],
      leader: name,
      movie: null,
      usedLetters: [],
      guess: [],
      scores: { A: 0, B: 0 },
      currentTeam: "A",
      wrongGuesses: 0,
      round: 1
    };
    socket.join(code);
    cb(code);
  });

  socket.on("join-room", ({ room, name }, cb) => {
    const roomData = rooms[room];
    if (!roomData) return cb(false);

    const team = roomData.players.filter(p => p.team === "A").length >
                 roomData.players.filter(p => p.team === "B").length ? "B" : "A";

    roomData.players.push({ id: socket.id, name, team, isLeader: false });
    socket.join(room);
    cb(true);
    io.to(room).emit("game-state", roomData);
  });

  socket.on("join-game", ({ room, name }) => {
    const roomData = rooms[room];
    if (!roomData) return;
    io.to(room).emit("game-state", roomData);
  });

  socket.on("submit-movie", ({ room, movie }) => {
    const roomData = rooms[room];
    roomData.movie = movie.toUpperCase();
    roomData.usedLetters = [];
    roomData.guess = getMaskedMovie(movie);
    roomData.wrongGuesses = 0;
    io.to(room).emit("game-state", roomData);
  });

  socket.on("guess-letter", ({ room, letter }) => {
    const roomData = rooms[room];
    if (!roomData || roomData.usedLetters.includes(letter)) return;

    roomData.usedLetters.push(letter);
    const movie = roomData.movie.toUpperCase();

    if (!movie.includes(letter)) {
      roomData.wrongGuesses++;
      if (roomData.wrongGuesses >= 9) {
        roomData.movie = null;
        roomData.wrongGuesses = 0;
        roomData.currentTeam = roomData.currentTeam === "A" ? "B" : "A";
      }
    } else {
      const updated = getMaskedMovie(movie, roomData.usedLetters);
      roomData.guess = updated;

      if (!updated.includes("_")) {
        roomData.scores[roomData.currentTeam] += 10;
        roomData.movie = null;
        roomData.currentTeam = roomData.currentTeam === "A" ? "B" : "A";
      }
    }

    io.to(room).emit("game-state", roomData);
  });

  socket.on("timeout-strike", ({ room }) => {
    const roomData = rooms[room];
    roomData.wrongGuesses++;
    if (roomData.wrongGuesses >= 9) {
      roomData.movie = null;
      roomData.currentTeam = roomData.currentTeam === "A" ? "B" : "A";
      roomData.wrongGuesses = 0;
    }
    io.to(room).emit("game-state", roomData);
  });

  socket.on("send-message", ({ room, message }) => {
    io.to(room).emit("receive-message", message);
  });

  socket.on("disconnect", () => {
    for (const room in rooms) {
      const roomData = rooms[room];
      roomData.players = roomData.players.filter(p => p.id !== socket.id);
      if (roomData.players.length === 0) {
        delete rooms[room];
      } else {
        // Reassign leader if necessary
        if (!roomData.players.find(p => p.isLeader)) {
          roomData.players[0].isLeader = true;
          roomData.leader = roomData.players[0].name;
        }
        io.to(room).emit("game-state", roomData);
      }
    }
  });
});

server.listen(3001, () => {
  console.log("✅ Bollywood Game Server is running on port 3001");
});
