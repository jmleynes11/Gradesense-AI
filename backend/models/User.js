const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

function requiresNameParts() {
  // Existing accounts may still have only a full name until their name is edited.
  return this.isNew || this.firstName !== undefined || this.lastName !== undefined;
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    firstName: { type: String, trim: true, required: requiresNameParts },
    lastName: { type: String, trim: true, required: requiresNameParts },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "teacher", "student"], default: "student" },
    subject: String,
    studentNumber: { type: String, trim: true, default: "" },
    profileImage: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    agreementAcceptedAt: Date,
    lastLoginAt: Date
  },
  { timestamps: true }
);

userSchema.pre("validate", function syncName() {
  if (this.isModified("firstName") || this.isModified("lastName")) {
    this.name = [this.firstName, this.lastName].filter(Boolean).join(" ");
  } else if (this.isModified("name") && this.firstName !== undefined && this.name !== `${this.firstName} ${this.lastName}`) {
    // Keep older full-name editing endpoints consistent with the separate fields.
    const [firstName, ...lastName] = String(this.name || "").trim().split(/\s+/);
    this.firstName = firstName;
    this.lastName = lastName.join(" ");
  }
});

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = function matchPassword(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);
