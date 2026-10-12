import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type AppSnapshot, type Command, type RendererApi } from '../shared/ipc'

const api: RendererApi = {
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.snapshot),
  command: (cmd: Command) => ipcRenderer.invoke(CHANNELS.command, cmd),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(CHANNELS.state, handler)
    return () => ipcRenderer.removeListener(CHANNELS.state, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
