require('dotenv').config();
// OpsFly Backend Server Application - Tweak to trigger redeployment
const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');

const notesRouter = require('./routes/notes');
const organizationsRouter = require('./routes/organizations');
const locationsRouter = require('./routes/locations');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const tasksRouter = require('./routes/tasks');
const testPushRouter = require('./routes/testPush');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow any vercel or localhost origin
  if (origin && (origin.includes('vercel.app') || origin.includes('localhost'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Fallback for direct browser hits or other tools
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-location-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(morgan('dev'));
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/notes', notesRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/test-push', testPushRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'OpsFly API' }));

// ─── Database & Startup ────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    // Start listening FIRST (Crucial for Railway/Render health checks)
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 OpsFly server running on port ${PORT}`);
    });

    // Then connect to DB
    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI is missing in environment variables!');
    } else {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ MongoDB connected');
    }
  } catch (err) {
    console.error('❌ Startup error:', err.message);
    // Don't exit immediately, let the server stay alive for logs
  }
};

startServer();
