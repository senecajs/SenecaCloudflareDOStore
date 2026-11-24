/* Copyright © 2024 Seneca Project Contributors, MIT License. */

import Seneca from 'seneca'
import type {} from '@seneca/entity'
import { Miniflare } from 'miniflare'
import { build } from 'esbuild'

import CloudflareDOStoreDoc from '../src/CloudflareDOStoreDoc'
import CloudflareDOStore from '../src/CloudflareDOStore'

// A Durable Object class that Miniflare runs in workerd. Its RPC methods
// call the object's own ctx.storage, so the store runs against real
// Durable Object storage: STORE uses the key-value storage backend and
// SQL_STORE the SQLite storage backend.
const DO_SCRIPT = `
import { DurableObject } from 'cloudflare:workers'
export class StoreDO extends DurableObject {
  storageGet(key) { return this.ctx.storage.get(key) }
  storagePut(key, value) { return this.ctx.storage.put(key, value) }
  storageDelete(key) { return this.ctx.storage.delete(key) }
  storageList(opts) { return this.ctx.storage.list(opts) }
}
export class SqlStoreDO extends StoreDO {}
export default { fetch() { return new Response('ok') } }
`

type StorageKind = 'mock' | 'durable-object' | 'durable-object-sqlite'

let mf: Miniflare
let objectCount = 0

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: DO_SCRIPT,
    compatibilityDate: '2025-04-01',
    durableObjects: {
      STORE: 'StoreDO',
      SQL_STORE: { className: 'SqlStoreDO', useSQLite: true },
    },
  })
  await mf.ready
})

afterAll(async () => {
  await mf.dispose()
})

describe('CloudflareDOStore', () => {
  test('load-plugin', async () => {
    expect(CloudflareDOStore).toBeDefined()
    expect(CloudflareDOStoreDoc).toBeDefined()

    const storage = await makeStorage('durable-object')
    const seneca = await makeSeneca(storage)

    expect(seneca.export('CloudflareDOStore/native')).toBeDefined()
    expect(seneca.export('CloudflareDOStore/native')().storage).toBe(storage)
    await seneca.close()
  })

  test('prefix and suffix options', async () => {
    const storage = await makeStorage('durable-object')
    const seneca = await makeSeneca(storage, { prefix: 'p1', suffix: 's1' })

    const ent = await seneca.entity('foo/bar').data$({ x: 1 }).save$()
    expect(await storage.get('p1/foo/bar/s1/' + ent.id)).toEqual(
      JSON.stringify({ x: 1, id: ent.id }),
    )

    const loaded = await seneca.entity('foo/bar').load$(ent.id)
    expect(loaded).toMatchObject({ id: ent.id, x: 1 })
    await seneca.close()
  })

  test('generate_id option', async () => {
    let n = 0
    const seneca = await makeSeneca(await makeStorage('durable-object'), {
      generate_id: (ent: any) =>
        'item' === ent.canon$({ object: true }).name ? 'gen-' + ++n : undefined,
    })

    const a = await seneca.entity('gen/item').data$({ x: 1 }).save$()
    expect(a.id).toEqual('gen-1')

    // undefined from the option: the entity plugin generates the id.
    const b = await seneca.entity('gen/other').data$({ x: 2 }).save$()
    expect(typeof b.id).toEqual('string')
    expect(b.id.length).toBeGreaterThan(0)
    expect(b.id).not.toMatch(/^gen-/)
    await seneca.close()
  })

  test('invalid options are rejected', async () => {
    for (const bad of [{ generate_id: 'not-a-function' }, { bad: 1 }]) {
      const errs: any[] = []
      const seneca = Seneca({ legacy: false, debug: { undead: true } })
        .test((err: any) => errs.push(err), 'silent')
        .use('@seneca/entity')
        .use(CloudflareDOStore, bad)
      await seneca.ready()
      expect(errs.map((err: any) => err.code)).toEqual([
        'invalid_plugin_option',
      ])
      await seneca.close()
    }
  })

  test('storage error', async () => {
    const failing = {
      get: async () => {
        throw new Error('get failed')
      },
      put: async () => {
        throw new Error('put failed')
      },
      delete: async () => {
        throw new Error('delete failed')
      },
      list: async () => {
        throw new Error('list failed')
      },
    }
    const seneca = await makeSeneca(failing, {}, 'silent')

    await expect(
      seneca.entity('foo/bar').data$({ x: 1 }).save$(),
    ).rejects.toThrow('put failed')
    await expect(seneca.entity('foo/bar').load$('i0')).rejects.toThrow(
      'get failed',
    )
    await expect(seneca.entity('foo/bar').list$({})).rejects.toThrow(
      'list failed',
    )
    await expect(seneca.entity('foo/bar').remove$('i0')).rejects.toThrow(
      'delete failed',
    )
    await seneca.close()
  })

  test('utils.resolveKeyPrefix', async () => {
    const { resolveKeyPrefix } = CloudflareDOStore['utils']
    const s = Seneca({ legacy: false }).test().use('@seneca/entity')
    await s.ready()

    expect(resolveKeyPrefix(s.make('foo'), { prefix: '', suffix: '' })).toEqual(
      'foo',
    )
    expect(
      resolveKeyPrefix(s.make('foo/bar'), { prefix: 'p', suffix: '' }),
    ).toEqual('p/foo/bar')
    expect(
      resolveKeyPrefix(s.make('foo/bar'), {
        prefix: '',
        suffix: 's',
        map: { '-/foo/bar': 'custom' },
      }),
    ).toEqual('custom')
  })
})

