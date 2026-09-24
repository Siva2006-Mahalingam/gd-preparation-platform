const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { initialize } = require('./db');
const { initializeSocket } = require('./socket/handler');

// Routes
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const sessionRoutes = require('./routes/sessions');
const performanceRoutes = require('./routes/performance');
const contributionRoutes = require('./routes/contributions');

// ── App Setup ───────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for audio uploads
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ── API Routes ──────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/contributions', contributionRoutes);

// ── SPA Fallback ────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Initialize ──────────────────────────────────────────
(async () => {
  await initialize();
  initializeSocket(io);

  // ── Start Server ────────────────────────────────────────
  server.listen(config.PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   GD Preparation Platform                ║');
    console.log(`║   Running on http://localhost:${config.PORT}        ║`);
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
  });
})();

module.exports = { app, server, io };
