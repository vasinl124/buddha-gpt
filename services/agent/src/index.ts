import "./env.ts"; // first, so app.ts sees the .env values
import { app } from "./app.ts";

const PORT = 7891;
app.listen(PORT, () => console.log(`agent listening on :${PORT}`));
