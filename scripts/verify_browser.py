"""Run UI checks with an isolated demo DB and a server in the same environment."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from cardiotwin.config import ROOT

def main():
    (ROOT/"test-results").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        env={**os.environ,"CARDIOTWIN_DB":str(Path(directory)/"browser.sqlite")}
        log_path=ROOT/"test-results/server.log"
        with log_path.open("w") as log:
            process=subprocess.Popen([sys.executable,"-m","uvicorn","cardiotwin.api:app","--host","127.0.0.1","--port","8011"],cwd=ROOT,env=env,stdout=log,stderr=log)
            try:
                opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError(log_path.read_text())
                    try:
                        opener.open("http://127.0.0.1:8011/api/health",timeout=1)
                        break
                    except OSError:
                        time.sleep(.2)
                else:
                    raise RuntimeError("Demo server did not become ready")
                subprocess.run(["node","scripts/smoke_browser.cjs"],cwd=ROOT,env=env,check=True,timeout=120)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()

if __name__=="__main__":
    main()
