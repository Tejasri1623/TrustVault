const CORE_ROLES = Object.freeze(["admin", "owner", "editor", "viewer"]);
const PUBLIC_REGISTRATION_ROLES = Object.freeze(["owner", "editor", "viewer"]);

const LEGACY_ROLE_ALIASES = Object.freeze({
  user: "viewer",
  editor: "editor",
  financeManager: "viewer",
  hrManager: "viewer",
  auditManager: "viewer",
  generalManager: "viewer",
  GM: "viewer"
});

function normalizeSystemRole(role) {
  if (CORE_ROLES.includes(role)) return role;
  return LEGACY_ROLE_ALIASES[role] || "viewer";
}

module.exports = {
  CORE_ROLES,
  PUBLIC_REGISTRATION_ROLES,
  LEGACY_ROLE_ALIASES,
  normalizeSystemRole
};
