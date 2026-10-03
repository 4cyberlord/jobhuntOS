import { useEffect } from "react";
import { checkForUpdate, installUpdate, useUpdate } from "../lib/updater";

/** Looks for a new version shortly after launch and every few hours, and offers it. */
export function UpdateBanner() {
  const u = useUpdate();
  useEffect(() => {
    const first = setTimeout(() => void checkForUpdate(true), 8_000);
    const every = setInterval(() => void checkForUpdate(true), 6 * 3_600_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  if (u.phase !== "available" && u.phase !== "downloading" && u.phase !== "ready") return null;
  return (
    <div className="update-banner" role="status">
      <span className="ub-dot" />
      {u.phase === "available" && <><span>Version <b>{u.version}</b> is available.</span><button className="btn primary sm" onClick={() => void installUpdate()}>Get update</button></>}
      {u.phase === "downloading" && <><span>Downloading update… {u.progress ?? 0}%</span><span className="ub-track"><i style={{ width: `${u.progress ?? 0}%` }} /></span></>}
      {u.phase === "ready" && <span>Update installed. Restarting…</span>}
    </div>
  );
}
