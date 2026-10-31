const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const profilePhotoDirectory = path.join(__dirname, "../uploads/profile-photos");
fs.mkdirSync(profilePhotoDirectory, { recursive: true });

const imageTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, profilePhotoDirectory);
  },
  filename(req, file, cb) {
    cb(null, `${crypto.randomUUID()}${imageTypes[file.mimetype]}`);
  }
});

function hasMatchingSignature(file) {
  const signature = file.buffer;
  if (!signature) return true;
  if (file.mimetype === "image/jpeg") return signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  if (file.mimetype === "image/png") return signature.length >= 8 && signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (file.mimetype === "image/webp") return signature.length >= 12 && signature.subarray(0, 4).toString() === "RIFF" && signature.subarray(8, 12).toString() === "WEBP";
  return false;
}

const profileImageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!imageTypes[file.mimetype]) return cb(new Error("Profile image must be a JPG, PNG, or WEBP file."));
    cb(null, true);
  }
});

// Disk storage does not expose file bytes to multer's fileFilter. Verify headers after upload.
const single = profileImageUpload.single("profileImage");
module.exports = {
  single(fieldName) {
    const uploadSingle = profileImageUpload.single(fieldName);
    return (req, res, next) => uploadSingle(req, res, async (error) => {
      if (error) return next(error);
      if (!req.file) return next();
      try {
        req.file.buffer = await fs.promises.readFile(req.file.path);
        if (!hasMatchingSignature(req.file)) {
          await fs.promises.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ message: "The uploaded file is not a valid image." });
        }
        delete req.file.buffer;
        next();
      } catch (readError) {
        next(readError);
      }
    });
  }
};
