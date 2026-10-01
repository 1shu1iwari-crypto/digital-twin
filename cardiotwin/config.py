from pathlib import Path
import os
import yaml

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("CARDIOTWIN_ARTIFACTS", ROOT / "artifacts"))

def load_config():
    with (ROOT / "config/simulation.yaml").open() as f:
        return yaml.safe_load(f)
