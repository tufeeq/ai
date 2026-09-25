# سجل التغيير المنهجي

## elite-shadow-1 — 2026-09-25

- `discovery-1`: قواعد الاكتشاف الأصلية محفوظة دون تعديل.
- `elite-features-1`: خصائص مرصودة مسماة بوضوح؛ لا ادعاء order flow من الحجم.
- `elite-shadow-1`: حالات متابعة منفصلة، persistence=2، ATR وتراجع/استعادة بحثية.
- `execution-diagnostic-1`: ثلاث عائلات مع زمن وصول وتكاليف وقدرة حجم من الماضي؛ أهلية تاريخية تمنع الاعتماد.
- قواعد البحث لم تُرقّ للتداول؛ لا احتمال نجاح رقمي.
- الهوية الجديدة TAG elite ومسار مستقل؛ NEXT لا يستبدل.
- عتبات النسخة الأولى تعريفات تجريبية مسبقة الحساب، لا أفضل عتبات منتقاة من العينة.

تغيير الإعدادات ينتج runId ببصمة مختلفة. إعادة معالجة بيانات مصححة تتطلب تشغيلًا جديدًا منفصلًا؛ هذا السجل والنتائج الأصلية لا يُستبدلان.

## 0.1.1 — 2026-09-25, live-display repair

- Stream observed OHLC and receipt times to the live chart. Historical cutoff excludes later receipts.
- Display the latest valid trade separately from the minute-close evaluation; show timestamp, age and change since first detection.
- Explain a suspended state evaluation when missing contiguous bars or stale data prevents confirmation. Do not relabel the original discovery or loosen the research thresholds.
- Mobile opportunity cards replace the horizontal table; readable price/change/reason/detail controls.
- Replace archive-only copy in shadow mode. Classify provider market roundups separately from an established catalyst and link the underlying articles.
- Follow tracked symbols with stale histories, even if their old bars remain in the bridge cache.
- Restore exported decision evidence across this corrective deployment. This is a partial decision snapshot, not a full durable input-journal backup.
- Regression verification: 21 engine/observer/presentation tests, 62 existing NEXT service tests, and DOM flow checks. No strategy promotion.

## 0.1.2 — 2026-09-25, outcome-first interface

- Default to current observation, ignoring previously persisted archive preference. Explicit `?mode=replay` still opens history. Load archives only on request; archive failures cannot prevent live startup.
- Separate activity detection from a buy recommendation and label model eligibility as simulation conditions, not proven entry quality.
- Add observed changes at 1/5/15/30/60 minutes for every filtered discovery, aggregate rising/falling/flat/missing/pending counts, and retain losing discoveries.
- Reference original detection price and use the minute close at ceil((first_at + horizon)/minute). Missing exact candles stay unknown; future completions/receipts stay excluded. Conflicting close revisions are unknown. These observations are not executable trade returns, and browser notification receipt/fill data are unavailable.
- Improve mobile hierarchy, outcome cards and archive separation. No change to discovery/state thresholds or strategy promotion.
- Verification: 22 engine/presentation tests and DOM scenarios for live default, stored replay preference, archive failure isolation, explicit replay, outcome navigation and return to live.
- Refresh the partial public decision recovery snapshot before deployment; full persistent input logging remains unavailable.
- Rollback code target: 96a4e31a53327c73fb431bba552bb07bf7a1e491. Retain latest decision snapshot if rolling back presentation changes.
