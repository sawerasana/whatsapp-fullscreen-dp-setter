const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeWASocket,
  DisconnectReason
} = require('@whiskeysockets/baileys');

// ==================== Configuration ====================
const PORT = process.env.PORT || 3000;
const AUTH_BASE_DIR = './auth';   // base folder to store session credentials
if (!fs.existsSync(AUTH_BASE_DIR)) fs.mkdirSync(AUTH_BASE_DIR);

// Store active sessions: sessionId -> { sock, creds, keys }
const sessions = new Map();

// ==================== Express Setup ====================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer for image upload (memory storage, 10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }   // 10 MB
});

// ==================== Helper: Create a new WhatsApp socket ====================
async function createSocket(sessionId) {
  const authFolder = path.join(AUTH_BASE_DIR, sessionId);
  if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder);

  // Load or create auth state
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  // Fetch latest Baileys version for compatibility
  const { version } = await fetchLatestBaileysVersion();

  // Create socket
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,   // we don't use QR
    browser: ['Ubuntu', 'Chrome', '20.0.04']  // plausible user-agent
  });

  // Listen for connection updates to detect when user enters pairing code
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(`[${sessionId}] Connection opened (device linked)`);
      // Save credentials after handshake
      saveCreds();
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log(`[${sessionId}] Connection closed unexpectedly.`);
      } else {
        console.log(`[${sessionId}] Logged out successfully.`);
        // Cleanup auth folder
        fs.rmSync(authFolder, { recursive: true, force: true });
      }
      // Remove from sessions map
      sessions.delete(sessionId);
    }
  });

  // Save creds whenever they update
  sock.ev.on('creds.update', saveCreds);

  return sock;
}

// ==================== API Endpoints ====================

// 1. Generate pairing code
app.post('/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    // Basic validation
    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
      return res.status(400).json({ error: 'Invalid phone number. Enter digits only, with country code (no +).' });
    }

    // Generate a unique session ID
    const sessionId = uuidv4();

    // Create socket
    const sock = await createSocket(sessionId);

    // Wait a short time for the handshake to start (2 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Request pairing code (returns 8-digit string)
    const pairingCode = await sock.requestPairingCode(phoneNumber);
    console.log(`[${sessionId}] Pairing code: ${pairingCode}`);

    // Store session info
    sessions.set(sessionId, { sock });

    res.json({ sessionId, pairingCode });

  } catch (err) {
    console.error('Pairing error:', err);
    res.status(500).json({ error: 'Failed to generate pairing code. Please try again.' });
  }
});

// 2. Check connection status
app.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    return res.json({ connected: false, reason: 'session not found' });
  }

  // Check if socket user is available (implies connection opened)
  const connected = session.sock.user !== undefined;
  res.json({ connected });
});

// 3. Set DP and logout
app.post('/set-dp', upload.single('image'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded.' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(400).json({ error: 'Session not found. Please start again.' });
    }

    const sock = session.sock;

    // Ensure connection is still open
    if (!sock.user) {
      return res.status(400).json({ error: 'Not connected to WhatsApp. Did you enter the pairing code?' });
    }

    // Update profile picture with the uploaded image buffer
    // For own profile, jid is sock.user.id
    const jid = sock.user.id;
    const buffer = req.file.buffer;

    await sock.updateProfilePicture(jid, buffer);
    console.log(`[${sessionId}] Profile picture updated.`);

    // Immediately logout and clean up
    await sock.logout();
    console.log(`[${sessionId}] Socket logged out.`);

    // Remove session from map (cleanup also handled by connection.close listener)
    sessions.delete(sessionId);

    res.json({ success: true, message: 'Full-screen DP set successfully. You have been logged out.' });

  } catch (err) {
    console.error('DP setting error:', err);
    // Attempt to logout and cleanup on error
    try {
      const session = sessions.get(req.body.sessionId);
      if (session) {
        await session.sock.logout();
        sessions.delete(req.body.sessionId);
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
    res.status(500).json({ error: 'Failed to set DP. Please try again.' });
  }
});

// ==================== Start Server ====================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Place index.html, style.css, script.js in the "public" folder.');
});
