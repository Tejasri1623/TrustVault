jest.mock("dotenv", () => ({
  config: jest.fn()
}));

jest.mock("mongoose", () => ({
  connection: {
    readyState: 0,
    on: jest.fn()
  },
  connect: jest.fn()
}));

jest.mock("../../config/logger", () => ({
  createChildLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  })
}));

describe("MongoDB connection lifecycle", () => {
  const originalMongoUri = process.env.MONGO_URI;

  beforeEach(() => {
    jest.resetModules();
    process.env.MONGO_URI = "mongodb://example.test/trustvault";
    const mongoose = require("mongoose");
    mongoose.connection.readyState = 0;
    mongoose.connection.on.mockReset();
    mongoose.connect.mockReset();
  });

  afterEach(() => {
    if (originalMongoUri === undefined) {
      delete process.env.MONGO_URI;
    } else {
      process.env.MONGO_URI = originalMongoUri;
    }
  });

  test("returns a resolved promise when MongoDB is already connected", async () => {
    const mongoose = require("mongoose");
    const connectDB = require("../../config/db");
    mongoose.connection.readyState = 1;

    await expect(connectDB()).resolves.toBeUndefined();
    expect(mongoose.connect).not.toHaveBeenCalled();
  });

  test("deduplicates concurrent connection attempts", async () => {
    const mongoose = require("mongoose");
    const connectDB = require("../../config/db");
    let resolveConnect;
    mongoose.connect.mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      })
    );

    const first = connectDB();
    const second = connectDB();

    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    resolveConnect();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  test("rejects and resets state when MONGO_URI is missing", async () => {
    delete process.env.MONGO_URI;
    const mongoose = require("mongoose");
    const connectDB = require("../../config/db");

    await expect(connectDB()).rejects.toThrow("MONGO_URI is not configured");
    expect(mongoose.connect).not.toHaveBeenCalled();
  });

  test("allows retry after a failed connection attempt", async () => {
    const mongoose = require("mongoose");
    const connectDB = require("../../config/db");

    mongoose.connect.mockReturnValueOnce(Promise.reject(new Error("connection failed")));
    await expect(connectDB()).rejects.toThrow("connection failed");

    mongoose.connect.mockReturnValueOnce(Promise.resolve());
    await expect(connectDB()).resolves.toBeUndefined();
    expect(mongoose.connect).toHaveBeenCalledTimes(2);
  });

  test("resets cached state when the driver reports disconnection", async () => {
    const mongoose = require("mongoose");
    const connectDB = require("../../config/db");

    mongoose.connect.mockReturnValue(Promise.resolve());
    await connectDB();
    expect(mongoose.connect).toHaveBeenCalledTimes(1);

    const disconnectedHandler = mongoose.connection.on.mock.calls.find(
      ([event]) => event === "disconnected"
    )[1];
    disconnectedHandler();

    mongoose.connect.mockReturnValue(Promise.resolve());
    await connectDB();
    expect(mongoose.connect).toHaveBeenCalledTimes(2);
  });
});
