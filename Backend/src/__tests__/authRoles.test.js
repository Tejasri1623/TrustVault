jest.mock("../../models/user.model", () => {
  const mockSave = jest.fn().mockResolvedValue(undefined);
  const User = jest.fn(function createUser(fields) {
    Object.assign(this, fields);
    this.save = mockSave;
  });
  User.findOne = jest.fn();
  User.findById = jest.fn();
  User.updateOne = jest.fn();
  User.mockSave = mockSave;
  return User;
});

jest.mock("../../models/activity.model", () => ({
  create: jest.fn().mockResolvedValue({})
}));

const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../../models/user.model");
const userRoutes = require("../../routes/user.routes");
const auth = require("../../middlewares/auth.middleware");

const testUserId = "64b000000000000000000009";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/", userRoutes);
  app.get("/protected", auth, (req, res) => res.json({ role: req.userRole }));
  return app;
}

describe("public registration and role-aware authentication", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-with-sufficient-entropy";
    jest.clearAllMocks();
    User.findOne.mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  test("rejects public administrator assignment before database writes", async () => {
    const response = await request(createApp()).post("/register").send({
      username: "Public User",
      email: "public@example.com",
      password: "SecurePass123",
      "confirm-password": "SecurePass123",
      role: "admin"
    });

    expect(response.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.mockSave).not.toHaveBeenCalled();
  });

  test.each(["owner", "editor", "viewer"])("registers a public %s with the requested allowed role", async (role) => {
    const response = await request(createApp()).post("/register").set("Accept", "application/json").send({
      username: "Public User",
      email: "public@example.com",
      password: "SecurePass123",
      "confirm-password": "SecurePass123",
      role
    });

    expect(response.status).toBe(200);
    expect(User.mock.instances[0].role).toBe(role);
    expect(User.mock.instances[0].password).not.toBe("SecurePass123");
  });

  test("rejects duplicate email registration", async () => {
    User.findOne.mockResolvedValueOnce({ _id: testUserId });

    const response = await request(createApp()).post("/register").send({
      username: "Duplicate User",
      email: "used@example.com",
      password: "SecurePass123",
      "confirm-password": "SecurePass123",
      role: "viewer"
    });

    expect(response.status).toBe(400);
    expect(User.mockSave).not.toHaveBeenCalled();
  });

  test("rejects invalid names, email addresses, and mismatched passwords", async () => {
    const response = await request(createApp()).post("/register").send({
      username: "x",
      email: "not-an-email",
      password: "SecurePass123",
      "confirm-password": "DifferentPass123",
      role: "viewer"
    });

    expect(response.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.mockSave).not.toHaveBeenCalled();
  });

  test("uses the stored database role rather than a role submitted at login", async () => {
    const account = {
      _id: { toString: () => testUserId },
      username: "Trusted Admin",
      email: "admin@example.com",
      password: "stored-hash",
      role: "admin",
      tokenVersion: 0
    };
    User.findOne.mockResolvedValue(account);
    jest.spyOn(bcrypt, "compare").mockResolvedValue(true);

    const response = await request(createApp()).post("/login").set("Accept", "application/json").send({
      email: " ADMIN@example.com ",
      password: "valid-password",
      role: "viewer"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ role: "admin", redirect: "/admin/dashboard" });
    expect(User.findOne).toHaveBeenCalledWith({ email: "admin@example.com" });
    bcrypt.compare.mockRestore();
  });

  test("authentication ignores a forged role claim and reloads the database role", async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: { toString: () => testUserId },
        role: "viewer",
        tokenVersion: 0,
        toObject: () => ({ _id: testUserId, role: "viewer", tokenVersion: 0 })
      })
    });
    const token = jwt.sign({ userId: testUserId, role: "admin", tokenVersion: 0 }, process.env.JWT_SECRET);

    const response = await request(createApp()).get("/protected").set("Cookie", `token=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("viewer");
  });

  test("rejects a token after its stored token version has been revoked", async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: { toString: () => testUserId },
        role: "viewer",
        tokenVersion: 1,
        toObject: () => ({ _id: testUserId, role: "viewer", tokenVersion: 1 })
      })
    });
    const token = jwt.sign({ userId: testUserId, role: "admin", tokenVersion: 0 }, process.env.JWT_SECRET);

    const response = await request(createApp()).get("/protected").set("Cookie", `token=${token}`);

    expect(response.status).toBe(401);
  });

  test("logout invalidates the JWT token version and clears the cookie", async () => {
    User.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const token = jwt.sign({ userId: testUserId, tokenVersion: 0 }, process.env.JWT_SECRET);

    const response = await request(createApp()).post("/logout")
      .set("Accept", "application/json")
      .set("Cookie", `token=${token}`);

    expect(response.status).toBe(200);
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: testUserId, $or: [{ tokenVersion: 0 }, { tokenVersion: { $exists: false } }] },
      { $inc: { tokenVersion: 1 } }
    );
    expect(response.headers["set-cookie"][0]).toContain("token=");
    expect(response.headers["set-cookie"][0]).toContain("Expires=");
  });
});
