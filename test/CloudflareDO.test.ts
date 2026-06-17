/* Copyright © 2024 Seneca Project Contributors, MIT License. */

import Seneca from 'seneca'

import CloudflareDOStoreDoc from '../src/CloudflareDOStoreDoc'
import CloudflareDOStore from '../src/CloudflareDOStore'

describe('CloudflareDOStore', () => {
  test('load-plugin', async () => {
    expect(CloudflareDOStore).toBeDefined()
    expect(CloudflareDOStoreDoc).toBeDefined()

    const seneca = makeSeneca()
    await seneca.ready()

    expect(seneca.export('CloudflareDOStore/native')).toBeDefined()
  })

  test('utils.resolveKeyPrefix', () => {
    const { resolveKeyPrefix } = CloudflareDOStore['utils']
    const s = Seneca({ legacy: false }).test().use('entity')

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

  describe('crud', () => {
    let seneca: any

    beforeEach(async () => {
      seneca = makeSeneca()
      await seneca.ready()
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
      expect(vals).toEqual([...vals].sort((a: number, b: number) => a - b))

      const desc = await seneca.entity('sort/item').list$({ sort$: { n: -1 } })
      const valsDesc = desc.map((e: any) => e.n)
      expect(valsDesc).toEqual(
        [...valsDesc].sort((a: number, b: number) => b - a),
      )
    })

    test('list with limit$ and skip$', async () => {
      for (let i = 0; i < 5; i++) {
        await seneca.entity('page/item').data$({ i }).save$()
      }

      const page = await seneca
        .entity('page/item')
        .list$({ sort$: { i: 1 }, limit$: 2, skip$: 1 })
      expect(page.length).toEqual(2)
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
      expect(remaining.every((e: any) => e.tag !== 'x')).toBe(true)
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
      // the DO simultaneously. In a real DO, these would be serialized by the
      // runtime; here the mock verifies our promise handling stays correct.
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
  })
})

function makeSeneca() {
  return Seneca({ legacy: false })
    .test()
    .use('promisify')
    .use('entity')
    .use(CloudflareDOStore, { do: { storage: makeMockStorage() } })
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
