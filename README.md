![Seneca](http://senecajs.org/files/assets/seneca-logo.png)
> A [Seneca.js][] data storage plugin.

# @seneca/cloudflare-do-store

[![npm version][npm-badge]][npm-url]
[![Build](https://github.com/senecajs/SenecaCloudflareDOStore/actions/workflows/build.yml/badge.svg)](https://github.com/senecajs/SenecaCloudflareDOStore/actions/workflows/build.yml)

| ![Voxgig](https://www.voxgig.com/res/img/vgt01r.png) | This open source module is sponsored and supported by [Voxgig](https://www.voxgig.com). |
|---|---|

## Description

`@seneca/cloudflare-do-store` is a [Seneca](http://senecajs.org) plugin that provides an entity data store backed by [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) storage.

Durable Objects give each object instance its own persistent, strongly-consistent key-value storage (`DurableObjectStorage`). This plugin wraps that storage to expose the standard Seneca entity API (`save$`, `load$`, `list$`, `remove$`). Because DO storage is only accessible from within the Durable Object itself, the plugin accepts the storage instance directly — there is no REST or HTTP client mode.

## Install

```sh
npm install @seneca/cloudflare-do-store
```

## Usage

Inside your Durable Object class, pass `this.ctx.storage` to the plugin:

```js
import { Seneca } from 'seneca'
import CloudflareDOStore from '@seneca/cloudflare-do-store'

export class MyDO {
  constructor(ctx, env) {
    this.seneca = Seneca({ legacy: false })
      .use('promisify')
      .use('entity')
      .use(CloudflareDOStore, {
        do: { storage: ctx.storage },
      })
  }
}
```

## Options

| Option | Default | Description |
|---|---|---|
| `do.storage` | — | `DurableObjectStorage` instance (required) |
| `prefix` | `''` | Key prefix applied to all stored keys |
| `suffix` | `''` | Key suffix applied before the entity segment |
| `map` | `{}` | Custom key prefix overrides per entity canon string |
| `cmd.list.size` | `11` | Default page size for `list$` |
| `cmd.list.maxScan` | `1000` | Maximum entries scanned per `list$` or `remove$ all$` |

## Key scheme

Keys are derived from the entity canon and id:

```
[prefix/]<canon>[/suffix]/<id>
```

| Entity canon | Key prefix (no prefix/suffix) |
|---|---|
| `foo` | `foo/` |
| `foo/bar` | `foo/bar/` |
| `zone/base/name` | `base/name/` |

Use `map` to override the prefix for a specific canon:

```js
.use(CloudflareDOStore, {
  do: { storage: ctx.storage },
  map: { '-/foo/bar': 'custom-prefix' },
})
```

## Querying

`list$` scans all keys matching the entity prefix and filters, sorts, and paginates in memory:

```js
// All entities of this type
const all = await seneca.entity('foo/bar').list$({})

// Filter by field
const red = await seneca.entity('foo/bar').list$({ color: 'red' })

// Sort, paginate, and project
const page = await seneca.entity('foo/bar').list$({
  color: 'red',
  sort$: { name: 1 },   // 1 = ascending, -1 = descending
  skip$: 10,
  limit$: 5,
  fields$: ['id', 'name'],
})
```

## Native driver

```js
const { storage } = seneca.export('CloudflareDOStore/native')()
```

Returns the raw `DurableObjectStorage` instance for direct access.

## License

Copyright (c) 2024 the Seneca Project Contributors, MIT License.

[Seneca.js]: http://senecajs.org
[npm-badge]: https://img.shields.io/npm/v/@seneca/cloudflare-do-store.svg
[npm-url]: https://npmjs.com/package/@seneca/cloudflare-do-store
