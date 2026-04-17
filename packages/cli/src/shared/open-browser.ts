// ---------------------------------------------------------------------------
// Best-effort browser opener.
//
//  - darwin  : spawn `open <url>`
//  - win32   : spawn `cmd /c start "" <url>`
//  - linux   : spawn `xdg-open <url>` if a display server is present
//              (DISPLAY / WAYLAND_DISPLAY); otherwise return false so the
//              caller can print the URL + QR instead.
//
// Spawn + platform + env are injectable so tests can simulate headless SSH
// without relying on the current runtime environment.
// ---------------------------------------------------------------------------

import { spawn as realSpawn } from "node:child_process";

type SpawnFn = typeof realSpawn;

export interface OpenBrowserOptions {
  readonly spawn?: SpawnFn;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}

export async function openBrowser(
  url: string,
  opts: OpenBrowserOptions = {},
): Promise<boolean> {
  const spawn = opts.spawn ?? realSpawn;
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  try {
    if (platform === "darwin") {
      const child = spawn("open", [url], { stdio: "ignore", detached: true });
      child.unref?.();
      return true;
    }
    if (platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
      });
      child.unref?.();
      return true;
    }
    if (platform === "linux") {
      if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
      const child = spawn("xdg-open", [url], {
        stdio: "ignore",
        detached: true,
      });
      child.unref?.();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