// The entity tests run against real Durable Object storage in Miniflare,
// with both storage backends, and against the in-memory mock below. Each
// test gets a new Durable Object, so it starts with empty storage.
describe.each(['durable-object', 'durable-object-sqlite', 'mock'] as const)(
  'crud (%s)',
  (kind) => {
    let seneca: any

    beforeEach(async () => {
      seneca = await makeSeneca(await makeStorage(kind))
    })

    afterEach(async () => {
      await seneca.close()
    })

    test('save and load by id', async () => {
      const ent = await seneca
        .entity('foo/bar')
        .data$({ x: 1, y: 'hello' })
        .save$()

      expect(ent.id).toBeDefined()
      expect(ent).toMatchObject({ x: 1, y: 'hello' })

      const loaded = await seneca.entity('foo/bar').load$(ent.id)
      expect(loaded).toMatchObject({ id: ent.id, x: 1, y: 'hello' })
    })

    test('load missing returns null', async () => {
      const loaded = await seneca.entity('foo/bar').load$('no-such-id')
      expect(loaded).toEqual(null)
    })

    test('list all', async () => {
      await seneca.entity('list/item').data$({ n: 1 }).save$()
      await seneca.entity('list/item').data$({ n: 2 }).save$()
      await seneca.entity('list/item').data$({ n: 3 }).save$()

      const list = await seneca.entity('list/item').list$({})
      expect(list.length).toEqual(3)
    })

    test('list with field filter', async () => {
      await seneca.entity('filter/item').data$({ color: 'red' }).save$()
      await seneca.entity('filter/item').data$({ color: 'blue' }).save$()
      await seneca.entity('filter/item').data$({ color: 'red' }).save$()

      const list = await seneca.entity('filter/item').list$({ color: 'red' })
      expect(list.length).toEqual(2)
      expect(list.every((e: any) => e.color === 'red')).toBe(true)
    })

    test('list with sort$', async () => {
      await seneca.entity('sort/item').data$({ n: 3 }).save$()
      await seneca.entity('sort/item').data$({ n: 1 }).save$()
      await seneca.entity('sort/item').data$({ n: 2 }).save$()

      const asc = await seneca.entity('sort/item').list$({ sort$: { n: 1 } })
      const vals = asc.map((e: any) => e.n)
      expect(vals).toEqual([1, 2, 3])

      const desc = await seneca.entity('sort/item').list$({ sort$: { n: -1 } })
      const valsDesc = desc.map((e: any) => e.n)
      expect(valsDesc).toEqual([3, 2, 1])
    })

    test('list with limit$ and skip$', async () => {
      for (let i = 0; i < 5; i++) {
        await seneca.entity('page/item').data$({ i }).save$()
      }

      const page = await seneca
        .entity('page/item')
        .list$({ sort$: { i: 1 }, limit$: 2, skip$: 1 })
      expect(page.map((e: any) => e.i)).toEqual([1, 2])
    })

    test('list with fields$', async () => {
      const ent = await seneca
        .entity('foo/bar')
        .data$({ a: 1, b: 2 })
        .save$()

      const list = await seneca
        .entity('foo/bar')
        .list$({ id: ent.id, fields$: ['a'] })

      expect(list[0].a).toEqual(1)
      expect(list[0].b).toBeUndefined()
    })

    test('remove by id', async () => {
      const ent = await seneca.entity('foo/bar').data$({ x: 99 }).save$()

      await seneca.entity('foo/bar').remove$(ent.id)

      const loaded = await seneca.entity('foo/bar').load$(ent.id)
      expect(loaded).toEqual(null)
    })

    test('remove with all$', async () => {
      await seneca.entity('del/item').data$({ tag: 'x' }).save$()
      await seneca.entity('del/item').data$({ tag: 'x' }).save$()
      await seneca.entity('del/item').data$({ tag: 'y' }).save$()

      await seneca.entity('del/item').remove$({ tag: 'x', all$: true })

      const remaining = await seneca.entity('del/item').list$({})
      expect(remaining.length).toEqual(1)
      expect(remaining.every((e: any) => e.tag !== 'x')).toBe(true)
    })

    test('remove first match', async () => {
      await seneca.entity('one/item').data$({ tag: 'z' }).save$()
      await seneca.entity('one/item').data$({ tag: 'z' }).save$()

      await seneca.entity('one/item').remove$({ tag: 'z' })

      const remaining = await seneca.entity('one/item').list$({ tag: 'z' })
      expect(remaining.length).toEqual(1)
    })

    test('load by query', async () => {
      await seneca.entity('q/item').data$({ k: 'a', v: 1 }).save$()
      await seneca.entity('q/item').data$({ k: 'b', v: 2 }).save$()

      const loaded = await seneca.entity('q/item').load$({ k: 'b' })
      expect(loaded).toMatchObject({ k: 'b', v: 2 })

      const missing = await seneca.entity('q/item').load$({ k: 'c' })
      expect(missing).toEqual(null)
    })

    test('update existing entity', async () => {
      const ent = await seneca.entity('foo/bar').data$({ x: 1 }).save$()

      ent.x = 2
      const updated = await ent.save$()
      expect(updated.x).toEqual(2)

      const loaded = await seneca.entity('foo/bar').load$(ent.id)
      expect(loaded.x).toEqual(2)
    })

    test('concurrent saves produce unique ids and intact data', async () => {
      const N = 20

      // Fire N saves at the same time — simulates multiple requests hitting
      // the DO simultaneously. In a real DO, these are serialized by the
      // runtime; with the mock, the test checks the promise handling.
      const saved = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          seneca.entity('race/item').data$({ n: i, label: `item-${i}` }).save$(),
        ),
      )

      // Every save must have returned a unique id.
      const ids = saved.map((e: any) => e.id)
      expect(new Set(ids).size).toEqual(N)

      // Re-load every entity concurrently and verify the payload is intact.
      const loaded = await Promise.all(
        saved.map((e: any) => seneca.entity('race/item').load$(e.id)),
      )

      for (let i = 0; i < N; i++) {
        expect(loaded[i]).not.toBeNull()
        expect(loaded[i].id).toEqual(saved[i].id)
        expect(loaded[i].n).toEqual(saved[i].n)
        expect(loaded[i].label).toEqual(saved[i].label)
      }

      // The total count in storage must equal N — no writes were lost or doubled.
      const all = await seneca.entity('race/item').list$({ limit$: N + 1 })
      expect(all.length).toEqual(N)
    })
  },
)

