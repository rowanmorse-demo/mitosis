# App Store artwork

Regenerates the App Store screenshots from the real game, at Apple's exact sizes
(iPhone 6.9-inch 2868×1320, iPad 13-inch 2752×2064).

1. `npm run dev` in the repo root (the captures load the game from http://localhost:3000).
2. `RAW=1 node shots.js` — drives headless Chrome over the DevTools protocol, puts the game in each
   state (arena, menu, shop, profile, events, results), dresses the shop/profile/results screens with
   representative numbers, and writes clean frames to `raw/`.
3. `node compose.js` — renders `compose.html` (branded background, headline, tilted device frame with the
   capture inside) for each slide to `final/`.

Edit the headlines in `compose.js` (`SLIDES`) and the look in `compose.html`. The scripts expect
Google Chrome at its default path and Node 22+ (built-in `fetch` and `WebSocket`).
