const AuditLog = require("../models/AuditLog");

async function logAction(req, action, module, details = "") {
  try {
    await AuditLog.create({
      actor: req.user?._id,
      action,
      module,
      details,
      ipAddress: req.ip
    });
  } catch (error) {
    console.warn("Audit log failed:", error.message);
  }
}

module.exports = logAction;
