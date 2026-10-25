require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("../models/user.model");

async function seedAdmin() {
  const { MONGO_URI, SEED_ADMIN_USERNAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = process.env;
  const missing = [
    ["MONGO_URI", MONGO_URI],
    ["SEED_ADMIN_USERNAME", SEED_ADMIN_USERNAME],
    ["SEED_ADMIN_EMAIL", SEED_ADMIN_EMAIL],
    ["SEED_ADMIN_PASSWORD", SEED_ADMIN_PASSWORD]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (SEED_ADMIN_PASSWORD.length < 12 || !/[A-Z]/.test(SEED_ADMIN_PASSWORD)
    || !/[a-z]/.test(SEED_ADMIN_PASSWORD) || !/[0-9]/.test(SEED_ADMIN_PASSWORD)) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters and include upper/lowercase letters and a number");
  }

  await mongoose.connect(MONGO_URI);
  if (await User.exists({ role: "admin" })) {
    throw new Error("An administrator already exists; refusing to seed or overwrite an admin account");
  }

  const email = SEED_ADMIN_EMAIL.toLowerCase().trim();
  const username = SEED_ADMIN_USERNAME.trim();
  if (await User.exists({ $or: [{ email }, { username }] })) {
    throw new Error("The requested seed email or username is already in use");
  }

  await User.create({
    username,
    email,
    password: await bcrypt.hash(SEED_ADMIN_PASSWORD, 12),
    role: "admin"
  });
  console.log(`Created initial TrustVault administrator: ${email}`);
}

seedAdmin()
  .catch((error) => {
    console.error(`Administrator seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
