const PQueue = require("p-queue").default;

module.exports = new PQueue({
  concurrency: 1,
  interval: 60000,
  intervalCap: 20,
});
