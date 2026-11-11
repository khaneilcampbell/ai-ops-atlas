import base from "./playwright.config";
export default { ...base, use: { ...base.use, deviceScaleFactor: 1, launchOptions: { ...base.use!.launchOptions, executablePath: "/opt/pw-browsers/chromium" } } };
