# Reveal: same hour yesterday next to our miss

Task #365. Checked 8 November 2026, about 10:16 UTC.

- **API:** each zone in `/reveal` now has `baseline_mae` and `baseline_name` ("same hour yesterday").
  - **How it's worked out:** the actual price at the same UTC hour on the day before delivery, from the same sources the reveal already reads.
  - **When it's null:** unless every published hour has a price the day before.
- **GB, frozen 09:15:** our miss is £45.93 per MWh against £57.13 for same hour yesterday. This matches Keanu's 57.1.
- **Page:** one line under each zone with a result. When copying yesterday would have been closer, the line adds one plain sentence saying so.
- **Screenshots:** taken from a local engine reading the runner's data read-only, with no writes, at 1920x1080 and 390x844.
