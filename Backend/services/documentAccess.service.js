function visibleDocumentsQuery(userId) {
  return {
    $or: [
      { userId },
      { permissions: { $elemMatch: { userId, access: { $in: ["read", "edit"] }, revokedAt: null } } }
    ]
  };
}

function sharedDocumentsQuery(userId) {
  return {
    permissions: { $elemMatch: { userId, access: { $in: ["read", "edit"] }, revokedAt: null } }
  };
}

module.exports = { visibleDocumentsQuery, sharedDocumentsQuery, sharedWithMeQuery: sharedDocumentsQuery };
