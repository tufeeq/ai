.PHONY: phase1 phase1-refresh
.PHONY: verify
verify:
	python -m unittest discover -s tests -v
	node --test quote-service/test/*.test.mjs web/*.test.mjs
	node --check web/app.js
	node --check web/performance.js
	python -m research.run --check

# Python 3.12+, Node 24. Offline, no account secrets needed.
phase1:
	python -m unittest discover -s tests -p 'test_phase1.py' -v
	node --test quote-service/test/phase1-replay.test.mjs
	python -m research.run --check

phase1-refresh:
	python -m research.run
