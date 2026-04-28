import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('reelmagic', {
  ping: () => 'pong',
});
