#!/usr/bin/env python3
"""TAGit stock analysis through the self-hosted AI Hub (no paid API).

Builds the same shortlist and `context` rows as the paid workflow
(.github/workflows/tagit-ai-stock-analysis.yml), then asks the hub for one
ticker per request (a CPU model is slow and long single requests die at
proxies) and merges the answers into tag/data/ai-stock-analysis.json.

Environment:
  AI_HUB_URL         base URL of the hub, e.g. https://ai.example.com
  AI_HUB_KEY         API key, sent as "Authorization: Bearer <key>" (never printed)
  GITHUB_EVENT_NAME  'workflow_dispatch' bypasses the freshness skip

Python 3 standard library only. Always exits 0 on hub problems: the output
file then carries an explicit status and no analyses. Nothing is fabricated.
"""
import argparse
import datetime
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

PROVIDER = 'SELF_HOSTED_OLLAMA'
SCHEMA_VERSION = 4
MAX_ROWS = 8
FRESH_SECONDS = 480
REQUEST_TIMEOUT_SECONDS = 240
BUDGET_SECONDS = 14 * 60
MIN_REQUEST_SECONDS = 15          # do not start a request with less budget left
MAX_CONSECUTIVE_FAILURES = 2      # stop hammering a hub that is clearly down
ENDPOINT = '/api/tagit/analyze'

CONTEXT_FIELDS = [
    'ticker', 'signalType', 'price', 'changePct', 'sessionVolume', 'relativeVolume',
    'floatM', 'accumulationScore', 'liquidityAccumulation', 'range15mPct',
    'volumeAcceleration5m', 'volumeAcceleration15m', 'turnover5mPctFloat',
    'turnover15mPctFloat', 'priceVelocity5mPct', 'priceVelocity15mPct',
    'earlyRegimeShiftScore', 'ignitionScore', 'technicalCoverage', 'technicalScore',
    'technicalBias', 'rsi14', 'macd', 'macdSignal', 'macdHist', 'ema9', 'ema20',
    'volume5mRatio', 'volumeTrend', 'buyVolumePct', 'fibTrend', 'fibSupport',
    'fibResistance',
]


def load(path):
    try:
        data = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def build_rows(live):
    """Shortlist exactly like the paid workflow: emerging first, then accumulation, max 8."""
    rows, seen = [], set()
    sources = [
        ('EMERGING', live.get('emergingCandidates') or []),
        ('ACCUMULATION', live.get('accumulationCandidates') or []),
    ]
    quotes = live.get('quotes') if isinstance(live.get('quotes'), dict) else {}
    for signal_type, arr in sources:
        if not isinstance(arr, list):
            continue
        for x in arr:
            if not isinstance(x, dict):
                continue
            ticker = str(x.get('ticker') or '').upper().strip()
            if not ticker or ticker in seen:
                continue
            seen.add(ticker)
            q = quotes.get(ticker, {})
            merged = dict(q) if isinstance(q, dict) else {}
            merged.update(x)
            merged['signalType'] = signal_type
            rows.append(merged)
            if len(rows) >= MAX_ROWS:
                break
        if len(rows) >= MAX_ROWS:
            break
    return rows


def build_context(rows):
    """Same compact per-ticker fields the paid workflow sends to the model."""
    context = []
    for r in rows:
        item = {k: r.get(k) for k in CONTEXT_FIELDS}
        item['quoteTime'] = r.get('timestampET')
        context.append(item)
    return context


