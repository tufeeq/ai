.PHONY: phase1 phase1-refresh phase2 phase2-refresh
.PHONY: verify
verify:
	python -m unittest discover -s tests -v
	node --test quote-service/test/*.test.mjs web/*.test.mjs
	node --check web/app.js
	node --check web/performance.js
	python -m research.run --check
	python -m research.phase2 --check
	python -m research.continuation --check
	python -m research.continuation_probe --check
	python -m research.continuation_paths --check
	python -m research.share_capacity --check
	python -m research.signal_clock --check
	python -m research.quote_anchored --check

# Python 3.12+, Node 24. Offline, no account secrets needed.
phase1:
	python -m unittest discover -s tests -p 'test_phase1.py' -v
	node --test quote-service/test/phase1-replay.test.mjs
	python -m research.run --check

phase1-refresh:
	python -m research.run

# Exposed development data only. No network, live-rule change or holdout access.
phase2:
	python -m unittest discover -s tests -p 'test_phase2.py' -v
	node --test web/phase2-view.test.mjs
	python -m research.phase2 --check

phase2-refresh:
	python -m research.phase2

.PHONY: continuation continuation-refresh
continuation:
	python -m unittest discover -s tests -p 'test_continuation.py' -v
	python -m research.continuation --check
	python -m research.continuation_probe --check

continuation-refresh:
	python -m research.continuation
	python -m research.continuation_probe

.PHONY: continuation-paths
continuation-paths:
	python -m unittest discover -s tests -p 'test_continuation_paths.py' -v
	python -m research.continuation_paths --check

.PHONY: share-capacity
share-capacity:
	python -m unittest discover -s tests -p 'test_quote_units.py' -v
	python -m unittest discover -s tests -p 'test_paper.py' -v
	python -m unittest discover -s tests -p 'test_share_capacity.py' -v
	python -m research.share_capacity --check

.PHONY: signal-clock
signal-clock:
	python -m unittest discover -s tests -p 'test_signal_clock.py' -v
	python -m research.signal_clock --check

.PHONY: quote-anchored
quote-anchored:
	python -m unittest discover -s tests -p 'test_quote_anchored.py' -v
	python -m research.quote_anchored --check
