"""Replay the frozen pre-signal quote-liquidity validation sample."""
import json
from pathlib import Path

from presignal_liquidity import run


if __name__ == '__main__':
    root=Path(__file__).resolve().parent/'data'
    report=run(
        json.loads((root/'presignal-liquidity-validation-protocol.json').read_text()),
        json.loads((root/'presignal-liquidity-validation-quotes.json').read_text()),
    )
    (root/'presignal-liquidity-validation-report.json').write_text(
        json.dumps(report,indent=2)+'\n'
    )
    print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
