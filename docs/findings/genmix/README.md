# Today's mix (#370 UI)

Opened from a country's card in Now ("Today's mix, hour by hour"). Stacked bar per hour, fixed fuel order and colours,
hover (or tap) for each hour's numbers, a one-line sentence on top, a date that follows the history scrubber (or pick
Today, Yesterday, 26 Oct storm, or any date), and an "All six, same scale" view.

Data: GET /generation?zone=&date= (Elexon FUELHH for GB). The UI reads `ts` or `t` for the hour and `demand_mw` or `load_mw`.
If the endpoint does not answer, a labelled sample with the same shape is shown, marked "Sample shape, not real data".
Screenshots (live API, 8 Nov 11:30 UTC): desktop and iPhone 13 for GB today (11 hours so far), GB on 26 Oct, and the
six-country view. Hours are UTC.
