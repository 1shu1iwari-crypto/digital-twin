"""Run UI checks with an isolated demo DB and a server in the same environment."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from cardiotwin.config import ROOT

def find_browser_executable() -> str | None:
    if os.environ.get("CARDIOTWIN_BROWSER_EXECUTABLE"):
        return os.environ["CARDIOTWIN_BROWSER_EXECUTABLE"]
    candidates = [
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return None

def main():
    (ROOT / "test-results").mkdir(exist_ok=True)
    browser_exe = find_browser_executable()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        env = {
            **os.environ,
            "CARDIOTWIN_DB": str(Path(directory) / "browser.sqlite"),
        }
        if browser_exe:
            env["CARDIOTWIN_BROWSER_EXECUTABLE"] = browser_exe
        log_path = ROOT / "test-results/server.log"
        with log_path.open("w") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "cardiotwin.api:app", "--host", "127.0.0.1", "--port", "8011"],
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=log,
            )
            try:
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError(log_path.read_text())
                    try:
                        opener.open("http://127.0.0.1:8011/api/health", timeout=1)
                        break
                    except OSError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Demo server did not become ready")
                subprocess.run(["node", "scripts/smoke_browser.cjs"], cwd=ROOT, env=env, check=True, timeout=300)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()

if __name__=="__main__":
    main()
