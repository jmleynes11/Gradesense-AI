// Read-only query audit: never builds indexes or modifies user records.
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const Assessment = require("../models/Assessment");
const User = require("../models/User");
const { assessmentListFields } = require("./queryOptions");

async function main() {
  const started = Date.now();
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const connectionMs = Date.now() - started;
  try {
    const teacher = await User.findOne({ role: "teacher" }).select("_id").lean().maxTimeMS(5000);
    if (!teacher) { console.log(JSON.stringify({ connectionMs, teacherAvailable: false })); return; }
    const filter = { teacher: teacher._id };
    const before = Date.now();
    const rows = await Assessment.find(filter).select(assessmentListFields).sort({ status: 1, updatedAt: -1, _id: -1 }).limit(20).lean().maxTimeMS(5000);
    const queryMs = Date.now() - before;
    const sizes = await Assessment.aggregate([{ $match: { _id: { $in: rows.map((row) => row._id) } } }, { $group: {
      _id: null, documents: { $sum: 1 }, storedBytes: { $sum: { $bsonSize: "$$ROOT" } },
    } }]).option({ maxTimeMS: 5000 });
    const explain = await Assessment.find(filter).select(assessmentListFields).sort({ status: 1, updatedAt: -1, _id: -1 }).limit(20).maxTimeMS(5000).explain("executionStats");
    const indexes = await Assessment.collection.indexes();
    console.log(JSON.stringify({ connectionMs, queryMs, returnedAssessments: rows.length,
      summaryResponseBytes: Buffer.byteLength(JSON.stringify(rows)), sampleStoredBytes: sizes[0]?.storedBytes || 0,
      documentsExamined: explain.executionStats?.totalDocsExamined, keysExamined: explain.executionStats?.totalKeysExamined,
      executionTimeMs: explain.executionStats?.executionTimeMillis,
      listIndexPresent: indexes.some((index) => index.key.teacher === 1 && index.key.status === 1 && index.key.updatedAt === -1),
    }, null, 2));
  } finally { await mongoose.disconnect(); }
}
main().catch(() => { console.error("Read-only database query audit could not connect or complete."); process.exitCode = 1; });
