const jwt = require("jsonwebtoken");
const fs = require("fs/promises");
const path = require("path");
const User = require("../models/User");
const logAction = require("../utils/audit");

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || "dev_secret", { expiresIn: "7d" });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email,
    role: user.role,
    studentNumber: user.studentNumber || "",
    isActive: user.isActive,
    profileImage: user.profileImage || "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function removeProfilePhoto(profileImage) {
  if (!profileImage || !profileImage.startsWith("/uploads/profile-photos/")) return;
  const fileName = path.basename(profileImage);
  await fs.unlink(path.join(__dirname, "../uploads/profile-photos", fileName)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function register(req, res) {
  const { password, confirmPassword, role, subject, studentNumber } = req.body;
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const firstName = typeof req.body.firstName === "string" ? req.body.firstName.trim() : "";
  const lastName = typeof req.body.lastName === "string" ? req.body.lastName.trim() : "";
  if (!firstName || !lastName) return res.status(400).json({ message: "First name and last name are required." });
  if (!email) return res.status(400).json({ message: "Email address is required." });
  if (typeof password !== "string" || !password.trim()) return res.status(400).json({ message: "Password is required." });
  if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
  if (typeof confirmPassword !== "string" || !confirmPassword.trim()) return res.status(400).json({ message: "Confirm Password is required." });
  if (password !== confirmPassword) return res.status(400).json({ message: "Passwords do not match." });
  if (typeof role !== "string" || !role.trim()) return res.status(400).json({ message: "Role is required." });
  if (!["teacher", "student"].includes(role)) return res.status(400).json({ message: "Only teacher and student registration is allowed" });
  if (role === "student" && !String(studentNumber || "").trim()) {
    return res.status(400).json({ message: "Student Number is required for student accounts" });
  }
  if (req.body.agreementAccepted !== true) {
    return res.status(400).json({ message: "Please agree to the Terms and Conditions and Privacy Policy to continue." });
  }

  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: "This email address is already registered." });

  try {
    const user = await User.create({ firstName, lastName, email, password, role, subject, studentNumber: role === "student" ? String(studentNumber).trim() : "", agreementAcceptedAt: new Date() });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: "This email address is already registered." });
    throw error;
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.matchPassword(password))) return res.status(401).json({ message: "Invalid credentials" });
  if (!user.isActive) return res.status(403).json({ message: "Account disabled" });

  user.lastLoginAt = new Date();
  await user.save();
  req.user = user;
  await logAction(req, "login", "auth", `${user.email} logged in`);
  res.json({ token: signToken(user), user: publicUser(user) });
}

async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

async function updateProfileImage(req, res) {
  if (!req.file) return res.status(400).json({ message: "Select a JPG, PNG, or WEBP image to upload." });

  const previousImage = req.user.profileImage;
  req.user.profileImage = `/uploads/profile-photos/${req.file.filename}`;
  await req.user.save();
  await removeProfilePhoto(previousImage);
  await logAction(req, "update_profile_image", "auth", `${req.user.email} updated profile image`);
  res.json({ user: publicUser(req.user) });
}

async function removeProfileImage(req, res) {
  const previousImage = req.user.profileImage;
  req.user.profileImage = "";
  await req.user.save();
  await removeProfilePhoto(previousImage);
  await logAction(req, "remove_profile_image", "auth", `${req.user.email} removed profile image`);
  res.json({ user: publicUser(req.user) });
}

function normalizeProfile(body) {
  return {
    firstName: typeof body.firstName === "string" ? body.firstName.trim() : "",
    lastName: typeof body.lastName === "string" ? body.lastName.trim() : "",
    email: String(body.email || "").trim().toLowerCase(),
  };
}

async function updateProfile(req, res) {
  const profile = normalizeProfile(req.body);
  if (!profile.firstName || !profile.lastName || !profile.email) return res.status(400).json({ message: "First name, last name, and email address are required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) return res.status(400).json({ message: "Enter a valid email address." });

  const emailOwner = await User.findOne({ email: profile.email, _id: { $ne: req.user._id } });
  if (emailOwner) return res.status(400).json({ message: "Email already registered." });

  req.user.firstName = profile.firstName;
  req.user.lastName = profile.lastName;
  req.user.email = profile.email;
  await req.user.save();
  await logAction(req, "update_profile", "auth", `${req.user.email} updated profile details`);
  res.json({ user: publicUser(req.user) });
}

async function changePassword(req, res) {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (!currentPassword || !newPassword) return res.status(400).json({ message: "Current and new passwords are required." });
  if (newPassword.length < 8) return res.status(400).json({ message: "New password must be at least 8 characters." });

  const user = await User.findById(req.user._id).select("+password");
  if (!user || !(await user.matchPassword(currentPassword))) return res.status(400).json({ message: "Current password is incorrect." });
  if (await user.matchPassword(newPassword)) return res.status(400).json({ message: "New password must be different from the current password." });

  user.password = newPassword;
  await user.save();
  await logAction(req, "change_password", "auth", `${user.email} changed password`);
  res.json({ message: "Password changed successfully." });
}

module.exports = { register, login, me, updateProfile, changePassword, updateProfileImage, removeProfileImage };
