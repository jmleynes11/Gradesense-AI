const rateLimit = require("express-rate-limit");

module.exports = rateLimit({
  windowMs: 60 * 1000,
  max: 5,

  message: {
    message: "Too many quiz generations. Please wait a minute.",
  },
});
