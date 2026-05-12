require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const INVITE_TOKEN_SECRET = process.env.INVITE_TOKEN_SECRET || 'invite_secret';

// In-memory stores for prototype
const users = {}; // id -> {id, username, passwordHash}
const rooms = {}; // roomId -> {id, name, capacity, participants: Set of socketIds}
const invites = {}; // token -> {roomId, expiresAt|null}

// create a default room
const defaultRoomId = uuidv4();
rooms[defaultRoomId] = { id: defaultRoomId, name: 'Chill', capacity: 10, participants: new Set() };

// Auth endpoints (simple)
app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username+password required' });
  const existing = Object.values(users).find(u => u.username === username);
  if (existing) return res.status(400).json({ error: 'username taken' });
  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);
  users[id] = { id, username, passwordHash };
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id, username } });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = Object.values(users).find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'invalid' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid' });
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username } });
});

app.post('/auth/guest', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  const id = `guest:${uuidv4()}`;
  const token = jwt.sign({ id, username, guest: true }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id, username, guest: true } });
});

// rooms
app.get('/rooms', (req, res) => {
  const list = Object.values(rooms).map(r => ({ id: r.id, name: r.name, capacity: r.capacity, count: r.participants.size }));
  res.json(list);
});

app.post('/rooms', (req, res) => {
  const { name, capacity } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  rooms[id] = { id, name, capacity: capacity || 10, participants: new Set() };
  res.json({ id, name, capacity: rooms[id].capacity });
});

// invites
app.post('/invites', (req, res) => {
  const { roomId, permanent } = req.body;
  if (!roomId || !rooms[roomId]) return res.status(400).json({ error: 'invalid room' });
  const token = uuidv4().slice(0,8);
  const expiresAt = permanent ? null : Date.now() + 24*60*60*1000;
  invites[token] = { roomId, expiresAt };
  res.json({ token, url: `/invite/${token}`, expiresAt });
});

// health
app.get('/', (req, res) => {
  res.json({ ok: true, rooms: Object.keys(rooms).length });
});

app.get('/invite/:token', (req, res) => {
  const { token } = req.params;
  const inv = invites[token];
  if (!inv) return res.status(404).json({ error: 'invite not found' });
  if (inv.expiresAt && Date.now() > inv.expiresAt) return res.status(410).json({ error: 'expired' });
  const room = rooms[inv.roomId];
  const participants = Array.from(room.participants).map(sid => {
    const peer = io.sockets.sockets.get(sid);
    return {
      socketId: sid,
      username: peer ? peer.data.username : 'Unknown',
      avatarColor: peer ? peer.data.avatarColor : '#5865f2',
    };
  });
  res.json({
    invite: { token, expiresAt: inv.expiresAt, permanent: inv.expiresAt === null },
    room: { id: room.id, name: room.name, capacity: room.capacity, participants },
  });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// helper to broadcast room state
function emitRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const participants = Array.from(room.participants).map(socketId => {
    const s = io.sockets.sockets.get(socketId);
    if (!s) return null;
    return { socketId, username: s.data.username, avatarColor: s.data.avatarColor };
  }).filter(Boolean);
  io.to(roomId).emit('room-update', { roomId, participants, count: participants.length, capacity: room.capacity });
}

io.on('connection', (socket) => {
  socket.data.username = 'Anonymous';
  socket.data.avatarColor = `hsl(${Math.floor(Math.random()*360)} 70% 50%)`;

  socket.on('auth:identify', ({ token, username }) => {
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        socket.data.user = payload;
        socket.data.username = payload.username;
      } catch (e) {
        // ignore
      }
    } else if (username) {
      socket.data.username = username;
    }
  });

  socket.on('join-room', ({ roomId }) => {
    if (!rooms[roomId]) return;
    const room = rooms[roomId];
    // check capacity
    if (room.participants.size >= room.capacity) {
      socket.emit('room-full');
      return;
    }
    const participants = Array.from(room.participants).map(socketId => {
      const peer = io.sockets.sockets.get(socketId);
      return {
        socketId,
        username: peer ? peer.data.username : 'Unknown',
        avatarColor: peer ? peer.data.avatarColor : '#5865f2',
      };
    });
    socket.join(roomId);
    room.participants.add(socket.id);
    socket.emit('room-joined', {
      roomId,
      room: { id: room.id, name: room.name, capacity: room.capacity },
      participants,
    });
    emitRoomUpdate(roomId);
    // notify existing peers to prepare for connection
    socket.to(roomId).emit('peer-joined', { socketId: socket.id, username: socket.data.username, avatarColor: socket.data.avatarColor });
  });

  socket.on('leave-room', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    socket.leave(roomId);
    room.participants.delete(socket.id);
    emitRoomUpdate(roomId);
    socket.to(roomId).emit('peer-left', { socketId: socket.id });
  });

  // signaling proxy
  socket.on('signal', ({ to, data }) => {
    const target = io.sockets.sockets.get(to);
    if (target) target.emit('signal', { from: socket.id, data });
  });

  socket.on('disconnecting', () => {
    const roomsJoined = Array.from(socket.rooms).filter(r => r !== socket.id);
    roomsJoined.forEach(rid => {
      const room = rooms[rid];
      if (room) {
        room.participants.delete(socket.id);
        socket.to(rid).emit('peer-left', { socketId: socket.id });
      }
    });
  });

  socket.on('disconnect', () => {
    // emit room updates for any room the socket was in
    Object.values(rooms).forEach(room => {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        emitRoomUpdate(room.id);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
