import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANNELS,
  type AppSnapshot,
  type Command,
  type RendererApi,
  type ToastAction,
  type ToastPayload
} from '../shared/ipc'

const api: RendererApi = {
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.snapshot),
  command: (cmd: Command) => ipcRenderer.invoke(CHANNELS.command, cmd),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(CHANNELS.state, handler)
    return () => ipcRenderer.removeListener(CHANNELS.state, handler)
  },
  getToast: () => ipcRenderer.invoke(CHANNELS.toastGet),
  onToast: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ToastPayload | null): void =>
      listener(payload)
    ipcRenderer.on(CHANNELS.toastShow, handler)
    return () => ipcRenderer.removeListener(CHANNELS.toastShow, handler)
  },
  toastAction: (action: ToastAction) => ipcRenderer.send(CHANNELS.toastAction, action)
}

contextBridge.exposeInMainWorld('api', api)