// Seneca, @seneca/entity and this store run inside a Durable Object in
// workerd, with the object's own ctx.storage passed as the do.storage
// option, as the README shows.
describe('inside workerd', () => {
  test('crud in a Durable Object with ctx.storage', async () => {
    const script = await bundleWorker(`
      import { DurableObject } from 'cloudflare:workers'
      import Seneca from 'seneca'
      import Entity from '@seneca/entity'
      import CloudflareDOStore from '../src/CloudflareDOStore'

      export class SenecaDO extends DurableObject {
        async run() {
          const seneca = Seneca({ legacy: false, log: 'silent' })
            .use(Entity)
            .use(CloudflareDOStore, { do: { storage: this.ctx.storage } })
          await seneca.ready()

          const saved = await seneca.entity('w/item').data$({ n: 1 }).save$()
          await seneca.entity('w/item').data$({ n: 2 }).save$()
          const loaded = await seneca.entity('w/item').load$(saved.id)
          const list = await seneca.entity('w/item').list$({ sort$: { n: -1 } })
          await seneca.entity('w/item').remove$(saved.id)
          const gone = await seneca.entity('w/item').load$(saved.id)
          const same =
            this.ctx.storage ===
            seneca.export('CloudflareDOStore/native')().storage
          await seneca.close()

          return {
            loaded: loaded.data$(false),
            list: list.map((e) => e.n),
            gone,
            same,
          }
        }
      }

      export default { fetch() { return new Response('ok') } }
    `)

    const worker = new Miniflare({
      modules: true,
      script,
      compatibilityDate: '2026-01-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        SENECA_DO: { className: 'SenecaDO', useSQLite: true },
      },
    })

    try {
      const ns = await worker.getDurableObjectNamespace('SENECA_DO')
      const stub: any = ns.get(ns.idFromName('workerd'))
      const out = await stub.run()
      expect(out.loaded).toMatchObject({ n: 1 })
      expect(out.list).toEqual([2, 1])
      expect(out.gone).toEqual(null)
      expect(out.same).toEqual(true)
    } finally {
      await worker.dispose()
    }
  })
})

