const express = require('express');
const router = express.Router();
const multer = require('multer');
const User = require('../models/User');
const { getUserAccessibleLocationIds } = require('../middleware/scopeByLocation');
const { uploadFile, getSignedFileUrl, validateFileOwnership } = require('../services/storage');

const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
    req.user = await User.findById(decoded.userId || decoded.id);
    if (!req.user || req.user.isActive === false || req.user.deleted === true) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.use(mockAuth);

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mp4',
  'audio/m4a',
  'audio/webm',
  'application/pdf',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

function extensionFor(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/webm': 'webm',
    'application/pdf': 'pdf',
  };
  return map[mimeType] || 'bin';
}

// POST /api/upload
router.post('/', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'file is required' });
      }

      const { folder = 'notes', locationId } = req.body;

      // Validate the user actually has access to the location, if provided.
      if (locationId) {
        const accessibleIds = await getUserAccessibleLocationIds(req.user);
        if (!accessibleIds.includes(locationId.toString())) {
          return res.status(403).json({ error: 'Forbidden. You do not have access to this location.' });
        }
      }

      // organizationId always comes from the auth token, never the request body.
      const { fileKey } = await uploadFile(
        req.user.organizationId,
        locationId || null,
        folder,
        req.file.buffer,
        req.file.mimetype,
        extensionFor(req.file.mimetype)
      );

      const signedUrl = await getSignedFileUrl(fileKey, 3600);

      return res.status(201).json({ fileKey, signedUrl });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to upload file', detail: error.message });
    }
  });
});

// GET /api/upload/signed-url/:fileKey
//
// fileKeys contain slashes (orgs/<id>/locations/<id>/<folder>/<uuid>.<ext>),
// so this uses a wildcard match rather than a single Express :param segment
// (which stops at the first "/") to keep the full key intact.
router.get('/signed-url/*', async (req, res) => {
  try {
    const fileKey = req.params[0];
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });

    if (!validateFileOwnership(fileKey, req.user.organizationId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const signedUrl = await getSignedFileUrl(fileKey, 3600);
    return res.json({ fileKey, signedUrl });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to generate signed URL', detail: error.message });
  }
});

module.exports = router;
