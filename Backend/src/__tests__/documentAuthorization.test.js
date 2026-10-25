jest.mock("../../models/document.model", () => ({
  findById: jest.fn()
}));

jest.mock("../../models/auditEvent.model", () => ({
  create: jest.fn().mockResolvedValue({})
}));

const express = require("express");
const request = require("supertest");
const Document = require("../../models/document.model");
const AuditEvent = require("../../models/auditEvent.model");
const { authorizeDocument, canAccessDocument } = require("../../middlewares/documentAuthorization.middleware");

const documentId = "64b000000000000000000001";
const ownerId = "64b000000000000000000002";
const viewerId = "64b000000000000000000003";

function createTestApp(getUserId = () => viewerId) {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: getUserId() };
    req.userRole = "viewer";
    next();
  });
  app.get("/api/documents/:id", authorizeDocument("read"), (req, res) => {
    res.json({ id: req.document._id });
  });
  return app;
}

describe("document authorization", () => {
  let document;

  beforeEach(() => {
    jest.clearAllMocks();
    document = {
      _id: documentId,
      userId: ownerId,
      fileName: "shared.pdf",
      permissions: [{ userId: viewerId, access: ["read"] }],
      approvalChain: []
    };
    Document.findById.mockImplementation(async () => document);
  });

  test("blocks another user's access when no current permission exists", async () => {
    document.permissions = [];
    const response = await request(createTestApp()).get(`/api/documents/${documentId}`);

    expect(response.status).toBe(404);
    expect(AuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      action: "document.read",
      outcome: "denied"
    }));
  });

  test("allows a named viewer to read but not edit", () => {
    expect(canAccessDocument(document, viewerId, "viewer", "read")).toBe(true);
    expect(canAccessDocument(document, viewerId, "viewer", "edit")).toBe(false);
  });

  test("uses the current database permission on each request after revocation", async () => {
    const app = createTestApp();
    const firstResponse = await request(app).get(`/api/documents/${documentId}`);
    expect(firstResponse.status).toBe(200);

    document.permissions[0].revokedAt = new Date();
    const afterRevocation = await request(app).get(`/api/documents/${documentId}`);

    expect(afterRevocation.status).toBe(404);
    expect(Document.findById).toHaveBeenCalledTimes(2);
  });

  test("allows owners, while neither admin role nor a viewer grants access by itself", () => {
    expect(canAccessDocument(document, ownerId, "viewer", "edit")).toBe(true);
    expect(canAccessDocument(document, "64b000000000000000000004", "admin", "delete")).toBe(false);
    expect(canAccessDocument(document, "64b000000000000000000004", "viewer", "read")).toBe(false);
  });

  test("denies a revoked grant even if its read/edit values remain stored", () => {
    document.permissions[0].revokedAt = new Date();
    expect(canAccessDocument(document, viewerId, "viewer", "read")).toBe(false);
    expect(canAccessDocument(document, viewerId, "viewer", "edit")).toBe(false);
  });

  test("does not allow approval actions after approval workflow removal", () => {
    document.currentApprover = viewerId;
    expect(canAccessDocument(document, viewerId, "viewer", "approve")).toBe(false);
    expect(canAccessDocument(document, ownerId, "admin", "approve")).toBe(false);
  });
});
