const express = require("express");
const { register, login, me, updateProfile, changePassword, updateProfileImage, removeProfileImage } = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const profileImageUpload = require("../middleware/profileImageUpload");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, me);
router.put("/profile", protect, updateProfile);
router.put("/password", protect, changePassword);
router.put("/profile-image", protect, profileImageUpload.single("profileImage"), updateProfileImage);
router.delete("/profile-image", protect, removeProfileImage);
router.post("/logout", protect, (req, res) => res.json({ message: "Logged out" }));

module.exports = router;
