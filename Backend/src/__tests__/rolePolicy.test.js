const mongoose = require("mongoose");
const User = require("../../models/user.model");
const { CORE_ROLES, normalizeSystemRole } = require("../../services/rolePolicy.service");

describe("core roles and legacy account compatibility", () => {
  test("exposes the core system roles including editor", () => {
    expect(CORE_ROLES).toEqual(["admin", "owner", "editor", "viewer"]);
  });

  test.each([
    ["user", "viewer"],
    ["financeManager", "viewer"],
    ["hrManager", "viewer"],
    ["auditManager", "viewer"],
    ["generalManager", "viewer"],
    ["GM", "viewer"],
    ["unknown-role", "viewer"]
  ])("normalizes legacy role %s to %s without granting admin access", (legacyRole, expected) => {
    expect(normalizeSystemRole(legacyRole)).toBe(expected);
  });

  test("rejects creating new accounts with legacy roles but permits saving unchanged legacy accounts", () => {
    const newLegacyUser = new User({
      username: "Legacy User",
      email: "legacy@example.com",
      password: "secure-hash",
      role: "financeManager"
    });
    expect(newLegacyUser.validateSync().errors.role).toBeDefined();

    const existingUser = User.hydrate({
      _id: new mongoose.Types.ObjectId(),
      username: "Legacy User",
      email: "legacy@example.com",
      password: "secure-hash",
      role: "financeManager"
    });
    existingUser.username = "Updated Legacy User";
    expect(existingUser.validateSync()).toBeUndefined();

    existingUser.role = "owner";
    expect(existingUser.validateSync()).toBeUndefined();
  });
});
