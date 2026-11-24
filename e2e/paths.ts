import path from "node:path";

/** Saved anonymous session shared by every test of one suite run. */
export const AUTH_FILE = path.join(__dirname, "..", "playwright", ".auth", "user.json");
