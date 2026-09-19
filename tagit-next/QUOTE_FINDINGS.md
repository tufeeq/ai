# Historical quote feasibility audit

The first 12 chronological BASE training signals from August 24 were selected
before quote retrieval, without filtering for a favorable outcome. Alpaca SIP
returned 10,375 level-one quotes across their two-minute entry windows; no window
hit the 10,000-record limit. The raw response fields and signal references are
preserved in `data/quote-windows.json.gz`.

Results with an assumed one-second processing delay:

- 10 of 12 windows contained a quote inside the frozen entry range, with nonempty
  displayed sizes, spread <=0.8%, and no prior observed valid bid through the stop.
- 7 contained an eligible observed sequence spanning at least 500ms, with adjacent
  observation gaps <=3 seconds. This is not a guarantee of continuous availability.
- 5 had previously been classified `ENTRY_NOT_AVAILABLE` or `NO_NEXT_MINUTE` by
  the **next-minute-open approximation**, despite a later eligible quote before
  expiration. Those candle labels must not be interpreted as proof that no entry
  was possible during the whole setup window.

This corrects a measurement limitation, not the rejected strategy's profitability.
No order was submitted. Quotes do not establish queue position, actual fills,
latency, execution costs, halt status, or subsequent profitable exits. The prior
frozen study remains unchanged; this does not revise its P&L or success rate.

`quote_audit.py` implements a separate quote-based entry diagnostic. It excludes
quotes preceding the assumed decision time, does not resurrect a setup after an
observed stop breach, and marks limit-capped negative findings as unknown.

`news_context.py` adds a strict information-availability join: publication time,
first observation time and article-version time must all precede the signal.
Historical web search is not a complete timestamped news feed. No callable news
archive connector was found in the available tools; news coverage remains UNKNOWN.
The join is implemented and tested, but news data was not collected or trained on.

Reproduce:

```
python quote_audit.py
python -m unittest discover -s tests
```

The 35 software tests include latency, truncation, invalidation, late-discovered
news and later revisions. They do not establish trading accuracy. The production
app is unchanged and the independent engine remains rejected-model research only.
