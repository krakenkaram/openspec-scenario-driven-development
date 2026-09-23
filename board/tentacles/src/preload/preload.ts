import { contextBridge, ipcRenderer } from "electron";
import type { ChannelMap, ElectronAPI, EventChannelMap } from "../shared/ipc-contract";

// Exactly sixteen named channels — no generic command passthrough. A sandboxed
// preload cannot import wiring.ts at runtime, so the channel strings are
// declared here; typing the map as the shared ChannelMap asserts each method is
// bound to its exact channel (a typo, missing key, or swap fails to compile).
const CHANNELS: ChannelMap = {
  getStatus: "board:getStatus",
  readFile: "board:readFile",
  getDiff: "board:getDiff",
  getFileDiff: "board:getFileDiff",
  archive: "board:archive",
  getSettings: "board:getSettings",
  setSettings: "board:setSettings",
  chooseDirectory: "board:chooseDirectory",
  openPath: "board:openPath",
  openFile: "board:openFile",
  install: "board:install",
  doctor: "board:doctor",
  listSchemas: "board:listSchemas",
  installSchema: "board:installSchema",
  uninstallSchema: "board:uninstallSchema",
  openSchemaFile: "board:openSchemaFile",
};

// Main → renderer push channels, typed against the shared EventChannelMap for
// the same compile-time agreement as the invoke channels above.
const EVENTS: EventChannelMap = {
  notificationSound: "board:notificationSound",
};

const api: ElectronAPI = {
  getStatus: () => ipcRenderer.invoke(CHANNELS.getStatus),
  readFile: (filePath) => ipcRenderer.invoke(CHANNELS.readFile, filePath),
  getDiff: (repoPath) => ipcRenderer.invoke(CHANNELS.getDiff, repoPath),
  getFileDiff: (repoPath, filePath) => ipcRenderer.invoke(CHANNELS.getFileDiff, repoPath, filePath),
  archive: (payload) => ipcRenderer.invoke(CHANNELS.archive, payload),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  setSettings: (payload) => ipcRenderer.invoke(CHANNELS.setSettings, payload),
  chooseDirectory: () => ipcRenderer.invoke(CHANNELS.chooseDirectory),
  openPath: (target) => ipcRenderer.invoke(CHANNELS.openPath, target),
  openFile: (repoPath, filePath) => ipcRenderer.invoke(CHANNELS.openFile, repoPath, filePath),
  onNotificationSound: (handler) => {
    const listener = () => handler();
    ipcRenderer.on(EVENTS.notificationSound, listener);
    return () => ipcRenderer.removeListener(EVENTS.notificationSound, listener);
  },
  install: (payload) => ipcRenderer.invoke(CHANNELS.install, payload),
  doctor: (payload) => ipcRenderer.invoke(CHANNELS.doctor, payload),
  listSchemas: () => ipcRenderer.invoke(CHANNELS.listSchemas),
  installSchema: (name) => ipcRenderer.invoke(CHANNELS.installSchema, name),
  uninstallSchema: (name) => ipcRenderer.invoke(CHANNELS.uninstallSchema, name),
  openSchemaFile: (name, repoPath) => ipcRenderer.invoke(CHANNELS.openSchemaFile, name, repoPath),
};

contextBridge.exposeInMainWorld("electronAPI", api);