def write_doc(out_path, doc):
    out_path = pathlib.Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_name(out_path.name + '.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, out_path)


def make_doc(now, live, model, status, analyses, note):
    doc = {
        'schemaVersion': SCHEMA_VERSION,
        'provider': PROVIDER,
        'model': model,
    }
    if status is not None:
        doc['status'] = status
    doc.update({
        'updatedAtUTC': now.isoformat(),
        'liveFeedUpdatedAtUTC': live.get('updatedAtUTC'),
        'analysisCount': len(analyses),
        'analyses': analyses,
        'note': note,
    })
    return doc


class HubError(Exception):
    """A failed hub call. `kind` is one of: auth, network, http, model, bad_response."""

    def __init__(self, kind, detail):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail


def call_hub(base_url, key, row, live_updated, timeout):
    """POST one row to the hub and return the parsed JSON document."""
    payload = {'rows': [row], 'liveFeedUpdatedAtUTC': live_updated, 'lang': 'ar'}
    try:
        req = urllib.request.Request(
            base_url.rstrip('/') + ENDPOINT,
            data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers={
                'Authorization': 'Bearer ' + key,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'tagit-analyze/1.0',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        code = e.code
        try:
            err_body = e.read().decode('utf-8', errors='replace')
        except Exception:
            err_body = ''
        if code in (401, 403):
            raise HubError('auth', 'HTTP %d (key rejected)' % code)
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            if isinstance(parsed.get('analyses'), dict):
                return parsed
            err = parsed.get('error') if isinstance(parsed.get('error'), dict) else {}
            if 'MODEL_UNAVAILABLE' in (parsed.get('status'), err.get('code')):
                raise HubError('model', 'HTTP %d MODEL_UNAVAILABLE' % code)
        raise HubError('http', 'HTTP %d' % code)
    except HubError:
        raise
    except Exception as e:  # URLError, timeout, connection reset, bad URL, ...
        # Only the exception class is reported so nothing sensitive can leak.
        reason = getattr(e, 'reason', None)
        label = type(reason).__name__ if isinstance(reason, BaseException) else type(e).__name__
        raise HubError('network', label)
    try:
        parsed = json.loads(body)
    except Exception:
        raise HubError('bad_response', 'response was not JSON')
    if not isinstance(parsed, dict):
        raise HubError('bad_response', 'response was not a JSON object')
    return parsed


def main(argv=None, env=None):
    env = os.environ if env is None else env
    ap = argparse.ArgumentParser(description='TAGit analysis via the self-hosted AI Hub')
    ap.add_argument('--live', default='tag/data/live-quotes.json', help='live quotes feed')
    ap.add_argument('--out', default='tag/data/ai-stock-analysis.json', help='output document')
    ap.add_argument('--timeout', type=float, default=REQUEST_TIMEOUT_SECONDS,
                    help='per-request timeout in seconds')
    ap.add_argument('--budget', type=float, default=BUDGET_SECONDS,
                    help='overall time budget in seconds')
    args = ap.parse_args(argv)

    base_url = (env.get('AI_HUB_URL') or '').strip()
    key = (env.get('AI_HUB_KEY') or '').strip()
    if not base_url or not key:
        missing = [n for n, v in (('AI_HUB_URL', base_url), ('AI_HUB_KEY', key)) if not v]
        print('Self-hosted AI Hub is not configured (missing: %s). '
              'Set repository variable AI_HUB_URL and secret AI_HUB_KEY. '
              'Nothing was written.' % ', '.join(missing))
        return 0

    started = time.monotonic()
    now = datetime.datetime.now(datetime.timezone.utc)
    out_path = pathlib.Path(args.out)
    live = load(args.live)
    old = load(out_path)

    # Freshness skip, like the paid workflow: a recent self-hosted report is reused.
    if env.get('GITHUB_EVENT_NAME') != 'workflow_dispatch':
        old_t = old.get('updatedAtUTC')
        if old_t and old.get('provider') == PROVIDER:
            try:
                then = datetime.datetime.fromisoformat(str(old_t).replace('Z', '+00:00'))
                if then.tzinfo is None:
                    then = then.replace(tzinfo=datetime.timezone.utc)
                if (now - then).total_seconds() < FRESH_SECONDS:
                    print('Self-hosted research cache is still fresh; exiting')
                    return 0
            except ValueError:
                pass

    old_model = old.get('model') if old.get('provider') == PROVIDER else None
    rows = build_rows(live)

    if not rows:
        write_doc(out_path, make_doc(now, live, old_model, None, {},
                                     'No active shortlist to research.'))
        print('No active shortlist to research.')
        return 0

    context = build_context(rows)
    live_updated = live.get('updatedAtUTC')

    analyses = {}
    model = None
    hub_answered = False          # at least one well-formed hub document received
    failed_model = []             # hub answered but the model produced no analysis
    failed_hub = []               # request itself failed (network / HTTP / bad body)
    skipped = []                  # never requested (budget or early stop)
    stop_reason = None
    last_error = None
    consecutive_failures = 0

    for i, row in enumerate(context):
        ticker = str(row.get('ticker') or '').upper().strip()
        remaining = args.budget - (time.monotonic() - started)
        if stop_reason is None and remaining < min(MIN_REQUEST_SECONDS, args.timeout):
            stop_reason = 'time budget of %d s exhausted' % int(args.budget)
        if stop_reason is not None:
            skipped.append(ticker)
            continue
        t0 = time.monotonic()
        try:
            doc = call_hub(base_url, key, row, live_updated, max(1.0, min(args.timeout, remaining)))
        except HubError as e:
            last_error = e
            consecutive_failures += 1
            print('%s: hub call failed (%s: %s)' % (ticker, e.kind, e.detail))
            if e.kind == 'model':
                hub_answered = True
                failed_model.append(ticker)
            else:
                failed_hub.append(ticker)
            if e.kind == 'auth':
                stop_reason = 'hub rejected the key'
            elif consecutive_failures >= MAX_CONSECUTIVE_FAILURES and not analyses:
                stop_reason = 'hub not responding'
            continue

        hub_answered = True
        if isinstance(doc.get('model'), str) and doc['model'].strip():
            model = doc['model'].strip()
        got = doc.get('analyses') if isinstance(doc.get('analyses'), dict) else {}
        a = None
        for k, v in got.items():
            if str(k).upper().strip() == ticker and isinstance(v, dict):
                a = dict(v)
                break
        if a is None:
            consecutive_failures += 1
            failed_model.append(ticker)
            print('%s: hub returned no analysis (status %s)' % (ticker, doc.get('status')))
            continue
        consecutive_failures = 0
        a['ticker'] = ticker
        a.setdefault('mode', 'SELF_HOSTED_AI')
        a.setdefault('model', model)
        a.setdefault('generatedAtUTC', now.isoformat())
        analyses[ticker] = a
        if a.get('aiStatus') == 'MODEL_FAILED':
            failed_model.append(ticker)
        print('%s: done in %.0f s (%s)' % (ticker, time.monotonic() - t0,
                                           a.get('aiStatus') or a.get('verdict')))

    good = [t for t, a in analyses.items() if a.get('aiStatus') != 'MODEL_FAILED']
    model = model or old_model
    requested = [str(c.get('ticker') or '').upper().strip() for c in context]

    if not hub_answered:
        # Unreachable or unauthorized: explicit status, no analyses (old ones are not carried over).
        if last_error is not None and last_error.kind == 'auth':
            note = ('Self-hosted AI Hub rejected the key (%s). Check repository secret AI_HUB_KEY. '
                    'No analysis was produced and no rules-based text is substituted.'
                    % last_error.detail)
        else:
            note = ('Self-hosted AI Hub could not be reached (%s). '
                    'No analysis was produced and no rules-based text is substituted.'
                    % (last_error.detail if last_error is not None else 'no request was made'))
        status, analyses = 'HUB_UNREACHABLE', {}
    elif not good:
        status = 'MODEL_UNAVAILABLE'
        note = ('The self-hosted model did not produce an analysis for any shortlisted ticker. '
                'No rules-based text is substituted.')
    elif len(good) == len(requested):
        status = 'OK'
        note = ('Each result is generated by the self-hosted open-source model (AI Hub) from free '
                'news/filings sources plus current TAGit technical/liquidity context. '
                'Research aid only.')
    else:
        status = 'PARTIAL'
        parts = ['Analyzed %d of %d shortlisted tickers with the self-hosted model.'
                 % (len(good), len(requested))]
        if failed_model:
            parts.append('Model produced no analysis for: %s.' % ', '.join(failed_model))
        if failed_hub:
            parts.append('Hub request failed for: %s.' % ', '.join(failed_hub))
        if skipped:
            parts.append('Left out (%s): %s.' % (stop_reason, ', '.join(skipped)))
        parts.append('Research aid only.')
        note = ' '.join(parts)

    write_doc(out_path, make_doc(now, live, model, status, analyses, note))
    print(json.dumps({'status': status, 'model': model, 'analysisCount': len(analyses),
                      'tickers': list(analyses), 'failed': failed_model + failed_hub,
                      'leftOut': skipped}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
