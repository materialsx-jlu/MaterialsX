process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
const { app, BrowserWindow } = require("electron");

if (!process.argv.includes("--m0-smoke")) {
  throw new Error("This entrypoint is only for the M0 Electron lifecycle smoke test.");
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent("<!doctype html><meta charset=utf-8><title>MaterialsX M0</title>"),
  );

  const state = {
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    contextIsolation: window.webContents.getLastWebPreferences().contextIsolation,
    nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration,
    sandbox: window.webContents.getLastWebPreferences().sandbox,
  };

  process.stdout.write(`${JSON.stringify(state)}\n`);
  window.destroy();
  app.quit();
});

app.on("window-all-closed", () => app.quit());
