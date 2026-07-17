import { createApp } from "./app.js";
import { readSettings } from "./settings.js";

const settings = readSettings();
createApp(settings).listen(settings.port, "0.0.0.0", () => {
  console.log(`CopilotKit Runtime listening on port ${settings.port}`);
});

