const User = require("../../models/User");
const Notification = require("../../models/Notification");

function mockNotificationWrites(mock) {
  mock.method(User, "find", (filter) => ({
    select() { return this; },
    async lean() { return filter._id.$in.map((_id) => ({ _id })); },
  }));
  mock.method(Notification, "init", async () => {});
  return mock.method(Notification, "findOneAndUpdate", async (_filter, update) => ({
    lastErrorObject: { updatedExisting: false }, value: new Notification(update.$setOnInsert),
  }));
}

module.exports = { mockNotificationWrites };
