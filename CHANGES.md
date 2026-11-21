# Changes

## 0.1.0 2026-11-21

* First release. A Seneca entity store backed by Cloudflare Durable Objects storage.
* Seneca 4: the peer dependencies are `seneca` `^4.0.0` and `@seneca/entity` `^29.0.0`. Node.js 24 or later (`engines.node` `>=24`).
* The option defaults are built with the validator that Seneca passes to the plugin: `defaults` is a function of `{ valid }`. Seneca 4 rejects defaults built with Gubu (`plugin_gubu_shape`), and gubu was never a declared dependency. `do` stays open. Unknown top-level options are rejected with `invalid_plugin_option`.
* The option `generate_id` must be a function when given. The default returns `undefined`, which means that the entity plugin generates the id, as before.
* The store takes its storage in the plugin's `init` task (`seneca.init`), not in a raw `init:CloudflareDOStore` action.
* No dependency on `seneca-promisify`, `seneca-entity` or `@seneca/entity-util`. Load the entity plugin as `@seneca/entity`.
* `npm pack` and `npm publish` build `dist/` first (`prepack`). The `prepare` script is removed, so a git install no longer needs TypeScript.
* Releases are published from GitHub Actions with npm trusted publishing and provenance. The local `repo-tag` and `repo-publish` scripts are removed.
* Tested against real Durable Object storage in Miniflare (workerd), with the key-value and the SQLite storage backends: from Node through RPC methods of a test Durable Object, and inside a Durable Object (`nodejs_compat`) with its own `ctx.storage`. A deployed Durable Object was not tested on Seneca 4.
