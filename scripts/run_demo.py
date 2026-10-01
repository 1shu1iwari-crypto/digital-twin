"""Prepare missing model artifacts, then serve the built dashboard and API."""
import argparse
from cardiotwin.config import ARTIFACTS, ROOT
from cardiotwin.model import train

def main():
    parser=argparse.ArgumentParser(description="Run CardioTwin-HF locally")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--retrain", action="store_true")
    args=parser.parse_args()
    required=["risk_model.json", "metadata.json", "evaluation.json"]
    if args.retrain or not all((ARTIFACTS/name).exists() for name in required):
        train()
    if not (ROOT/"frontend/dist/index.html").exists():
        print("Dashboard is not built. Run `cd frontend && npm ci && npm run build`.")
        print("API and interactive API documentation will still be available.")
    import uvicorn
    print(f"CardioTwin-HF: http://{args.host}:{args.port}", flush=True)
    uvicorn.run("cardiotwin.api:app",host=args.host,port=args.port)

if __name__=="__main__":
    main()
