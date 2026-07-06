# atlas-plugins

SDK + individual plugin builds for Atlas's plugin marketplace, distributed independently of
Atlas's own app version (see `../docs/plugins/implementation.md` PL2/PL15, and
`../LOOPING/backlogs/atlas-plugins.md` for the build queue).

This repo is bootstrapped empty. PL2 (`../LOOPING/backlogs/atlas-plugins.md`) is the ticket that
lays out the real `plugins/<id>/` + `sdk/` scaffold, the Vite library-mode build config, and the
`create-plugin` template. Until then, `npm run build` / `npm test` are no-op placeholders so the
loop's gate command has something real to check.