// Bundles a Worker module from source that imports seneca, @seneca/entity
// and the store. workerd provides the Node.js built-in modules that Seneca
// needs through the nodejs_compat flag.
async function bundleWorker(contents: string) {
  const out = await build({
    stdin: { contents, resolveDir: __dirname, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'error',
    external: ['cloudflare:workers'],
    banner: {
      js:
        "import { createRequire } from 'node:module';" +
        "const require = createRequire('/');",
    },
  })
  return out.outputFiles[0].text
}

async function makeSeneca(storage: any, options: any = {}, log?: string) {
  const seneca = Seneca({ legacy: false })
    .test(log)
    .use('@seneca/entity')
    .use(CloudflareDOStore, { do: { storage }, ...options })
  await seneca.ready()
  return seneca
}

// Storage for one test: a new Durable Object in Miniflare, reached through
// its RPC methods, or the in-memory mock.
async function makeStorage(kind: StorageKind) {
  if ('mock' === kind) {
    return makeMockStorage()
  }

  const ns = await mf.getDurableObjectNamespace(
    'durable-object' === kind ? 'STORE' : 'SQL_STORE',
  )
  const stub: any = ns.get(ns.idFromName('test-' + objectCount++))

  return {
    get: (key: string) => stub.storageGet(key),
    put: (key: string, value: any) => stub.storagePut(key, value),
    delete: (key: string) => stub.storageDelete(key),
    list: (opts?: any) => stub.storageList(opts),
  }
}

// In-memory mock of DurableObjectStorage for testing without a Worker runtime.
function makeMockStorage() {
  const data = new Map<string, any>()

  return {
    async get(key: string) {
      return data.get(key)
    },
    async put(key: string, value: any) {
      data.set(key, value)
    },
    async delete(key: string) {
      return data.delete(key)
    },
    async list(opts: {
      prefix?: string
      limit?: number
      reverse?: boolean
    } = {}) {
      let entries = [...data.entries()]
      if (opts.prefix) {
        entries = entries.filter(([k]) => k.startsWith(opts.prefix!))
      }
      entries.sort(([a], [b]) => a.localeCompare(b))
      if (opts.reverse) entries.reverse()
      if (opts.limit) entries = entries.slice(0, opts.limit)
      return new Map(entries)
    },
  }
}
