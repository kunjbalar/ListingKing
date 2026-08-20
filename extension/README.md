# ListingKing Chrome extension

Load this folder as an unpacked extension during MVP development: Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `extension/`.

It is deliberately scoped to the two Meesho supplier hostnames in `manifest.json`. It has no cookie, tabs, history, or broad host permissions. The content script only captures visible form controls, filters sensitive-looking fields, offers a dry run, highlights fields it changes, and has an immediate stop control. It never presses a Meesho submit button.

For production, build the popup with React, exchange the LoginKing dashboard session for a short-lived, refreshable extension token over HTTPS, and use the reviewed server-provided item payload instead of the temporary JSON prompt used in this first vertical slice.
