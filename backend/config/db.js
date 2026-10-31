// config/db.js
const mongoose = require("mongoose");

async function connectDB() {
  try {
    if (!process.env.MONGO_URI) {
      console.warn("MONGO_URI is missing. API will start, but database calls will fail.");
      return;
    }

    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected successfully.");
  } catch (error) {
    console.error("MongoDB connection failed:");
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = connectDB;
