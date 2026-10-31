require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Class = require("../models/Class");
const Subject = require("../models/Subject");
const Assessment = require("../models/Assessment");
const QuizGame = require("../models/QuizGame");

async function run() {
  await connectDB();
  const classes = await Class.find();
  for (const legacy of classes) {
    const subject = await Subject.findOneAndUpdate(
      { teacher: legacy.teacher, name: legacy.subject },
      { $setOnInsert: { code: `LEGACY-${String(legacy._id).slice(-6)}` }, $addToSet: { students: { $each: legacy.students || [] } } },
      { new: true, upsert: true },
    );
    await Assessment.updateMany({ class: legacy._id, $or: [{ subjectRef: { $exists: false } }, { subjectRef: null }] }, { $set: { subjectRef: subject._id, subject: subject.name } });
    await QuizGame.updateMany({ class: legacy._id, $or: [{ subjectRef: { $exists: false } }, { subjectRef: null }] }, { $set: { subjectRef: subject._id, subject: subject.name } });
  }
  console.log(`Migrated ${classes.length} legacy class records into subjects.`);
  await mongoose.disconnect();
}
run().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exit(1); });
