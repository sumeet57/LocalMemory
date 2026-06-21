import User from "../models/user.model.js";
import { comparePassword, hashPassword } from "../utils/auth/password.utils.js";

import { generateSessionId } from "../utils/auth/session.utils.js";

const MAX_SESSIONS = 5;

export async function createSessionForUser(userId) {
  const sessionIds = generateSessionId();
  const hashedId = sessionIds.hashed;
  const rawId = sessionIds.raw;

  const user = await User.findById(userId);

  user.sessions.push({ sessionIdHash: hashedId });
  if (user.sessions.length > MAX_SESSIONS) {
    user.sessions.shift();
  }

  await user.save();

  return rawId;
}

export const register = async (data) => {
  try {
    const hashedPassword = await hashPassword(data.password);
    const user = await User.create({
      fullName: data.fullName,
      email: data.email,
      password: hashedPassword,
    });
    await user.save();

    return user._id;
  } catch (error) {
    throw new Error(error.message);
  }
};

export const login = async (data) => {
  try {
    const user = await User.findOne({ email: data.email }).select("+password");
    if (!user) {
      throw new Error("User is not registered");
    } else {
      const comparedPassword = await comparePassword(
        data.password,
        user.password
      );
      if (!comparedPassword) {
        throw new Error("Invalid email or password");
      } else {
        return user._id;
      }
    }
  } catch (error) {
    throw new Error(error.message);
  }
};
