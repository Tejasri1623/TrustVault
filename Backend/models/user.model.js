const mongoose = require("mongoose");
const { CORE_ROLES, LEGACY_ROLE_ALIASES } = require("../services/rolePolicy.service");

const legacyRoles = ["user", ...Object.keys(LEGACY_ROLE_ALIASES).filter((role) => role !== "user")];

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 5
    },
    password: {
      type: String,
      required: true,
      minlength: 6
    },
    role: {
      type: String,
      default: "viewer",
      validate: {
        validator(value) {
          // Keep legacy database records saveable without allowing new legacy-role accounts.
          return CORE_ROLES.includes(value)
            || (!this.isNew && !this.isModified("role") && legacyRoles.includes(value));
        },
        message: "Role must be one of the supported TrustVault roles"
      }
    },
    tokenVersion: { type: Number, default: 0, min: 0 },
    resetPasswordToken: String,
    resetPasswordExpires: Date
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
