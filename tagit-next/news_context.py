"""Point-in-time news join. Unknown coverage is never treated as no catalyst."""
from engine import timestamp


def prior_news(symbol, signal_at, records, coverage_complete=False):
    at=timestamp(signal_at)
    eligible=[]
    for r in records:
        if symbol not in r.get('symbols',[]): continue
        # Must preserve the version actually observed, not a later edited article.
        required=('published_at','first_seen_at','version_at','id')
        if any(not r.get(k) for k in required): continue
        if any(timestamp(r[k])>at for k in required[:-1]): continue
        eligible.append(r)
    return dict(status='PRIOR_NEWS_AVAILABLE' if eligible else 'NO_PRIOR_NEWS_IN_COMPLETE_FEED' if coverage_complete else 'UNKNOWN_COVERAGE',
                records=sorted(eligible,key=lambda r:timestamp(r['first_seen_at'])),
                coverage_complete=coverage_complete)
