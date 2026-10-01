"""Export fictional inputs and outcomes separately for offline exploration."""
import argparse
from pathlib import Path
from cardiotwin.simulation import generate_cohort

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--patients",type=int,default=800)
    parser.add_argument("--output",type=Path,default=Path("data/synthetic"))
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    for name,frame in zip(["patients","observations","outcomes"],generate_cohort(n=args.patients)):
        frame.to_csv(args.output/f"{name}.csv",index=False)
    print(f"Wrote fully synthetic data to {args.output}")
